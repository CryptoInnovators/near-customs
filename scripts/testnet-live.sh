#!/usr/bin/env bash
# Proves the live testnet token, pinned judge, upheld/rejected verdicts, and exact seizure; usage: scripts/testnet-live.sh
# Env overrides: TOKEN, TOKEN_WASM, CHALLENGE_ID, SEIZE_BPS, RPC, CREATOR, MARKET, HUNTER, WALLET, REJECTED_WALLET, REJECTED_ID, CHALLENGE_TX, CHECKER_URL, TOKEN_WASM_URL.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
override_names=(RPC TOKEN CREATOR MARKET HUNTER WALLET CHALLENGE_ID CHALLENGE_TX REJECTED_WALLET REJECTED_ID CHECKER_URL TOKEN_WASM_URL TOKEN_WASM SEIZE_BPS)
for name in "${override_names[@]}"; do if printenv "$name" >/dev/null; then printf -v "__env_$name" '%s' "${!name}"; printf -v "__set_$name" 1; fi; done
set -a
. scripts/testnet-live.env
set +a
for name in "${override_names[@]}"; do setvar=__set_$name; valvar=__env_$name; if [[ ${!setvar:-0} == 1 ]]; then printf -v "$name" '%s' "${!valvar}"; fi; done
RPC=${RPC:-https://test.rpc.fastnear.com}
TOKEN_WASM=${TOKEN_WASM:-target/wasm/customs_token.wasm}
passed=0 failed=0
check() { local name=$1; shift; local evidence; if evidence=$("$@" 2>&1); then printf 'PASS %s: %s\n' "$name" "$evidence"; ((passed+=1)); else printf 'FAIL %s: %s\n' "$name" "$evidence"; ((failed+=1)); fi; }
rpc() {
  local payload=$1 reply
  for _ in 1 2 3; do
    reply=$(curl -fsS --max-time 30 -H 'content-type: application/json' -d "$payload" "$RPC" 2>/dev/null) || reply=
    if [ -n "$reply" ] && jq -e '.result != null' >/dev/null 2>&1 <<<"$reply"; then printf '%s' "$reply"; return 0; fi
    sleep 2
  done
  printf 'RPC failed after 3 attempts: %s' "$payload" >&2; return 1
}
view() {
  local account=$1 method=$2 args=$3 b64 payload out
  b64=$(printf '%s' "$args" | base64 | tr -d '\n')
  payload=$(jq -cn --arg a "$account" --arg m "$method" --arg b "$b64" '{jsonrpc:"2.0",id:"customs",method:"query",params:{request_type:"call_function",finality:"final",account_id:$a,method_name:$m,args_base64:$b}}')
  out=$(rpc "$payload") || return 1
  jq -r '.result.result|implode' <<<"$out" | jq -c .
}
account_view() {
  local account=$1 kind=$2 payload out
  payload=$(jq -cn --arg a "$account" --arg k "$kind" '{jsonrpc:"2.0",id:"customs",method:"query",params:({request_type:$k,finality:"final",account_id:$a})}')
  rpc "$payload"
}
hash_file() { shasum -a 256 "$1" | awk '{print tolower($1)}'; }
hash_url() { curl -fsSL --max-time 60 "$1" | shasum -a 256 | awk '{print tolower($1)}'; }
code_hash_check() {
  [ -f "$TOKEN_WASM" ] || scripts/build-token.sh --testnet >/dev/null 2>&1 || { echo 'token wasm build failed'; return 1; }
  local rpcout onchain localhash remote
  rpcout=$(account_view "$TOKEN" view_account) || { echo 'view_account failed'; return 1; }
  onchain=$(jq -r '.result.code_hash' <<<"$rpcout" | python3 -c 'import sys; s=sys.stdin.read().strip(); a="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; n=0
for c in s: n=n*58+a.index(c)
b=n.to_bytes((n.bit_length()+7)//8,"big"); print((b"\0"*(32-len(b))+b).hex())' 2>/dev/null) || return 1
  localhash=$(hash_file "$TOKEN_WASM") || return 1; remote=$(hash_url "$TOKEN_WASM_URL") || { echo 'TOKEN_WASM_URL fetch/hash failed'; return 1; }
  [ "$onchain" = "$localhash" ] && [ "$onchain" = "$remote" ] || { echo "expected equal hashes, on-chain=$onchain local=$localhash url=$remote"; return 1; }
  echo "on-chain=${onchain:0:12} local=${localhash:0:12} url=${remote:0:12}"
}
no_keys_check() { local r n; r=$(account_view "$TOKEN" view_access_key_list) || { echo 'access-key query failed'; return 1; }; n=$(jq -er '.result.keys|length' <<<"$r") || return 1; [ "$n" = 0 ] || { echo "expected 0 access keys, got $n"; return 1; }; echo 'access keys=0'; }
verdict_check() {
  local key good bad gs bs
  key=$(view "$TOKEN" verdict_key '{}') || { echo 'verdict_key RPC failed'; return 1; }
  good=$(view "$TOKEN" challenge_of "{\"challenge_id\":$CHALLENGE_ID}") || { echo 'upheld challenge query failed'; return 1; }
  bad=$(view "$TOKEN" challenge_of "{\"challenge_id\":$REJECTED_ID}") || { echo 'rejected challenge query failed'; return 1; }
  gs=$(jq -c '.state' <<<"$good"); bs=$(jq -c '.state' <<<"$bad")
  if ! jq -e 'type=="string" and startswith("ed25519:")' >/dev/null <<<"$key" || ! jq -e --arg w "$WALLET" '.wallet==$w and (.state|has("Upheld"))' >/dev/null <<<"$good" || ! jq -e --arg w "$REJECTED_WALLET" '.wallet==$w and .state=="Rejected"' >/dev/null <<<"$bad"; then echo "expected pinned key and upheld/rejected states, got key=$key upheld=$gs rejected=$bs"; return 1; fi
  echo "key=$key upheld=$gs rejected=$bs"
}
seizure_check() {
  local opening window params tx status hit block nanos t bought vest bps risk seized frozen ev challenge final_open transfer
  opening=$(view "$TOKEN" opening_of "{\"account_id\":\"$WALLET\"}") || { echo 'opening_of RPC failed'; return 1; }
  window=$(view "$TOKEN" window '{}') || { echo 'window RPC failed'; return 1; }
  params=$(view "$TOKEN" customs_params '{}') || { echo 'params RPC failed'; return 1; }
  tx=$(jq -cn --arg h "$CHALLENGE_TX" --arg s "$HUNTER" '{jsonrpc:"2.0",id:"customs",method:"EXPERIMENTAL_tx_status",params:{tx_hash:$h,sender_account_id:$s,wait_until:"FINAL"}}')
  status=$(rpc "$tx") || { echo 'challenge tx status failed'; return 1; }
  hit=$(jq -c --arg token "$TOKEN" '[.result.receipts_outcome[]|select(.outcome.executor_id==$token)|. as $r|.outcome.logs[]|select(contains("\"event\":\"wallet_seized\""))|{block_hash:$r.block_hash,log:.}] | first // empty' <<<"$status")
  [ -n "$hit" ] || { echo 'expected wallet_seized receipt log, got none'; return 1; }
  block=$(jq -r '.block_hash' <<<"$hit")
  nanos=$(rpc "$(jq -cn --arg b "$block" '{jsonrpc:"2.0",id:"customs",method:"block",params:{block_id:$b}}')") || { echo 'receipt block query failed'; return 1; }
  nanos=$(jq -r '.result.header.timestamp_nanosec' <<<"$nanos"); t=$(python3 -c 'import sys; print(int(sys.argv[1])//1000000000)' "$nanos" 2>/dev/null) || return 1
  bought=$(jq -r '.bought' <<<"$opening"); vest=$(jq -r '.vest_s' <<<"$params"); bps=${SEIZE_BPS:-$(jq -r '.seize_bps' <<<"$params")}; start=$(jq -r '.start_s' <<<"$window")
  [ "$bought" != null ] && [ "$start" != null ] || { echo 'missing opening bought or window start'; return 1; }
  read -r risk seized frozen < <(python3 -c 'import sys; B,start,vest,t,bps=map(int,sys.argv[1:]); md=lambda a,b,c:(a//c)*b+(a%c)*b//c; risk=md(B,start+vest-t,vest); seized=md(risk,bps,10000); print(risk,seized,risk-seized)' "$bought" "$start" "$vest" "$t" "$bps" 2>/dev/null) || return 1
  ev=$(jq -r '.log|sub("^EVENT_JSON:";"")|fromjson|.data' <<<"$hit") || { echo 'wallet_seized event parse failed'; return 1; }
  challenge=$(view "$TOKEN" challenge_of "{\"challenge_id\":$CHALLENGE_ID}") || { echo 'challenge query failed'; return 1; }
  transfer=$(jq -c --arg token "$TOKEN" --arg w "$WALLET" --arg h "$HUNTER" '[.result.receipts_outcome[]|select(.outcome.executor_id==$token)|.outcome.logs[]|select(contains("\"event\":\"ft_transfer\""))|sub("^EVENT_JSON:";"")|fromjson|.data[]|select(.old_owner_id==$w and .new_owner_id==$h and .memo=="customs seizure")]|first // empty' <<<"$status")
  [ -n "$transfer" ] || { echo 'expected ft_transfer seizure event, got none'; return 1; }
  final_open=$(view "$TOKEN" opening_of "{\"account_id\":\"$WALLET\"}") || return 1
  python3 -c 'import sys,json; e,c,o,tr=map(json.loads,sys.argv[1:5]); seized,frozen=sys.argv[5:7]; w,h=sys.argv[7:9]; ok=(e.get("seized")==seized and e.get("frozen")==frozen and e.get("wallet")==w and e.get("challenger")==h and c.get("state",{}).get("Upheld",{}).get("seized")==seized and tr.get("amount")==seized and ((o.get("state")=="seized_frozen" and o.get("locked")==frozen) or o.get("state")=="seized_released")); ok or print("mismatch event=%s challenge=%s transfer=%s opening=%s"%(e,c.get("state"),tr,o)); sys.exit(0 if ok else 1)' "$ev" "$challenge" "$final_open" "$transfer" "$seized" "$frozen" "$WALLET" "$HUNTER" 2>/dev/null || { echo "expected seized=$seized frozen=$frozen and matching event, challenge, transfer, opening"; return 1; }
  [ "$(jq -r '.amount' <<<"$transfer")" = "$seized" ] || { echo 'transfer amount differs'; return 1; }
  echo "B=$bought at_risk=$risk seized=$seized t=$t"
}
judge_check() {
  local p remote
  p=$(view "$TOKEN" customs_params '{}') || { echo 'customs_params RPC failed'; return 1; }
  jq -e --arg m "$MARKET" --arg c "$CREATOR" --arg u "$CHECKER_URL" '.outlayer_id=="outlayer.testnet" and .market_id==$m and .creator_id==$c and .module_url==$u' >/dev/null <<<"$p" || { echo 'judge parameters differ from expected'; return 1; }
  remote=$(hash_url "$CHECKER_URL") || { echo 'checker module fetch/hash failed'; return 1; }
  [ "$remote" = "$(jq -r '.module_sha256|ascii_downcase' <<<"$p")" ] || { echo "expected module sha256 $(jq -r '.module_sha256' <<<"$p"), got $remote"; return 1; }
  echo "outlayer=$(jq -r '.outlayer_id' <<<"$p") module_sha256=${remote:0:12}"
}
check code_hash code_hash_check
check no_access_keys no_keys_check
check verdict_stored verdict_check
check seized_amount seizure_check
check judge_pinned judge_check
printf 'testnet-live: %d passed, %d failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
