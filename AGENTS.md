# Working on Orbital

Orbital is a desktop app for running AI coding missions on a canvas: a Tauri
shell around a React frontend, driven by a Go CLI worker that owns all state
and git operations.

## Layout

A pnpm workspace. Every TypeScript package installs from the root.

| Path | What it is |
|---|---|
| `apps/web` | React 19 + TypeScript frontend (vite, vitest, ESLint) |
| `apps/web/{workspace,canvas,chat,review,intake,shell,ui}` | Feature folders: data kernel, graph, agent chat, diffs/panel, prompt intake, chrome, shared primitives |
| `apps/web/src-tauri` | Rust Tauri v2 shell; invokes the worker binary. Deleted at phase 4 |
| `apps/server` | The long-lived Node process. A skeleton |
| `packages/domain` | The pure graph model and event log. No I/O, ever |
| `tooling/eslint-plugin-orbital` | The purity rule that keeps `packages/domain` honest |
| `worker/` | Go CLI (`orbital`); missions, runs, patches, git worktrees. The reference until the rewrite lands |
| `recordings/` | Recorded CLI scenarios — the specification the rewrite is measured against |
| `docs/` | User-facing documentation |
| `.plans/` | Internal design notes: architecture, migration plan, decisions |
| `scripts/` | Repo tooling (`check.sh` = full local gate, `install.sh` = installer) |

## Commands

- Full gate (what CI runs): `scripts/check.sh`
- TypeScript, everything: `pnpm -r lint && pnpm -r typecheck && pnpm -r test`
- One package: `pnpm --filter @orbital/domain test`
- Worker: `cd worker && go test ./...`
- Rust shell: `cd apps/web/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
- Dev app: `cd apps/web && pnpm run tauri:dev`
- Re-record the CLI scenarios: `scripts/record-scenarios.sh`

## Conventions

- Conventional Commits, single line: `type(scope): subject`.
- Comment only to prevent a bug or a wrong refactor; prefer better names over prose.
- Long-running Tauri commands must be `async fn` + `spawn_blocking`, or the UI freezes.
- React code must pass the React Compiler ESLint rules (no setState-in-effect).
- The worker CLI prints full JSON state; the frontend consumes it via `status --json`. Field names are Go json tags (snake_case).
- `packages/domain` is pure: no filesystem, network or process access. The lint rule says so, and its dependencies make it structural.
- The rewrite lives on `next`; see `.plans/orbital-plan.md` for the phase order.
