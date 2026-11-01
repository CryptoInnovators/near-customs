# Customs: 90-second demo

The user action: a hunter files `challenge` with two transaction hashes. The on-chain result: 20% of an insider's unvested bag lands in the hunter's account, shown on NearBlocks as a `wallet_seized` event.

Every account on screen belongs to the team. The story is a dare: we bundle our own launch, then seize from it. The only outside data on screen is the replay of 11 real Nearly openings, and it comes from mainnet reads committed in `spikes/replay/`.

## NEAR's role, concretely

| NEAR piece | What it does in Customs | Where |
|---|---|---|
| NEP-141 contract | Holds the rule. `on_outbound` runs before every `ft_transfer` and `ft_transfer_call` and refuses any move into an opening buyer's unvested amount. Parameters are fixed at `new`, which accepts only the published OutLayer contract and checker module, and no method changes them. | contracts/token/src/lib.rs:642 |
| Access keys | Once deployed, the token account has its full-access key deleted. With no key left, nobody can redeploy the code or swap the rule, and `view_access_key_list` on the token returns an empty list. | deploy step 4 below |
| OutLayer on NEAR, with yield/resume | `challenge` calls `request_execution` on `outlayer.near` with the checker wasm URL and sha256 fixed in params. The challenge waits in yield until the enclave answers, and a silent enclave leaves the vest as it was. | lib.rs:285, lib.rs:553 |
| `env::ed25519_verify` | `pin_verdict_key` pins only a key the module proved it signs with. After that, `on_verdict` accepts a verdict only under that key and only for the same token, wallet, challenge id, path hash and a recent block. | lib.rs:401, lib.rs:611 |
| NEAR Intents | Read as evidence. The `dip4 native_withdraw` event names the owner account behind an Intents payout, so a wallet that looks funded by `intents.near` traces back to the creator. Customs settles nothing through Intents. | crates/walker/src/receipts.rs:141 |
| Chain Signatures, NEAR AI Cloud, Sputnik DAO | No role in Customs. The voiceover does not name them. | |

## Before recording

These steps sign mainnet transactions and spend NEAR, so they need the user's sign-off first. Rehearse every command once on the coin before filming. The deposit amounts and the challenge round trip (9 to 12 s on two production OutLayer txs, per VERDICT.md) are measured in that rehearsal.

1. Build and publish the checker:
   ```sh
   scripts/build-checker.sh
   ```
   It prints the wasm path and its sha256, which is the `CHECKER_SHA256` compiled into the token. Attach the wasm to a GitHub release. Its download URL becomes `module_url`, and the sha256 is `module_sha256` (`new` accepts no other).
2. Build the token: `scripts/build-token.sh` (prints its sha256).
3. Deploy and init. Values match the sandbox defaults in tests/src/lib.rs:156, except `exec_fee`, which is set from the per-run cost OutLayer quotes:
   ```sh
   near contract deploy $TOKEN use-file target/wasm/customs_token.wasm with-init-call new json-args "{
     \"owner_id\":\"$CREATOR\",\"total_supply\":\"1000000000000000000000000000000000\",
     \"metadata\":{\"spec\":\"ft-1.0.0\",\"name\":\"Customs Paper\",\"symbol\":\"PAPERS\",\"icon\":null,\"reference\":null,\"reference_hash\":null,\"decimals\":24},
     \"params\":{\"market_id\":\"dclv2.ref-labs.near\",\"creator_id\":\"$CREATOR\",\"outlayer_id\":\"outlayer.near\",
       \"module_url\":\"$MODULE_URL\",\"module_sha256\":\"$MODULE_SHA256\",\"notice_s\":3600,\"window_s\":600,\"vest_s\":86400,
       \"seize_bps\":2000,\"lock_s\":2592000,\"min_bond\":\"1000000000000000000000000\",\"exec_fee\":\"$EXEC_FEE\",
       \"reclaim_blocks\":220,\"max_age_blocks\":50,\"max_hops\":3}}" \
     prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
   ```
