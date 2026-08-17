# Recorded scenarios

The Go worker's observable behaviour, captured as golden files. Recorded
against `worker/` while it still runs; replayed against the TypeScript rewrite
as it is built.

This is the safety net for the port, and it exists instead of translating the
Go test suite. A hand-translated test that quietly loses an assertion still
passes. A golden diff cannot lose an assertion, because the assertion *is* the
recording.

It is also the parity checklist: if a scenario here does not replay against the
new server, the rewrite is not finished, whatever else works.

## Running

```
node scripts/record-scenarios.mjs --check   # replay and diff
node scripts/record-scenarios.mjs           # re-record, deliberately
```

`--check` runs in CI, in the same job as the Go tests.

## What is recorded

Each scenario drives a throwaway git repository — with a real remote, so
`push` and `git-sync` are exercised — through the `orbital` CLI. For every step
the file holds the command, its exit code, its stdout and stderr, and the full
`status --json` afterwards.

| Scenario | What it pins down |
|---|---|
| `repository-and-missions` | opening a repo, both mission kinds, edit, link, unlink, delete |
| `tool-run-approve` | the whole cycle: run → patch → approve → commit |
| `tool-run-reject` | rejection, which is durable and distinct from silence |
| `tool-run-failure` | a run that fails leaves the mission recoverable |
| `amend-and-push` | the commit gate: message, amend, push |
| `branches` | branch listing, creating, switching, sync state |
| `chained-missions` | two linked missions, the second seeing the first's result |

Only the local-command worker is used, so nothing here calls a model and every
run is deterministic. There are deliberately **no** stream-json fixtures: the
Agent SDK parses that stream, so there is no hand-written parser to protect.

## Normalisation

Ids, timestamps, git hashes, paths and durations change on every run. They are
replaced before the file is written.

Ids go through a symbol table keyed by first appearance — `mission_1`,
`run_2` — rather than a constant, so a recording still shows *which* mission an
event belongs to. Flattening them all to `<id>` would make these goldens far
weaker than the tests they replace.

Timestamps come in two shapes and both are normalised: the store writes UTC
(`...Z`), git writes a local offset (`...+03:00`). Missing the second was a
real bug in the recorder, caught by the first replay.

## Not covered

- `models`, which parses whatever `claude` binary is installed — not
  reproducible on another machine, and not worth faking
- `send-message` and `show`, which need a live agent session and a known commit
- anything involving the Claude worker, by design
