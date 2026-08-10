# Orbital — Migration Plan

A companion to [orbital-architecture.md](orbital-architecture.md). That document
describes **what** is being built; this one describes **in what order**.

Two principles hold the sequence together.

**A vertical slice as early as possible.** Every phase ends in something that can
be run and shown. Not "the domain layer is finished", but "I created a node, it
ran, and its child went stale."

**Tests ahead of implementation wherever code is being carried over.** There are
4,695 lines of tests in `worker/`, and each one is a bug someone already caught.
That is the single most valuable asset in this rewrite. Ported tests become the
acceptance specification.

Work happens on the `next` branch.

---

## Phase 0 — Preparation

**Goal:** a branch and a skeleton, so infrastructure stops being a distraction.

- `next` branched from `main`
- the architecture document and this plan committed first
- `core/` skeleton: TypeScript strict, vitest, no `any`, a lint rule forbidding
  `fs` / `net` / `child_process` so purity is enforced rather than hoped for
- `scripts/check.sh` gains a second gate: the existing Go tests **and** the new
  TypeScript ones

`worker/` is not touched. It remains the reference until the very end.

**Done when:** CI is green on both gates and an empty `core/` builds.

---

## Phase 1 — The pure domain

**Goal:** the graph model and the event log, with no I/O whatsoever.

- node kinds: `source | derivation | gate | group | watcher`
- edges as entities, with the `artifact | reference | normative` apertures
- the input digest, and state computed from it —
  `fresh / stale / empty / running / blocked / failed`
- the event log, the fold, folding to a moment in time, forking a branch
- explicit rejection of invalid graphs: cycles, edges to missing nodes,
  duplicates

**Done when:** tests cover every state in the table, staleness propagation
through each aperture, normative inheritance down a subtree, and fold
determinism. No test touches the filesystem.

**Risk:** the temptation to add the scheduler and the store "while we're here".
Do not. This layer has to stay pure permanently — everything else rests on it.

---

## Phase 2 — Persistence and the API

**Goal:** state survives a restart, and the client has something to connect to.

- a `store` interface, implemented on SQLite
- the event log written incrementally — **not** by rewriting a whole snapshot
- HTTP for commands and queries
- WS for the event stream
- snapshots, so folding stays fast

**Done when:** nodes and edges can be created over HTTP, WS delivers the event
stream, and state after a restart is identical.

There is still no execution. That is deliberate.

---

## Phase 3 — Client on HTTP, shell deleted

**Goal:** the first version that can be put in front of a person.

- `app/src/workspace` stops using `tauri.invoke` and talks HTTP/WS
- `app/src/canvas` moves to the new model: node kinds, edge apertures, computed
  state
- `app/src-tauri` is deleted
- `core` serves the client on `localhost`

**Done when:** you open a browser tab, see the canvas, create nodes and edges,
and watch state update live. The desktop shell no longer exists.

**This is the first demonstrable point.** Show it to a person who has never seen
Orbital, before anything executes, and watch in silence whether the canvas reads
without a briefing. That test is much cheaper here than after phase 6.

A side effect: the development loop gets faster — hot reload and devtools
instead of rebuilding Tauri.

---

## Phase 4 — Minimal execution

**Goal:** prove the full product cycle the cheapest way possible.

- an executor behind the interface, with one implementation: a **shell command**
  (the analogue of `local_command_worker`, the simplest thing in `worker/`)
- a minimal scheduler: which nodes are runnable, dispatch, cancellation
- the artifact is stored and `inputDigest` is recorded

**Done when:** you create a node → it runs → an artifact appears → you change an
input → its child becomes `stale` and that is visible on the canvas.

**This is the most important phase in the plan.** It is the first time the whole
construction — derivations, apertures, computed freshness — is tested as a
working thing. If the model is wrong somewhere, it surfaces here, while fixing
it is still cheap.

---

## Phase 5 — Context assembly

**Goal:** apertures become real rather than declarative.

- `artifact` inlines content, `reference` grants access, `normative` is gathered
  from the whole ancestor chain and deduplicated
- the budget is computed and returned to the client, broken down per edge
- **never truncate silently** — exceeding the budget comes back as node state

**Done when:** the node panel shows what each edge costs and the total budget.

This is the product's differentiator. Before this phase Orbital is a good
canvas; after it, it is the only tool where context is controlled by topology.

---

## Phase 6 — The Claude executor

**Goal:** carry over the most expensive thing without losing any of it.

**The order inside this phase is mandatory:**

1. First port the tests from `worker/`: `claude_agent_worker_test`,
   `claude_api_test`, `agent_run_test`, `patch_3way_test`,
   `patch_dirty_tree_test`, `apply_worktree_test`, `worktree_test`,
   `spawn_child_run_test`
2. Then the implementation, until every ported test is green

**Translate literally.** CLI spawn, stream-json parsing, session resumption, a
git worktree per run, three-way patch application, process group termination.
There is nothing to improve here — only an opportunity to reintroduce bugs that
have already been fixed once.

**Done when:** the ported suite is green, a node really runs Claude and returns
a diff, and the patch applies on approval.

**The highest risk in the plan.** Node's process model is different: signals,
process groups, cleaning up worktrees after a crash. Budget more time here than
seems reasonable.

---

## Phase 7 — Gates, groups, the canvas

**Goal:** the reason for having a graph at all.

- `gate`: a human decision blocks descendants structurally
- `group`: a subtree collapsed into a single node, fractally
- computed layout, with positions stable between recalculations
- the staleness wave made visible
- a timeline over folding-to-a-moment

**Done when:** the canvas stays readable at a hundred nodes, and changing an
input visibly colours everything it will touch.

---

## Phase 8 — Replacement

- `git tag v0.0.2-legacy` on the current `main`
- delete `worker/` in a single commit
- `next` replaces `main` — a replacement, not a merge
- release `0.0.3`
- the installer and the release pipeline switch over last

---

## Afterwards, as separate decisions

**Multiplayer.** Coordinator mode, `sync`, presence, identity on nodes. A run
mode rather than a rewrite — the architecture already holds it.

**Desktop.** Electron around the same web client. A window, starting the server,
a tray icon, updates. Done when it is actually needed; a day or two.

---

## `main` stays alive in parallel

While `next` is in progress the public branch must not go quiet. That is the one
genuinely bad signal for anyone who looks.

Small fixes, documentation, answers in issues. Nothing needs inventing — it is
enough that the repository looks worked on.

---

## Checkpoints

**After phase 3** — the first outside check. Show it to someone who has never
seen Orbital and say nothing.

**Two weeks in** — an honest question: does the new thing do what the old one
did? If not, that is not a failure, it is data about the real size of the job.
Adjust the estimate, not the plan.

---

## On timelines

Phases 0–4 are the parts that come quickly: pure logic, types, HTTP, a simple
executor.

Phase 6 is a different kind of work. Processes, signals, streaming edge cases,
cleanup after crashes. That is not written, it is debugged, and it is where the
time actually goes.

So do not plan an overall date. Plan as far as phase 4. After it you will have a
working system and real data about your own speed.
