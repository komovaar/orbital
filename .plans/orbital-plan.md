# Orbital — Migration Plan

A companion to [orbital-architecture.md](orbital-architecture.md). That document
describes **what** is being built; this one describes **in what order**. The
reasoning behind both is in [decisions.md](decisions.md).

Three principles hold the sequence together.

**Prove the model before building against it.** The graph model is the bet. It
can be proven headless — a script that creates a node, runs a shell command,
changes an input and asserts the child went stale. Nothing is rebuilt on top of
it until that script is green.

**A vertical slice as early as possible.** Every phase ends in something that can
be run and shown. Not "the domain layer is finished", but "I created a node, it
ran, and its child went stale."

**Recorded behaviour ahead of implementation wherever code is carried over.**
The 4,695 lines of Go tests cannot be ported — Go tests test Go code, and a
hand-translated test that loses an assertion still passes. What carries over is
the *behaviour*, captured as recordings while the old worker still runs.

Work happens on the `next` branch.

---

## What this plan does not do

Two things, stated so they are not later mistaken for oversights.

**It does not answer whether the graph is worth having.** The measured usage —
20 missions ever, never two at once, almost all of it cosmetic polish on
Orbital's own chrome — says the value so far has been *tracking*, not topology.
The agreed experiment for that question (never fewer than three missions in
flight; and a flat-list comparison) costs roughly nothing in engineering and is
**deferred, not answered**. The earliest honest point to run it is after phase 6,
when the Claude executor works again.

**It does not keep Orbital installable.** From phase 4 to Electron, Orbital is a
browser tab. The installer and release pipeline stay at v0.0.2.

---

## Phase 0 — Preparation

**Goal:** a branch, a skeleton, and a recording of how the current system
behaves — so infrastructure and the reference both stop being distractions.

- `next` branched from `main`
- the architecture document, this plan, and `decisions.md` committed first
- the workspace established: `pnpm-workspace.yaml`, `tsconfig.base.json`, and
  **`app/src/*` moves to `apps/web/*` now**, while the client is still
  untouched, so the phase 4 rewrite lands in its final location rather than
  being followed by a second reshuffle
- `apps/server` and `packages/domain` skeletons: TypeScript strict, vitest, no
  `any`. `packages/domain` depends on nothing that can do I/O, so purity is
  structural; `tooling/oxlint-plugin-orbital` backs it up with a rule forbidding
  `fs` / `net` / `child_process`
- `scripts/check.sh` gains a second gate: the existing Go tests **and** the new
  TypeScript ones
- **the scenario recordings are captured** — fixture repositories driven through
  the CLI with `local_command_worker`, `status --json` captured at every step,
  volatile fields normalised. No stream-json fixtures — the Agent SDK parses
  the stream, so there is no hand-written parser to protect.

`worker/` is not touched. It remains the reference until the very end.

**Done when:** CI is green on both gates, the relocated client still builds and
runs, empty `apps/server` and `packages/domain` build, and the recordings replay identically
against the Go binary twice in a row.

**Why the recordings come first:** they can only be made while the old worker
runs. Everything after this phase is measured against them.

---

## Phase 1 — The pure domain

**Goal:** the graph model and the event log, with no I/O whatsoever.

- node kinds: `source | derivation | watcher`; approval as a flag
- edges as entities, with the `artifact | reference | normative` apertures
- artifact kinds: `patch | document | summary | decision`
- the input digest, and state computed from it — `running / failed / blocked /
  empty / rejected / pending / stale / fresh`, with reasons on `blocked` and
  `stale`
- the event log, the fold, folding to a moment in time, forking a branch
- explicit rejection of invalid graphs: cycles, edges to missing nodes,
  duplicates

**Done when:** tests cover every state in the table, every precedence pair, the
one-hop staleness rule (including that a *stale* parent does not stale its
child), normative inheritance and dedup down a subtree, approval blocking a
subtree, and fold determinism under reordered cross-node events. No test touches
the filesystem.

**Risk:** the temptation to add the scheduler and the store "while we're here".
Do not. This layer has to stay pure permanently — everything else rests on it.

