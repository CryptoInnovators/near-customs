#!/usr/bin/env bash
# Reads the deployed OutLayer contract code from mainnet (read only) at a pinned block and checks both
# hashes, so the sandbox tests run the real request_execution / resolve_execution / yield code that
# outlayer.near runs. Writes target/sandbox-wasm/outlayer.wasm.
set -euo pipefail
cd "$(dirname "$0")/.."
BLOCK=222386104
CHAIN_HASH=5waWVnt6g3FZfjR6vfYXZzpAi3sZdFy8cK2sLz4EJQDt
SHA256=4969ffe8a1d09f55183f94ca5e02c956e3374476699dbca251645dfa2aff403f
OUT=target/sandbox-wasm/outlayer.wasm
mkdir -p "$(dirname "$OUT")"
if [ -f "$OUT" ] && [ "$(shasum -a 256 "$OUT" | cut -d' ' -f1)" = "$SHA256" ]; then
  echo "outlayer.wasm present, sha256 $SHA256"
  exit 0
fi
RES=$(curl -sf -X POST https://archival-rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_code\",\"block_id\":$BLOCK,\"account_id\":\"outlayer.near\"}}")
GOT_HASH=$(echo "$RES" | jq -r '.result.hash')
[ "$GOT_HASH" = "$CHAIN_HASH" ] || { echo "outlayer.near code hash at block $BLOCK is $GOT_HASH, expected $CHAIN_HASH" >&2; exit 1; }
echo "$RES" | jq -r '.result.code_base64' | base64 -d > "$OUT"
GOT_SHA=$(shasum -a 256 "$OUT" | cut -d' ' -f1)
[ "$GOT_SHA" = "$SHA256" ] || { echo "sha256 $GOT_SHA, expected $SHA256" >&2; rm -f "$OUT"; exit 1; }
echo "outlayer.near at block $BLOCK: code hash $CHAIN_HASH, sha256 $SHA256, $(wc -c < "$OUT") bytes"
