# Orbital — Target Architecture

Where the codebase is going: a canvas of derivations, executed locally, written
in one language.

Implementation order is in [orbital-plan.md](orbital-plan.md).

---

## 1. The change everything follows from

Today a node is a chat with an agent. It owns a conversation, a session and a
lifecycle status. Two nodes working on the same repository know nothing about
each other, and the canvas is a layout of transcripts.

The new unit:

> **A node is a derivation: `intent + inputs -> artifact`.**

Not an agent, not a conversation. It is a claim that some artifact follows from
an intent applied to named inputs. A conversation, where one happens, belongs to
a **run** — a single attempt at the derivation — and is evidence, not identity.
Re-running a node starts a new run with a fresh session and the same intent.

Everything below follows from that sentence.

A second decision, load-bearing for what comes later:

> **The graph is shared state. Execution is not.**

Small state — intents, edges, decisions, artifact references — lives in an event
log. Large state — repositories, worktrees, Claude sessions, processes — never
leaves the machine it was made on and is addressed only by identifier.

Orbital is single-player today. That separation is the only reason multiplayer
can stay a later decision rather than a rewrite.

---

## 2. One language

Three runtimes cost more than they return: a Go worker, a Rust shell and a
TypeScript client mean three toolchains, three test runners, three dependency
graphs and three places for the same bug to hide. The split was never a design
choice — it accumulated.

The target is TypeScript end to end:

- `worker/` (Go) is ported into `core/` and deleted
- `app/src-tauri` (Rust) is deleted outright — eighteen pass-through commands
  that no scenario needs
- the desktop shell becomes Electron, later, wrapped around the same web client

The client is a web application. It talks to `core` over HTTP and WS, so it runs
identically in a browser tab and inside Electron. The shell stays thin: a
window, a server process, a tray icon, updates.

---

## 3. Layers

```
┌──────────────────────────────────────────────────────┐
│  Client (React + TypeScript)                         │
│  canvas · node panel                                 │
│  an ordinary web app; runs in a tab                  │
└───────────────┬──────────────────────────────────────┘
                │  HTTP (commands, queries) + WS (event stream)
┌───────────────▼──────────────────────────────────────┐
│  core (TypeScript, Node)                             │
│                                                      │
│  api ──► graph ──► scheduler ──► executor            │
│           │            │             │               │
│       eventlog     context       worktree/claude     │
│           │        assembler          │              │
│        store ◄─────────────────── artifacts          │
└──────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────┐
│  Shell (Electron) — later                            │
│  window · starts core · tray · updates               │
└──────────────────────────────────────────────────────┘
```

---

## 4. Modules

| Module | Owns | Does not |
|---|---|---|
| `graph` | nodes, edges, digests, computed state, DAG validity | any I/O — pure logic |
| `eventlog` | the mutation log, folding, time, forking | know anything about execution |
| `context` | assembling a node's context from its edges | call the model |
| `scheduler` | which nodes are runnable, dispatch, cancellation | spawn processes itself |
| `executor` | worktrees, spawning the Claude CLI, run event streams | decide what to run |
| `artifacts` | content-addressed storage of results | know the graph's shape |
| `store` | persistence behind an interface (SQLite) | hold business logic |
| `api` | HTTP commands, WS event stream | know graph semantics |

`graph` and `eventlog` are pure: no `fs`, no `net`, no `child_process`. They are
the only place the semantics live, and they must be testable without a
filesystem, git or a network. This is enforced by a lint rule, not by good
intentions.

---

## 5. The graph model

### Node

```ts
type NodeKind = "source" | "derivation" | "gate" | "group" | "watcher"

type Node = {
  id: string
  graphId: string
  kind: NodeKind
  intent: string
  owner: string          // whose credentials the run uses

  artifactId: string     // a reference into artifacts, never the content
  inputDigest: string    // the digest of the inputs the artifact was made from
  runId?: string         // the most recent run
}
```

| Kind | What it is |
|---|---|
| `source` | an input the graph does not compute — a repository, a document, a dataset |
| `derivation` | computed by an executor from its intent and inputs |
| `gate` | a human decision; no execution, a person supplies the artifact |
| `group` | a subtree presented as one node; fractal |
| `watcher` | re-examines a source and emits when it moves; the only node that acts unasked |

### State is computed, never stored

```
fresh   : artifactId !== "" && inputDigest === currentDigest(node)
stale   : artifactId !== "" && inputDigest !== currentDigest(node)
empty   : artifactId === ""
running : a run is active
blocked : an ancestor is not fresh, or a gate above is unresolved or rejected
failed  : the last run failed
```

