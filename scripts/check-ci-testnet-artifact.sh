#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

workflow=.github/workflows/ci.yml
main_tests=$(grep -nF 'run: scripts/check.sh' "$workflow" | cut -d: -f1)
testnet_build=$(grep -nF 'run: scripts/build-token.sh --testnet' "$workflow" | cut -d: -f1)
artifact=$(grep -nF 'name: customs-token-wasm-testnet' "$workflow" | cut -d: -f1)
path=$(grep -nF 'path: target/wasm/customs_token.wasm' "$workflow" | cut -d: -f1)

[ -n "$main_tests" ] || { echo 'missing mainnet wasm test step' >&2; exit 1; }
[ -n "$testnet_build" ] || { echo 'missing testnet token wasm build' >&2; exit 1; }
[ -n "$artifact" ] || { echo 'missing customs-token-wasm-testnet artifact' >&2; exit 1; }
[ -n "$path" ] || { echo 'missing target/wasm/customs_token.wasm upload path' >&2; exit 1; }
[ "$testnet_build" -gt "$main_tests" ] || { echo 'testnet build must follow the mainnet wasm tests' >&2; exit 1; }
[ "$artifact" -gt "$testnet_build" ] && [ "$path" -gt "$artifact" ] || {
  echo 'testnet artifact upload must follow its build and use target/wasm/customs_token.wasm' >&2
  exit 1
}

echo 'CI testnet token wasm build and artifact upload are configured'
