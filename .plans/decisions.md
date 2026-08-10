# Rewrite — decisions

Working record. The architecture and plan documents get rewritten from this, not
edited in place. Open questions live at the bottom.

---

## D0 — What the rewrite is for

Both a clean single-language core **and** the new graph model. Cost accepted
deliberately.

Consequences the documents owe:

- a parity checklist — what the old thing does that the new one must do
- a rollback story for phase 8
- an explicit line that the parallel-missions experiment (friction #28) is
  **deferred, not answered**

## D1 — State model

`blocked` and `stale` split on *does my input exist* vs *has my input moved*.

```
blocked : an input has no artifact at all — parent empty, failed, or a gate
          above unresolved/rejected. Cannot run.
stale   : artifactId !== "" && inputDigest !== currentDigest(node).
          Input existed, was consumed, has since changed. Can run.
fresh   : artifactId !== "" && inputDigest === currentDigest(node)
empty   : artifactId === ""
running : a process is alive for the current run
failed  : the last run failed
```

- `blocked` needs no ancestor walk. "No artifact" propagates on its own; a
  rejected gate produces no artifact, so its subtree is blocked for free. Walk
  upward only to *name the reason* for the user.
- **There is no staleness wave.** A stale parent still holds the artifact its
  child consumed. Staleness moves one hop, only when the parent actually
  re-runs and produces a different artifact. The canvas shows the frontier,
  not the cone.
- Kills the plan's phase 7 deliverable "the staleness wave made visible".

## D2 — Continue vs Re-run

Two explicit operations.

- **Continue** — resumes the run's session with a new message, produces a new
  artifact on the same run. The default verb; this is what ships today via
  `--resume` and is why a node beats a chat window.
- **Re-run** — a new run, fresh session, same intent.

Model consequences:

- **A run is a session, not an attempt.** One session id, many process
  invocations, potentially many artifacts. §6's "a run ends at `RunFailed` or
  `ArtifactProduced`" is wrong and comes out.
- `running` = a process is alive now. Distinct from "the run is over".
- Corrections do **not** enter the digest — intent and inputs are unchanged, so
  the node stays `fresh`. Re-run therefore discards corrections. Accepted; no
  "promote correction into intent" mechanism until the loss is actually felt.

## D3 — Node fields

`title` stays in the domain, optional, alongside `intent`. Extraction already
produces `{title, text}`; discarding the title was friction #15 and was fixed
once already.

## D4 — One language, all the way

The whole codebase moves to TypeScript. `worker/` (Go) is ported into `core/`,
`app/src-tauri` (Rust) is deleted. Considered and rejected: keeping the Go
executor behind the existing JSON/CLI seam.

Known costs, accepted — these become work items, not objections:

- 5,138 lines of hand-conversion in the layer §8 says to change nothing in
- process-group kill and crash cleanup are harder in Node than
  `syscall.Kill(-pgid)`; zombie `claude` processes are the failure mode to watch
- distribution loses the single static binary; Electron will need a bundled
  runtime (`bun build --compile` / Node SEA / bundled Node)

## D5 — Desktop gap

Orbital is allowed to be a browser tab for the middle of the plan. Electron
comes later, not right after the client port.

Consequence: the installer and release pipeline freeze at v0.0.2. Testers stay
on the old build until Electron exists. This is a choice, not a discovery, and
the GTM plan's "~20 testers" waits behind it.

## D6 — The safety net for the port

"Port the 8 Go test files" is replaced by:

- a **recorded scenario suite** — fixture repos driven through the CLI with
  `local_command_worker` (deterministic), capturing `status --json` at each
  step. Recorded against the Go binary, replayed against `core`, diffed.
- **stream fixtures** for the stream-json parser — record real Claude output
  once, replay forever
- ordinary unit tests for the new pure code, which has no old behaviour to
  compare against

Rationale: a hand-translated Go test that loses an assertion still passes. A
golden diff cannot lose an assertion, because the assertion is the recording.

**Sequencing constraint:** the goldens must be captured **while `worker/` still
runs**. If phase 8 deletes it first, the reference is gone permanently.

This suite is also the D0 parity checklist.

## D7 — Model scope

Kept as proposed in the architecture document, except:

- **`gate` is not a node kind** — it becomes `requiresApproval` on a derivation.
  Unapproved/rejected → no artifact → subtree `blocked` for free, via D1. A
  standalone human decision is already a `source`.
- **`owner` is dropped from `Node`** — derivable from the `actor` on
  `NodeCreated`; storing it violates "state is computed, never stored".
- **`ArtifactKind` added**: `patch | document | summary | decision`. Needed by
  context assembly and by §7's per-edge budget breakdown. Repos are never
  inlined, only referenced, so they are not in the list.

`group`, `watcher` and the `normative` aperture are **kept** (user decision).
Their semantics are pinned in D8–D10.

## D8 — Normative rules and the digest

Normative rules **do** contribute to every descendant's digest. This does not
conflict with D1: inheritance inlines the rule into each descendant, so each is
a *direct* consumer. Twenty nodes going stale is one hop from a rule with twenty
consumers, not a transitive wave — and it is true.

Excluding it would make `inputDigest` lie about what was consumed, breaking
fold determinism.

The problem was legibility, so:

> **`stale` carries a reason, as `blocked` does: `input-changed` |
> `rule-changed`.**

The canvas renders them differently — foundation moved vs. policy changed.

## D9 — Watchers mark, they do not run

A watcher observes a `source`. When the source moves, the watcher updates that
source's artifact; downstream `artifact` edges go stale by the normal one-hop
rule. **No new execution semantics**, and "nothing runs unasked" survives.

Auto-run, if ever wanted, is a flag on the watcher — not a redesign.

## D10 — Groups are a view, not a derivation

A group has no intent, no artifact and no digest — "what is a group's artifact?"
has no answer. Edges always connect real nodes; collapsing renders members'
external edges on the group's box.

Domain: membership metadata. Canvas: a collapsible box. Same feature, none of
the semantics. Cost: no "run a group" — which is `Run all`, deleted at 61b3a18.

## D11 — Sequence

Three changes to the phase order:

- **Execution moves ahead of the client rewrite.** The plan built the entire
  canvas at phase 3 against a model that had never executed, then called phase 4
  "the most important phase — if the model is wrong, it surfaces here". That
  ordering rewrites the canvas twice when the model bends. Execution is provable
  headless: create a node, run a shell command, change an input, assert the
  child went stale.
- **A parity phase is added.** `cmd/orbital` has 19 commands; the phase list
  accounted for four. `delete edit-mission link unlink reject amend push
  git-sync branches switch-branch history show models open queue` had no home,
  nor did the commit gate, branch/landed-commit display, the diff file rail or
  the model picker.
- **Deleting `worker/` leaves the release.** Ship 0.0.3, use it a week on real
  work, then delete in a separate commit.

## D12 — Consequences traced from D7 + D10

- Domain node kinds are **`source | derivation | watcher`**. `gate` became a
  flag (D7); `group` left the domain (D10).
- Group membership and pinned canvas positions are **view state**, not events.
  They need a store next to the log, not inside it.
- `requiresApproval` needs two more computed states: `pending` (artifact
  produced, approval undecided) and `rejected`. An input counts as available
  only when it has an artifact *and* is approved where approval is required.

---

## Open

Nothing. Both documents rewritten from D0–D12.