**Note on where this already stands:** the scaffolded `core/src/graph` and
`core/src/eventlog` total roughly a thousand lines with **no tests**, and they
predate every decision in `decisions.md`. They move to `packages/domain` as a
sketch to be revised, not a foundation to extend. Let the tests lead.

---

## Phase 2 — Persistence and the API

**Goal:** state survives a restart, and there is something to connect to.

- a `store` interface, implemented on SQLite
- the event log written incrementally — **not** by rewriting a whole snapshot
- a separate table for view state: group membership, pinned node positions
- tRPC: `server/api/routers/*` for queries and mutations, subscriptions for the
  event stream, with the client's types inferred rather than declared
- snapshots, so folding stays fast

**Done when:** nodes and edges can be created through tRPC procedures, a
subscription delivers the event stream, renaming a field on the server breaks
the client's build, and state after a restart is identical.

There is still no execution, and still no client. That is deliberate.

---

## Phase 3 — Minimal execution

**Goal:** prove the whole product cycle the cheapest way possible, with no
interface at all.

- an executor behind the interface, with one implementation: a **shell command**
  (the analogue of `local_command_worker`, the simplest thing in `worker/`)
- a minimal scheduler: which nodes are runnable, dispatch, cancellation
- the artifact is stored and `inputDigest` is recorded in `ArtifactProduced`
- Continue and Re-run both exercised, since the shell executor has no session
  the distinction can still be modelled and asserted

**Done when:** a script creates a node, runs it, produces an artifact, changes an
input, and the child reports `stale` with reason `input-changed` — and a change
to a normative rule reports `rule-changed` across the subtree while a *stale*
parent leaves its child alone.

**This is the most important phase in the plan.** It is the first time
derivations, apertures and computed freshness are tested as a working whole. If
the model is wrong, it surfaces here, before anything has been built on top of
it — which is the entire reason it now comes before the client.

---

## Phase 4 — Client on tRPC, shell deleted

**Goal:** the first version that can be put in front of a person.

- `apps/web/workspace` stops using `tauri.invoke` and calls tRPC procedures
- `apps/web/canvas` moves to the new model: node kinds, edge apertures, computed
  state with its reasons, groups as collapsible boxes
- `app/src-tauri` is deleted
- the server serves the client on `localhost`

**Done when:** you open a browser tab, see the canvas, create nodes and edges,
run a shell derivation and watch state update live. The desktop shell no longer
exists.

**This is the first demonstrable point** — and unlike the earlier draft of this
plan, it demonstrates something that runs. Show it to a person who has never seen
Orbital and watch in silence whether the canvas reads without a briefing.

A side effect: the development loop gets faster — hot reload and devtools
instead of rebuilding Tauri.

---

## Phase 5 — Context assembly

**Goal:** apertures become real rather than declarative.

- `artifact` inlines content formatted by its kind, `reference` grants access,
  `normative` is gathered from the whole ancestor chain and deduplicated
- the budget is computed and returned to the client, broken down per edge
- **never truncate silently** — exceeding the budget comes back as node state

**Done when:** the node panel shows what each edge costs and the total budget.

This is the product's differentiator. Before this phase Orbital is a good
canvas; after it, it is the only tool where context is controlled by topology.

Its real value cannot be judged until phase 6 — assembly against a shell
executor can be verified as correct, but not as *good*.

---

## Phase 6 — The Claude executor

**Goal:** run Claude for real, without re-implementing what is already a library.

**Use `@anthropic-ai/claude-agent-sdk`.** It is Claude Code as a TypeScript
library, spawning the `claude` CLI internally. `query()` returns an async
generator of typed `SDKMessage` — which *is* the `Executor` interface — and it
already owns process management, stream parsing, session resumption (`resume` /
`continue` / `forkSession`), cancellation (`interrupt()`), the working directory
(`cwd`, pointed at the run's worktree), and the approval gate (`permissionMode`,
`canUseTool`).

**What is still carried over by hand**, and where the care goes:

- a git worktree per run, and cleanup after a crash
- three-way patch application, commits, dirty-tree handling

The phase-0 recordings are the specification for exactly that layer.

**Done when:** the scenario recordings replay green against the new server, a
node really runs Claude and returns a diff, Continue resumes a session through
the SDK, and the patch applies on approval.

