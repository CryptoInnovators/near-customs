#!/usr/bin/env bash
# Verifies the tools a clean clone needs, then builds the token wasm and runs the whole suite.
# usage: scripts/check.sh [--mutate]
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f ../env.sh ] && . ../env.sh
need() { command -v "$1" >/dev/null || { echo "missing tool: $1 ($2)" >&2; exit 1; }; }
need cargo "https://rustup.rs"
need curl "needed by scripts/fetch-outlayer.sh"
need jq "needed by scripts/fetch-outlayer.sh"
need shasum "needed by scripts/fetch-outlayer.sh"
cargo near --version >/dev/null 2>&1 || { echo "missing tool: cargo-near (cargo install cargo-near)" >&2; exit 1; }
rustup target list --installed | grep -q '^wasm32-unknown-unknown$' || { echo "missing target: rustup target add wasm32-unknown-unknown" >&2; exit 1; }
rustup target list --installed | grep -q '^wasm32-wasip2$' || { echo "missing target: rustup target add wasm32-wasip2" >&2; exit 1; }
echo "tools ok: $(cargo near --version | head -1)"
scripts/check-web.sh
# the checker bytes the token pins are the bytes this source builds, on any machine
want=$(grep -o 'CHECKER_SHA256: &str = "[0-9a-f]*"' contracts/token/src/lib.rs | grep -o '[0-9a-f]\{64\}')
got=$(scripts/build-checker.sh | tail -1)
echo "checker sha256 built: $got pinned in the contract: $want"
[ "$want" = "$got" ] || { echo "the built checker differs from CHECKER_SHA256 in contracts/token/src/lib.rs" >&2; exit 1; }
scripts/build-token.sh
cargo test --workspace
[ "${1:-}" = "--mutate" ] && scripts/mutate.sh
echo "all checks passed"