4. Pin the key, then remove the token's own key:
   ```sh
   near contract call-function as-transaction $TOKEN pin_verdict_key json-args '{}' \
     prepaid-gas '300.0 Tgas' attached-deposit "$EXEC_FEE yoctoNEAR" sign-as $HUNTER network-config mainnet sign-with-keychain send
   near account delete-keys $TOKEN public-keys $TOKEN_PK network-config mainnet sign-with-keychain send
   ```
5. Create the PAPERS/wNEAR pool on Rhea DCL (`dclv2.ref-labs.near`) and add liquidity from `$CREATOR`. Then announce the opening, at least `notice_s` ahead: `near contract call-function as-transaction $TOKEN open_trading json-args '{"start_s": <unix seconds>}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as $CREATOR network-config mainnet sign-with-keychain send`. The pool pays nobody before that second.
6. Fund the insiders before the opening. Fund `$INSIDER_DIRECT` with a plain transfer from `$CREATOR`. Fund `$INSIDER_INTENTS` by depositing from `$CREATOR` into `intents.near` and withdrawing to that wallet with a `native_withdraw` (https://docs.near-intents.org/). Fund `$OUTSIDER` from nothing the creator owns.
7. Inside the first 600 s after the announced start, buy from all three wallets. Then send a small transfer from `$CREATOR` to `$OUTSIDER`. That is the planted dust.
8. Register `$HUNTER` with `storage_deposit` on `$TOKEN`.
9. Check both paths offline before filing:
   ```sh
   cargo install --path crates/walker --locked
   customs-walker check-path --token $TOKEN --creator $CREATOR \
     --wallet $INSIDER_INTENTS --buy-tx $BUY_TX --path $WITHDRAW_TX
   customs-walker check-path --token $TOKEN --creator $CREATOR \
     --wallet $OUTSIDER --buy-tx $OUTSIDER_BUY_TX --path $DUST_TX
   ```
   The first must pass and the second must fail. If not, fix the setup before recording.
10. Write every account, tx hash and block to `docs/EVIDENCE.md`, and export them in the recording shell: `TOKEN CREATOR INSIDER_DIRECT INSIDER_INTENTS OUTSIDER HUNTER WITHDRAW_TX BUY_TX DUST_TX OUTSIDER_BUY_TX`.

View helper (public RPC, read only):

```sh
view() { curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$TOKEN\",\"method_name\":\"$1\",\"args_base64\":\"$(printf '%s' "$2" | base64)\"}}" \
  | jq -r '.result.result | implode | fromjson'; }
P=$(view customs_params '{}')
BOND=$(echo "$P" | jq -r .min_bond)
DEPOSIT=$(python3 -c "print($BOND + $(echo "$P" | jq -r .exec_fee))")
```

## Shots

**0:00 to 0:09. The problem, from chain data.**
Screen: terminal, `python3 spikes/table.py`, held on the "sold within 24h" column.
VO: "Eleven NEAR memecoin openings last week. The same four wallets bought all eleven, and 97 to 100 percent of opening tokens were sold within a day."

**0:09 to 0:18. Our coin, bundled by us.**
Screen: `https://nearblocks.io/address/$TOKEN`, then:
```sh
view window '{}'
view opening_of "{\"account_id\":\"$INSIDER_INTENTS\"}"    # state: vesting, locked > 0
```
VO: "So we launched our own coin and bundled it. Three wallets bought in the first ten minutes. Two of them were paid for with the creator's money."

**0:18 to 0:28. The insider tries to dump.**
```sh
near contract call-function as-transaction $TOKEN ft_transfer \
  json-args "{\"receiver_id\":\"$OUTSIDER\",\"amount\":\"$(view ft_balance_of "{\"account_id\":\"$INSIDER_DIRECT\"}")\"}" \
  prepaid-gas '30.0 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as $INSIDER_DIRECT network-config mainnet sign-with-keychain send
```
Screen: the failure `customs: N of N tokens are locked until <unix s> (unix s); transferable now: 0`.
VO: "Every opening buy vests for 24 hours. The token contract refuses the move by itself. No server is asked."

**0:28 to 0:36. The hidden funding.**
Screen: `https://nearblocks.io/txns/$WITHDRAW_TX`. Point at the receipt where `intents.near` pays `$INSIDER_INTENTS`, then at the `dip4 native_withdraw` log, whose `account_id` is `$CREATOR`.
VO: "This wallet looks funded by intents.near. The Intents withdraw event names the real owner: our creator."

**0:36 to 0:58. The action: a challenge.**
```sh
near contract call-function as-transaction $TOKEN challenge \
  json-args "{\"wallet\":\"$INSIDER_INTENTS\",\"path\":[\"$WITHDRAW_TX\",\"$BUY_TX\"],\"bond\":\"$BOND\"}" \
  prepaid-gas '300.0 Tgas' attached-deposit "$DEPOSIT yoctoNEAR" \
  sign-as $HUNTER network-config mainnet sign-with-keychain send
```
Cut the enclave wait. Screen: the printed tx hash opened on NearBlocks, showing `challenge` on `$TOKEN`, then `request_execution` on `outlayer.near`, then the resumed `on_verdict` receipt with the `wallet_seized` event. Then:
```sh
view opening_of "{\"account_id\":\"$INSIDER_INTENTS\"}"   # state: seized_frozen
view ft_balance_of "{\"account_id\":\"$HUNTER\"}"          # up by the seized amount
```
VO: "Two hashes in. An OutLayer enclave reads those receipts, checks that the creator's money paid for the buy, and signs. The token checks that signature against the key it pinned and pays the hunter 20 percent of the bag. The rest stays frozen for 30 days."

**0:58 to 1:10. A planted path fails.**
```sh
near contract call-function as-transaction $TOKEN challenge \
  json-args "{\"wallet\":\"$OUTSIDER\",\"path\":[\"$DUST_TX\",\"$OUTSIDER_BUY_TX\"],\"bond\":\"$BOND\"}" \
  prepaid-gas '300.0 Tgas' attached-deposit "$DEPOSIT yoctoNEAR" \
  sign-as $HUNTER network-config mainnet sign-with-keychain send
view forfeited '{}'
```
Screen: the `challenge_rejected` event, and `forfeited` up by the bond.
VO: "Money sent after the buy proves nothing. The verdict comes back rejected, and the hunter loses the bond."

**1:10 to 1:20. Nobody can fake the verdict or change the rule.**
```sh
near contract call-function as-transaction $TOKEN on_verdict \
  json-args '{"challenge_id":0}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' \
  sign-as $HUNTER network-config mainnet sign-with-keychain send     # Method on_verdict is private
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$TOKEN\"}}" \
  | jq '.result.keys'                                                # []
```
VO: "Only the OutLayer callback reaches the verdict, and only the pinned key passes. The token account holds no keys, so nobody can change the rule."

**1:20 to 1:30. NEAR's role, then the repo.**
Screen: four lines on a black card, then `https://github.com/kamalbuilds/near-customs`.
- The NEP-141 contract is the rule.
- OutLayer runs the check in an enclave; NEAR yield/resume waits for it.
- The contract verifies the enclave's signature.
- NEAR Intents events name who really paid.

VO: "The rule lives in the token. The evidence comes from NEAR. Try to break it: the repo is on screen."

## Sandbox cut, same code

Use this for rehearsal or as a backup video. It runs the token beside the `outlayer.near` code read from mainnet block 222386104:

```sh
scripts/check.sh
RUST_TEST_NOCAPTURE=1 cargo test -p customs-tests --test token upheld_challenge_pays_exactly_twenty_percent_of_the_unvested_bag
RUST_TEST_NOCAPTURE=1 cargo test -p customs-tests --test token funding_planted_after_the_buy_is_rejected
RUST_TEST_NOCAPTURE=1 cargo test -p customs-tests --test token verdict_signed_by_another_key_changes_nothing
cargo install --path crates/walker --locked
customs-walker replay --token phire.nearlytrade.near --creator provenhire.near --placebo-creator justai.near
```

Prerequisites: cargo-near, the `wasm32-unknown-unknown` and `wasm32-wasip2` targets, `jq`, `curl`, `shasum`, and network access to `archival-rpc.mainnet.fastnear.com` and `tx.main.fastnear.com`. `scripts/check.sh` checks each one and names any that is missing.
