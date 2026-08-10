# Orbital — Target Architecture

Where the codebase is going: a canvas of derivations, executed locally, written
in one language.

Implementation order is in [orbital-plan.md](orbital-plan.md). The decisions
this document was written from, with their reasoning, are in
[decisions.md](decisions.md) — read that when a choice here looks arbitrary.

---

## 1. The change everything follows from

Today a node is a chat with an agent. It owns a conversation, a session and a
lifecycle status. Two nodes working on the same repository know nothing about
each other, and the canvas is a layout of transcripts.

The new unit:

> **A node is a derivation: `intent + inputs -> artifact`.**

Not an agent, not a conversation. It is a claim that some artifact follows from
an intent applied to named inputs.

The point of that claim is not reproducibility — a language model will not
reproduce anything. It is that the system knows **what each piece of work was
built on**, and can therefore tell you when the ground moved. Orbital already
hands an upstream mission's summary and diff to its downstream ones. Today,
re-running the upstream leaves the downstream silently holding a diff that no
longer exists. Nothing reports it, because nothing records what was consumed.
That record is `inputDigest`, and it is the whole reason for the model.

A second decision, load-bearing for what comes later:

> **The graph is shared state. Execution is not.**

Small state — intents, edges, decisions, artifact references — lives in an event
log. Large state — repositories, worktrees, Claude sessions, processes — never
leaves the machine it was made on and is addressed only by identifier.

Orbital is single-player today. That separation is the only reason multiplayer
can stay a later decision rather than a rewrite.

### Runs, and how a node is steered

A conversation belongs to a **run** and is evidence, not identity. But a run is
not one attempt:

> **A run is a session.** One Claude session id, many process invocations, and
> potentially several artifacts over its life.

This matches how the CLI actually works — the process exits after each turn and
you return with `--resume <session-id>` — and it preserves the interaction the
product is built around. Two operations, both explicit in the interface:

| | What it does |
|---|---|
| **Continue** | Resumes the run's session with a new message. The agent keeps everything it learned. Produces a new artifact on the same run. **The default verb.** |
| **Re-run** | A new run, fresh session, same intent. |

Typing *"no, use CSS grid instead"* into a finished node is Continue. It is why
a node beats a chat window, and it is not a special case bolted onto the
derivation model — it is the model's ordinary path.

`running` means a process is alive right now. That is a different question from
whether the run is over, and `ArtifactProduced` does not end a run.

**Corrections do not enter the digest.** A follow-up message changes neither the
intent nor the inputs, so the node stays `fresh` — correct, because the digest
answers "have my inputs moved", never "is this reproducible". The cost is that
Re-run discards corrections. Accepted; no mechanism for promoting a correction
into the intent until that loss is actually felt.

Everything below follows from these two sections.

---

## 2. One language

Three runtimes cost more than they return: a Go worker, a Rust shell and a
TypeScript client mean three toolchains, three test runners, three dependency
graphs and three places for the same bug to hide. The split was never a design
choice — it accumulated.

The target is TypeScript end to end:

- `worker/` (Go) is ported into `apps/server` and `packages/domain`, and deleted
- `app/src-tauri` (Rust) is deleted outright — eighteen pass-through commands
  that no scenario needs
- the desktop shell becomes Electron, later, wrapped around the same web client

The client is a web application. It talks to the server over tRPC, so it runs
identically in a browser tab and inside Electron. The shell stays thin: a
window, a server process, a tray icon, updates.

### Repo layout