Those conditions overlap, so precedence is part of the definition:

```
running > failed > blocked > empty > fresh | stale
```

`blocked` also carries a reason — `rejected-gate`, `unresolved-gate` or
`stale-ancestor` — because "you cannot run this" and "a person said no" are
different facts to put in front of a user.

Computing state instead of storing it removes an entire class of bug: flags that
drift out of agreement with the graph they describe.

### Edges and apertures

```ts
type Aperture = "artifact" | "reference" | "normative"

type Edge = {
  id: string
  from: string
  to: string
  aperture: Aperture
  selector?: string      // which slice of the source artifact
}
```

**An edge does not mean sequence.** Execution order is derived from the
dependencies. There is no `then` edge and there will not be one.

| Aperture | What the consumer gets | Digest contribution |
|---|---|---|
| `artifact` | the source's content, inlined into its context | the artifact hash |
| `reference` | access to the source without inlining it | **none** |
| `normative` | a rule binding the consumer and its whole subtree | the rule's content hash, inherited downward |

`reference` contributing nothing is deliberate. It hands over live access rather
than a snapshot, so freshness cannot be a function of content the consumer never
inlined — a node is never stale because a reference source moved. Adding or
removing the edge still changes the digest, because the edge's own identity is
part of it.

### The input digest

```
digest(node) = H(
    intent,
    for each incoming edge in stable order:
        (edge.id, aperture, selector, contribution(edge)),
    for each inherited normative rule in stable order:
        (edge.id, aperture, selector, contribution(edge))
)
```

Normative rules travel down through edges of every aperture and are deduplicated
by edge id, so a rule arriving over two paths counts once. A rule three levels up
is as much an input as a direct one, so it belongs in the digest.

Freshness is a function of this and nothing else.

### What staleness means

The digest looks like a build system's, and it is worth being explicit that it
does not behave like one. Under Nix or Bazel, `stale` means *re-run and you
deterministically get the correct artifact*. Under a language model it does not:
running the same intent over the same inputs a second time produces a
**different** artifact, not a reproduction of the first.

So `stale` cannot mean "rebuild this."

It means: **the artifact you accepted rests on inputs that have since moved.**

Two consequences the rest of the design has to respect:

- Nothing re-runs automatically. Staleness is surfaced to a person, who decides
  whether the change matters. There is no `make` in this system.
- Re-running is a new derivation, not a repair. The previous artifact and its
  run remain in the log as evidence of what was true when it was approved.

---

## 6. The event log

Every mutation of the graph is an event. Current state is a fold of the log.

```ts
type Event = {
  id: string
  graphId: string
  nodeId: string          // an event is always addressed to an entity
  kind: EventKind
  actor: string           // a person or an agent
  at: string              // ISO 8601
  payload: unknown        // narrowed by kind
}

type EventKind =
  | "NodeCreated" | "IntentChanged"
  | "EdgeAdded" | "EdgeRemoved"
  | "RunStarted" | "RunProgressed" | "RunFailed" | "ArtifactProduced"
  | "GateDecided" | "NodeDeleted" | "SubtreeCollapsed"
```

Four things fall out of this mechanism for free:

- **Time.** The state at moment `T` is the fold up to `T`. The timeline in the
  interface needs no separate machinery.
- **Branching.** A fork is a new log beginning from a prefix of an existing one.
- **Audit.** Who did what is a property of the schema, not a subsystem.
- **Multiplayer, later.** Events are addressed to nodes, so work in different
  nodes does not conflict. Nothing else in the design has to change for it.

This replaces `store.Update(func(state *State))` from the old worker. Mutating a
whole snapshot under a file lock is what turns a canvas back into a queue.

### Ordering

Ordering within a single node is strict. Across nodes it is partial, and no
global order exists or is required.

That is a real constraint on the fold, not a slogan. It means the fold must
reach the same state for any valid interleaving of events from different nodes.
The one place this bites is `inputDigest`: if the fold recomputed it at the
moment `ArtifactProduced` is applied, the value would depend on whether an
upstream artifact happened to be folded first.

So **`inputDigest` is recorded in the `ArtifactProduced` payload** by whoever
produced it. The producer states which inputs it consumed; the fold only
records the claim. Order-independence follows.

Timestamps are advisory. Log order is authoritative. Clocks on two machines
cannot be compared, and a validation rule built on comparing them would have to
be removed the moment multiplayer arrives.

