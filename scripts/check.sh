#!/usr/bin/env bash
# The full local gate — same checks CI runs (.github/workflows/ci.yml).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== worker (Go)"
(cd worker && go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2 run ./...)
(cd worker && go test ./...)

echo "== recorded scenarios"
node scripts/record-scenarios.mjs --check

echo "== workspace (TypeScript)"
pnpm -r lint
pnpm -r typecheck
pnpm -r test

echo "== desktop shell (Rust)"
(cd apps/web/src-tauri && cargo fmt --check)
(cd apps/web/src-tauri && cargo clippy --all-targets -- -D warnings)
(cd apps/web/src-tauri && cargo test)

echo "All checks passed."