The shape follows [t3code](https://github.com/pingdotgg/t3code) — an agent
harness control surface across mobile, web and Electron, which is the same kind
of product as Orbital rather than a web-app scaffold. A pnpm workspace:

```
apps/
  web/                  React client (Vite)
    canvas/  chat/  review/  intake/  shell/  ui/
  server/               the long-lived Node process
    api/
      routers/          node.ts · edge.ts · run.ts · graph.ts
      root.ts · trpc.ts
    context/  scheduler/  artifacts/
    executor/           command/ · claude/
    db/                 index.ts · schema.ts
    env.ts
    index.ts            the process entry
  desktop/              Electron — later
packages/
  domain/               graph · eventlog — pure
  contracts/            AppRouter type + schemas, shared by every client
tooling/
  oxlint-plugin-orbital/
docs/  scripts/  .plans/
```

There is no `core/`. A directory named for what it excludes has no principle for
what belongs in it, which is how three runtimes accumulated in the first place.

The split is load-bearing in three places. `packages/domain` makes §4's purity
rule **structural** — it cannot import the executor, because the executor is not
one of its dependencies, so the code does not compile rather than failing a lint
pass. `packages/contracts` keeps `apps/web` from ever importing `apps/server`,
which is what makes a workspace rot. And `apps/desktop` is a place Electron
goes, rather than a change to how everything is built.

`context` stays in `apps/server`: only `graph` and `eventlog` are declared pure,
and context reads artifact content and counts budget.

`apps/server` is a long-lived process, not a request handler — it holds
worktrees, Claude sessions and the scheduler across requests, and under Electron
it becomes the main process with `apps/web` as the renderer.

### What this costs, deliberately

A cheaper arrangement was considered and rejected: keep the Go executor behind
the CLI/JSON seam that already exists and works, and write only the domain in
TypeScript. That would have left untouched exactly the code §8 promises not to
improve. It was rejected because it does not deliver one language, and because
the domain model is worth sharing with the client — the client can import it and
fold the log locally for optimistic canvas updates, which a Go core cannot give.

The costs are real and are work items, not objections:

- Distribution loses the single static binary. Electron will need a bundled
  runtime — `bun build --compile`, Node SEA, or shipping Node.
- Worktree management and patch application still move by hand. §9 and the
  plan's phase 6 exist to contain that.

Two costs an earlier draft listed have largely evaporated, and for a reason
worth recording: the Claude Agent SDK (§8) is TypeScript/Python only. It owns
process spawn, stream parsing, session resumption and termination — so the
hand-conversion of the layer that must not change, and Node's weaker process
control, are both mostly moot. **A Go worker could never have used it.** The
decision to move everything is what makes the SDK available.

Until Electron exists, Orbital is a browser tab on `localhost`. The installer
and release pipeline stay frozen at v0.0.2 and testers stay on the old build.
That is a choice, taken knowingly.

---

## 3. Layers

```
┌──────────────────────────────────────────────────────┐
│  Client (React + TypeScript)                         │
│  canvas · node panel                                 │
│  an ordinary web app; runs in a tab                  │
└───────────────┬──────────────────────────────────────┘
                │  tRPC — queries and mutations, subscriptions for the
                │  event stream. One contract, inferred on the client.
┌───────────────▼──────────────────────────────────────┐
│  apps/server + packages/domain (TypeScript, Node)    │
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
│  window · starts the server · tray · updates         │
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
| `api` | tRPC routers, subscription streams | know graph semantics |

`graph` and `eventlog` are pure: no `fs`, no `net`, no `child_process`. They are
the only place the semantics live, and they must be testable without a
filesystem, git or a network. This is enforced by a lint rule, not by good
intentions.

---

## 5. The graph model

### Node

```ts
type NodeKind = "source" | "derivation" | "watcher"

type Node = {
  id: string
  graphId: string
  kind: NodeKind
  title?: string         // short, for the card; extraction already produces one
  intent: string

  requiresApproval: boolean
  artifactId: string     // a reference into artifacts, never the content
  inputDigest: string    // the digest of the inputs the artifact was made from
  runId?: string         // the most recent run
}
```

| Kind | What it is |
|---|---|
| `source` | an input the graph does not compute — a repository, a document, a dataset, or a human decision |
| `derivation` | computed by an executor from its intent and inputs |
| `watcher` | re-examines a source and updates it when it moves |

There is no `gate` kind. A gate is `requiresApproval` on a derivation: an
unapproved or rejected artifact is not available to consumers, so the subtree
below it is `blocked` through the ordinary rule and no second node has to exist
to express a boolean. A standalone human decision — *"Postgres or SQLite?"* — is
already a `source`, which is exactly what a source is: an input the graph does
not compute.

There is no `group` kind either. Groups are a view; see §5.5.

`title` is optional but present in the domain because extraction already
produces `{title, text}` and discarding it was a bug that had to be fixed once
already.

There is no `owner` field. Who owns a node is the `actor` on its `NodeCreated`
event; storing it separately would be the same mistake as storing status.

### Artifacts

```ts
type ArtifactKind = "patch" | "document" | "summary" | "decision"
```

The kind is not decoration. A patch, a plan document, a run summary and a human
decision each inline differently into a consumer's context, and §7's per-edge
budget breakdown cannot be computed without knowing what an edge carries.

Repositories are not in the list. They are never inlined, only referenced.

### State is computed, never stored

An input counts as **available** when it has an artifact and, where approval is
required, has been approved.

```
running  : a process is alive for the current run
failed   : the last run failed
blocked  : an input is not available
empty    : artifactId === ""
rejected : the artifact was rejected
pending  : an artifact exists, approval is required and undecided
stale    : artifactId !== "" && inputDigest !== currentDigest(node)
fresh    : artifactId !== "" && inputDigest === currentDigest(node)
```

Those conditions overlap, so precedence is part of the definition:

```
running > failed > blocked > empty > rejected > pending > stale > fresh
```

Two facts about this table matter more than the table.

**`blocked` and `stale` split on different questions.** `blocked` means *my
input does not exist* — the parent is empty, failed, or its artifact was
rejected. `stale` means *my input existed, I consumed it, and it has since
changed*. The first cannot run. The second can, and its existing artifact is
still valid evidence of what was true when it was approved. An earlier draft
defined `blocked` as "an ancestor is not fresh", which swallowed `stale`
entirely and hid the only signal worth having.

**`blocked` needs no ancestor walk.** Unavailability propagates on its own: if
the grandparent is empty, the parent cannot run, so the parent has no artifact,
so the child is blocked. A rejected artifact blocks its whole subtree by the
same mechanism. You walk upward only to *name the reason* for a person, never to
compute the state.

`blocked` and `stale` both carry reasons, because "you cannot run this" and "a
person said no" are different facts to put in front of a user, and so are
"your foundation moved" and "policy changed":

```
blocked : unavailable-input | rejected-input | undecided-approval
stale   : input-changed | rule-changed
```

Computing state instead of storing it removes an entire class of bug: flags that
drift out of agreement with the graph they describe.

### There is no staleness wave

A stale parent still holds the artifact its child consumed. Its inputs moved;
the child's did not. **Staleness does not propagate transitively.** It moves
exactly one hop, and only when a parent actually re-runs and produces a
different artifact.

Re-run A and B goes stale. Re-run B and C goes stale. The canvas shows the
**frontier** of what needs attention, not the whole cone below a change. This is
the difference between a signal a person reads and a colour they learn to
ignore.

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

`normative` contributing to **every descendant's** digest is equally deliberate,
and is not in tension with the one-hop rule above. Inheritance inlines the rule
into each descendant (§7, step 4), so each one is a *direct* consumer. Twenty
nodes going stale from a rule edit is one hop from a rule with twenty consumers,
not a wave — and it is true. Excluding it would make `inputDigest` lie about
what was consumed, which is the one thing it must never do.

That twenty-node change is legible because `stale` carries `rule-changed`, and
the canvas renders a policy change differently from a foundation that moved.

### 5.5 Groups are a view

A group has no intent, no artifact and no digest, because *"what is a group's
artifact?"* has no answer — its members', but which one? So a group is a
collapsible box on the canvas and nothing in the domain: edges always connect
real nodes, and collapsing renders its members' external edges on the box.

Group membership and pinned node positions are **view state**. They belong in a
store beside the event log, never in it — the log is the record of what the
graph means, not of how it was arranged on a screen.

The cost of this is that a group cannot be run as a unit. That is `Run all`,
which was deleted at 61b3a18.

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
  whether the change matters. There is no `make` in this system, and §8's
  watcher does not create one.
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
  | "NodeCreated" | "IntentChanged" | "NodeDeleted"
  | "EdgeAdded" | "EdgeRemoved"
  | "RunStarted" | "MessageSent" | "RunProgressed"
  | "ArtifactProduced" | "RunFailed"
  | "ApprovalDecided"
```

`actor` earns its place today, single-player: whether you or the agent changed
an intent is a question you will ask.

Four things fall out of this mechanism for free:

- **Time.** The state at moment `T` is the fold up to `T`. The timeline in the
  interface needs no separate machinery.
- **Branching.** A fork is a new log beginning from a prefix of an existing one.
  Not designed for, not designed against.
- **Audit.** Who did what is a property of the schema, not a subsystem.
- **Multiplayer, later.** Events are addressed to nodes, so work in different
  nodes does not conflict. Nothing else in the design has to change for it.

This replaces `store.Update(func(state *State))` from the old worker. Mutating a
whole snapshot under a file lock is what turns a canvas back into a queue.

### Ordering

Ordering within a single node is strict. Across nodes it is partial.

The fold must therefore reach the same state for any valid interleaving of
events from different nodes. The one place this bites is `inputDigest`: if the
fold recomputed it at the moment `ArtifactProduced` is applied, the value would
depend on whether an upstream artifact happened to be folded first.

So **`inputDigest` is recorded in the `ArtifactProduced` payload** by whoever
produced it. The producer states which inputs it consumed; the fold only records
the claim. Order-independence follows.

This is right regardless of multiplayer — a fold whose result depends on
evaluation order is a fold with a bug in it. Multiplayer is not the
justification, only a later beneficiary.

Timestamps are advisory. Log order is authoritative. Clocks on two machines
cannot be compared, and a validation rule built on comparing them would have to
be removed the moment multiplayer arrives.

### Runs and approvals

A run is created by `RunStarted` and carries a session id. `MessageSent`
records a person's turn, `RunProgressed` the agent's. `ArtifactProduced`
records an artifact **without ending the run** — a run may produce several. Only
`RunFailed` ends one, and it is its own kind so that "this run is over" is
legible from the kind alone; the subscription and every subscriber downstream of it
will need that.

A run is superseded by the next `RunStarted` on the same node. There is no
explicit end event, because a session that is merely idle is not finished.

`ApprovalDecided` carries `approve` or `reject` against a node's artifact.
Rejection is durable and distinct from silence — an undecided artifact is
`pending`, a rejected one has been answered, and the subtree below is blocked
for reasons the interface must not conflate.

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
2. `artifact` — inline the source's content, or the slice named by `selector`,
   formatted according to its `ArtifactKind`.
3. `reference` — **do not inline**; give the executor access as a tool: a
   repository path, a dataset descriptor.
4. `normative` — gather from the whole ancestor chain, deduplicate by edge id,
   and place as rules ahead of the intent.
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
- `claude` — the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`).

One run, one git worktree. Sibling branches get their own worktrees and compute
in parallel. The artifact of a derivation over a repository is a patch, applied
three-way on approval.

### Why the SDK rather than a port

The SDK is Claude Code published as a TypeScript library. It spawns the `claude`
CLI internally, bundling a per-platform binary — a first-party, maintained
version of what `worker/` does by hand:

| `worker/` today | Agent SDK |
|---|---|
| spawn the CLI, manage the process | the SDK owns it |
| parse stream-json to a lossy `(kind, string)` | `query()` → async generator of typed `SDKMessage`, including tool **results** |
| `--resume <id>` plumbing | `resume`, `continue`, `forkSession`, `resumeSessionAt` |
| `syscall.Kill(-pgid)` | `query.interrupt()` / `close()` |
| worktree path handed to the process | `cwd` |
| approve/reject gate | `permissionMode` + `canUseTool` |

`query()` returning an async generator is the `Executor` interface above,
already. And the SDK is TypeScript/Python only — a Go worker could never have
used it, so §2's decision is what makes this available at all.

**What remains Orbital's own**, and is still ported carefully: worktrees and
their cleanup after a crash, three-way patch application, dirty-tree handling.
That layer is deterministic, and §9 describes the safety net for it.

### Watchers

A watcher observes a `source`. When the source moves, the watcher updates that
source's artifact, and downstream `artifact` edges go stale by the ordinary
one-hop rule.

**A watcher never starts a run.** It introduces no new execution semantics at
all — it is a producer of source artifacts, and everything after that is the
existing model. "Nothing runs unasked" survives, and nothing spends money
overnight producing diffs no one requested. If auto-run is ever wanted, it is a
flag on the watcher, not a redesign.

---

## 9. What goes, what carries over

**Ported carefully** — what the Agent SDK does not cover:

- a git worktree per run, and cleanup after a crash
- three-way patch application, commits, dirty-tree handling

Claude CLI spawn, stream parsing, session resumption and process termination are
**not ported at all** — the SDK owns them (§8).

### The safety net

The Go suite is 4,695 lines and each line is a bug someone already caught. It
cannot be *ported*: Go tests test Go code, so they can only be re-authored by
hand — and a mis-translated test **passes while asserting nothing**. A green
suite that proves less than you believe is the worst outcome available here.

So the acceptance specification is behavioural instead:

- **A recorded scenario suite.** Fixture repositories driven through the 19 CLI
  commands with `local_command_worker`, which is deterministic, capturing
  `status --json` at every step. Recorded against the Go binary, replayed
  against `core`, diffed. Nothing is copied by hand: the assertion *is* the
  recording.
- **Ordinary unit tests** for `graph`, `eventlog`, `context` — new code with no
  old behaviour to compare against.

An earlier draft added stream-json fixtures to protect a hand-written parser.
There is no hand-written parser; that limb is dropped.

Volatile fields — ids, timestamps, temporary paths — are normalised before
diffing. Non-deterministic Claude runs are out of reach of this technique, which
is why the deterministic git/patch/worktree machinery is what it covers: the
part that is both scary and reproducible.

**The recordings must be captured while `worker/` still runs.** Delete it first
and the reference is gone permanently, along with any ability to answer whether
the new thing does what the old one did.

**Ported with rework:**

- `review`, `intake`, `ui` — largely as they are
- `chat` — reworked against the new run model, where a run is a session that
  may produce several artifacts
- `workspace` — from `tauri.invoke` to tRPC procedures and subscriptions
- `canvas` — onto the new graph model

**Deleted:**

- `app/src-tauri` — pass-through commands no scenario needs
- `worker/` — after the scenario suite is green and 0.0.3 has been used for a
  week, in its own commit, not as part of the release
- `edge.kind: "then"` — order is derived, not declared
- `store.Update(whole state)` — replaced by the event log
- stored node statuses — computed
- the `Mission` model and its lifecycle statuses — replaced by a node with
  computed state

**New:**

- edges as entities with apertures
- `context` as its own module
- `watcher` as a node kind; approval as a flag
- the event log, the fold, time and forking
- tRPC as the only way into the server — one contract, written once, with the
  client's types inferred from it rather than copied across the wire

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

**Automation.** The pull toward n8n-shaped triggers has now recurred several
times, and a watcher that starts runs is its smallest form. It is deliberately
not smuggled in here: if automation is the destination, that changes what the
canvas is for, and it deserves its own decision rather than a table row in a
rewrite.

**Other agents.** The Agent Client Protocol standardises editor↔agent
communication so one client can drive any agent — Codex, Cursor, Gemini. That is
the shape of a real answer to *"I do basically the same in Orbital and Claude
Code"*: a control surface for several agents is something a single chat window
structurally cannot be. It is also a change to what Orbital is, so it sits here
rather than in §8. `Executor` is an interface; ACP would be a third
implementation beside `command` and `claude`, and nothing above has to change
for it.

**Concurrency as the product.** Orbital's one structural advantage over a chat
window — a worktree per run, N missions at once — has never actually been
exercised. The plan does not answer that question and does not pretend to.

---

## 11. Order

In detail: [orbital-plan.md](orbital-plan.md). In short:

1. Pure domain — graph, edges, events, computed freshness
2. Persistence and API
3. A minimal shell-command executor — **the model is proven or it is not**
4. Client on tRPC, Tauri shell deleted — first demonstrable point
5. Context assembly — apertures become real
6. The Claude executor — recorded behaviour first, translation literal
7. Parity — the rest of the 19 commands, the gate, branches, diffs, transcript
8. Watchers, groups, the canvas at scale
9. Replace `main`, release 0.0.3
