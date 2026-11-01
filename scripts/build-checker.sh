#!/usr/bin/env bash
# The checker module exactly as OutLayer is asked to run it, built so the bytes do not depend on where the
# repository or the cargo home sit. The token contract carries the sha256 of these bytes (CHECKER_SHA256 in
# contracts/token/src/lib.rs); scripts/check.sh fails when they differ.
# usage: scripts/build-checker.sh [out-dir]   prints the wasm path and its sha256
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f ../env.sh ] && . ../env.sh
root="$PWD"
out="${1:-$root/target/checker}"
sysroot="$(rustc --print sysroot)"
export RUSTFLAGS="--remap-path-prefix=$root=/customs --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=$sysroot=/sysroot"
unset CARGO_TARGET_DIR
cargo build -p customs-checker --target wasm32-wasip2 --release --locked --target-dir "$out" >&2
wasm="$out/wasm32-wasip2/release/customs-checker.wasm"
echo "$wasm"
shasum -a 256 "$wasm" | cut -d' ' -f1