**This is no longer the plan's highest risk.** The process model was the danger,
and the SDK owns it. What remains — worktrees, patches, crash cleanup — is
deterministic and covered by the recordings. Phase 7 is now the phase most likely
to be underestimated.

---

## Phase 7 — Parity

**Goal:** the new thing does what the old one did. This phase exists because
without it a rewrite reaches "done" while quietly doing less.

The CLI surface — four of these are covered by earlier phases, the rest have to
be built somewhere and this is where:

```
approve  reject  start-run  send-message  status        (phases 3–6)
delete   edit-mission  link  unlink  open  queue  show  history  models
amend    push  git-sync  branches  switch-branch
```

The client surface:

- the commit gate — message, amend, push
- branch, landed commit, and the hash chip on cards
- the diff file rail with per-file navigation
- the agent transcript on the new run model, including reasoning and tool
  outcomes
- the model picker that parses the installed `claude` binary rather than a
  hardcoded list
- keybindings and the resizable panel

**Done when:** every recorded scenario is green and the checklist above is
walked, item by item, against the running app.

---

## Phase 8 — Watchers, groups, the canvas

**Goal:** the reason for having a graph at all.

- `watcher`: observes a source, updates its artifact when it moves, never starts
  a run
- `group`: a collapsible box over member nodes, membership in view state, edges
  always between real nodes
- computed layout, with positions stable between recalculations
- the staleness **frontier** made visible — one hop, with `input-changed` and
  `rule-changed` rendered differently
- a timeline over folding-to-a-moment

**Done when:** the canvas stays readable at a hundred nodes, and changing an
input visibly marks exactly what it touched — no more, no less.

---

## Phase 9 — Replacement

- `git tag v0.0.2-legacy` on the current `main`
- `next` replaces `main` — a replacement, not a merge
- release `0.0.3`
- the installer and release pipeline switch over once Electron exists

**`worker/` is not deleted in this phase.** It stays until 0.0.3 has been used
for a week on real work, then goes in its own commit. Recovering from a tag while
your only tool is broken is not a rollback plan; having the old worker still in
the tree is.

**Rollback, concretely:** until that deletion commit, `v0.0.2-legacy` builds and
runs from the same tree. After it, rollback is the tag plus a rebuild, and that
is an accepted and deliberate one-way door.

---

## Afterwards, as separate decisions

**Desktop.** Electron around the same web client. A window, starting the server,
a tray icon, updates, and a bundled runtime. Done when it is actually needed.

**Multiplayer.** Coordinator mode, `sync`, presence, identity on nodes. A run
mode rather than a rewrite — the architecture already holds it.

**Automation.** Watchers that start runs. Deliberately not in this plan; see the
architecture document's §10.

---

## `main` stays alive in parallel

While `next` is in progress the public branch must not go quiet. That is the one
genuinely bad signal for anyone who looks.

Small fixes, documentation, answers in issues. Nothing needs inventing — it is
enough that the repository looks worked on. Watch for version skew between a
hot-reloaded frontend and a cached worker binary; that has bitten once already.

---

## Checkpoints

**After phase 3** — the model checkpoint, and the cheapest possible off-ramp. The
graph either did something useful headless or it did not, and nothing has been
built on it yet.

**After phase 4** — the first outside check. Show it to someone who has never
seen Orbital and say nothing.

**Two weeks in** — an honest question: does the new thing do what the old one
did? The recorded scenarios answer the mechanical half. The other half is
phase 7's checklist. If the answer is no, that is not a failure, it is data about
the real size of the job. Adjust the estimate, not the plan.

---

## On timelines

Phases 0–4 are the parts that come quickly: pure logic, types, tRPC, a simple
executor, a client port.

Phase 6 shrank when the Agent SDK replaced the hand-written executor. What is
left of it — worktrees, patch application, cleanup after crashes — is still
debugged rather than written, so it is still slower than it looks, but it is no
longer the plan's centre of gravity.

Phase 7 is now the one most likely to be underestimated: nothing in it is hard,
and there is a great deal of it. That is the classic shape of a rewrite's last
mile.

So do not plan an overall date. Plan as far as phase 3. After it you will have a
proven model and real data about your own speed.
