#!/usr/bin/env bash
# The token wasm with the on-chain host functions selected. near-sdk 5.30 needs `--cfg near` and
# cargo-near 0.16 does not pass it: without it panics carry no message and hashes run as guest code.
# usage: scripts/build-token.sh [out-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f ../env.sh ] && . ../env.sh
out="${1:-target/wasm}"
mkdir -p "$out"
(cd contracts/token && cargo near build non-reproducible-wasm --no-abi --env 'RUSTFLAGS=--cfg near -C link-arg=-s' --out-dir "$(cd "$OLDPWD" && cd "$out" && pwd)")
shasum -a 256 "$out/customs_token.wasm"
