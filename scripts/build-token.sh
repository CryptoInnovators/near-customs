#!/usr/bin/env bash
# The token wasm with the on-chain host functions selected. near-sdk 5.30 needs `--cfg near` and
# cargo-near 0.16 does not pass it: without it panics carry no message and hashes run as guest code.
# usage: scripts/build-token.sh [--testnet]
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f ../env.sh ] && . ../env.sh
if [ "${1:-}" = "--testnet" ]; then
  target_dir="${CARGO_TARGET_DIR:-$PWD/target}"
  RUSTFLAGS='--cfg near -C link-arg=-s' cargo build -p customs-token --features testnet --target wasm32-unknown-unknown --release --locked --target-dir "$target_dir" >&2
  mkdir -p target/wasm
  cp "$target_dir/wasm32-unknown-unknown/release/customs_token.wasm" target/wasm/customs_token.wasm
  shasum -a 256 target/wasm/customs_token.wasm
  exit 0
fi
out="target/wasm"
mkdir -p "$out"
(cd contracts/token && cargo near build non-reproducible-wasm --no-abi --env 'RUSTFLAGS=--cfg near -C link-arg=-s' --out-dir "$(cd "$OLDPWD" && cd "$out" && pwd)")
shasum -a 256 "$out/customs_token.wasm"