### Runs and gates

A run is created by `RunStarted`, advanced by `RunProgressed`, and ends at
either `RunFailed` or `ArtifactProduced`. Failure is its own event kind so that
"this run is over" is legible from the kind alone — the WS stream and every
subscriber downstream of it will need that.

A gate has no executor: a person supplies the artifact. `GateDecided` carries
`approve` or `reject`. Approval records an artifact and its digest, exactly as a
run would. Rejection is durable and distinct from silence — an undecided gate is
waiting, a rejected one has been answered, and the subtree stays blocked for
different reasons that the interface should not conflate.

Decisions and runs live in the folded state next to nodes and edges. Neither is
a field on `Node`: state is computed, and that rule has no exceptions.

### Rejected graphs

Invalid mutations are rejected where they are applied, so an invalid graph
cannot be constructed and then discovered later:

- cycles
- edges to or from nodes that do not exist
- duplicate edges between the same pair with the same aperture
- events addressed to a node that does not exist, or to the wrong graph

---

## 7. Context assembly

A separate module, because this is where the product's difference lives.

For a node `N`:

1. Collect the incoming edges.
2. `artifact` — inline the source's content, or the slice named by `selector`.
3. `reference` — **do not inline**; give the executor access as a tool: a
   repository path, a dataset descriptor.
4. `normative` — gather from the whole ancestor chain, deduplicate, and place
   as rules ahead of the intent.
5. Compute the budget and return the breakdown per edge alongside the context.

**Never truncate silently.** Exceeding the budget comes back as a state on the
node, and the person sees which edge costs what. Visible context is a promise
the product makes, not a diagnostic.

---

## 8. Execution

```ts
interface Executor {
  run(req: RunRequest, signal: AbortSignal): AsyncIterable<RunEvent>
}
```

Implementations:

- `command` — a deterministic shell step. **Built first**, because it is the
  cheapest way to prove the whole graph cycle works.
- `claude` — spawn the CLI, parse stream-json, resume sessions.
- `decision` — a gate; no execution, a person produces the artifact.

One run, one git worktree. Sibling branches get their own worktrees and compute
in parallel. The artifact of a derivation over a repository is a patch, applied
three-way on approval.

**This layer is ported from `worker/` literally, line for line.** Process spawn,
stream parsing, worktrees, patch application, killing process groups — there is
nothing to improve there and everything to break. The tests move first and
become the acceptance specification; the implementation follows until they pass.

---

## 9. What goes, what carries over

**Ported literally** — the most expensive thing that exists today:

- Claude CLI spawn, stream-json parsing, session resumption
- a git worktree per run, and cleanup after a crash
- three-way patch application, commits, dirty-tree handling
- process group termination
- **the tests for all of it, first, as the acceptance specification**

**Ported with rework:**

- `review`, `chat`, `intake`, `ui` — largely as they are
- `workspace` — from `tauri.invoke` to an HTTP/WS client
- `canvas` — onto the new graph model

**Deleted:**

- `app/src-tauri` — pass-through commands no scenario needs
- `worker/` — once its tests pass against `core`
- `edge.kind: "then"` — order is derived, not declared
- `store.Update(whole state)` — replaced by the event log
- stored node statuses — computed
- the `Mission` model and its lifecycle statuses — replaced by a node with
  computed state

**New:**

- edges as entities with apertures
- `context` as its own module
- `gate` and `group` as node kinds
- the event log, the fold, time and forking
- HTTP/WS as the only way into the core

---

## 10. Later, as separate decisions

**Multiplayer.** A coordinator holding the graph in Postgres, local workers
joined to it, presence over WS and outside the log. Each node runs on its
owner's machine with that person's credentials, so no shared secrets exist
anywhere and the coordinator sees intents, edges, decisions and diffs — never
keys, never code, never execution. Nothing in this document has to change for
that; it is a run mode, not a rewrite. It is deliberately not being built now.

**Desktop.** Electron around the same web client. A window, starting the server,
a tray icon, updates. A day or two, whenever it is actually wanted.

---

## 11. Order

In detail: [orbital-plan.md](orbital-plan.md). In short:

1. Pure domain — graph, edges, events, computed freshness
2. Persistence and API
3. Client on HTTP, Tauri shell deleted — **first demonstrable point**
4. A minimal shell-command executor — **the full cycle proven**
5. Context assembly — apertures become real
6. The Claude executor — tests first, translation literal
7. Gates, groups, the canvas at scale
8. Replace `main`, release 0.0.3
