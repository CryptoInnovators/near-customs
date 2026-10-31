# Customs: 90-second demo

One user action: a hunter files `challenge` with two transaction hashes. One on-chain result: 20% of an insider's unvested bag lands in the hunter's account, on a NearBlocks page.

Every account on screen is a team account. The story on screen is the dare: we bundled our own launch, then seized from it.

## Before recording

Recording needs the mainnet dry-run coin. The deploy run writes these to `docs/EVIDENCE.md`; export them in the recording shell:

```sh
export TOKEN=...          # token contract account
export CREATOR=...        # creator_id in customs_params
export INSIDER_DIRECT=... # funded by the creator with a plain transfer, bought in the window
export INSIDER_INTENTS=... # funded by the creator through an Intents native_withdraw, bought in the window
export OUTSIDER=...       # aged account, bought in the window, no creator money
export HUNTER=...         # registered with the token, files the challenges
export WITHDRAW_TX=...    # the native_withdraw tx that paid INSIDER_INTENTS
export BUY_TX=...         # INSIDER_INTENTS's opening buy on dclv2.ref-labs.near
export DUST_TX=...        # a transfer from CREATOR to OUTSIDER sent after OUTSIDER's buy
export OUTSIDER_BUY_TX=...
```

View helper (FastNEAR public RPC, read only):

```sh
view() { curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$TOKEN\",\"method_name\":\"$1\",\"args_base64\":\"$(printf '%s' "$2" | base64)\"}}" \
  | jq -r '.result.result | implode | fromjson'; }
P=$(view customs_params '{}')
DEPOSIT=$(python3 -c "print(int('$(echo $P | jq -r .min_bond)') + int('$(echo $P | jq -r .exec_fee)'))")
```

Rehearse every `near` command once on the dry-run coin before recording; the `yoctoNEAR` deposit form and the challenge round trip time are measured there, not here.

## Shots

**0:00 to 0:10. The problem, from chain data.**
Screen: terminal.
```sh
for f in spikes/replay/{celadon,grlant,justai,nearvember,phire,clearline,wmark}.json; do
  jq -r '"\(.token)  sold within 24h: \(.shares_bps.sold_within_vest/100)%"' $f; done
```
VO: "Seven NEAR memecoin launches last week. The same four wallets bought every opening, and 97 to 100 percent of opening tokens were sold within a day."

**0:10 to 0:20. Our coin, bundled by us.**
Screen: `https://nearblocks.io/address/$TOKEN`, then `view window '{}'` and `view opening_of "{\"account_id\":\"$INSIDER_INTENTS\"}"` showing `state: vesting` and `locked`.
VO: "So we launched our own coin and bundled it. Three wallets bought in the first ten minutes. Two of them are paid for with the creator's money."

**0:20 to 0:30. The insider tries to dump.**
```sh
near contract call-function as-transaction $TOKEN ft_transfer \
  json-args "{\"receiver_id\":\"$OUTSIDER\",\"amount\":\"$(view ft_balance_of "{\"account_id\":\"$INSIDER_DIRECT\"}")\"}" \
  prepaid-gas '30.0 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as $INSIDER_DIRECT network-config mainnet sign-with-keychain send
```
Screen: the failure text `customs: N of N tokens are locked until <unix s>; transferable now: 0`.
VO: "Every opening buy vests for 24 hours. The token contract refuses the move itself. No server is asked."

**0:30 to 0:40. The hidden funding.**
Screen: `https://nearblocks.io/txns/$WITHDRAW_TX`. Point at the receipt where `intents.near` pays `$INSIDER_INTENTS`, then the `dip4 native_withdraw` log whose `account_id` is `$CREATOR`.
VO: "This wallet looks funded by intents.near. The Intents withdraw event names the owner: our creator."

**0:40 to 0:62. The action: a challenge.**
```sh
near contract call-function as-transaction $TOKEN challenge \
  json-args "{\"wallet\":\"$INSIDER_INTENTS\",\"path\":[\"$WITHDRAW_TX\",\"$BUY_TX\"],\"bond\":\"$(echo $P | jq -r .min_bond)\"}" \
  prepaid-gas '300.0 Tgas' attached-deposit "$DEPOSIT yoctoNEAR" \
  sign-as $HUNTER network-config mainnet sign-with-keychain send
```
Screen: the tx hash it prints, opened on NearBlocks: `challenge` on `$TOKEN`, `request_execution` on `outlayer.near`, the resumed `on_verdict` receipt with the `wallet_seized` event. Then:
```sh
view opening_of "{\"account_id\":\"$INSIDER_INTENTS\"}"   # state: seized_frozen
view ft_balance_of "{\"account_id\":\"$HUNTER\"}"          # up by the seized amount
```
VO: "Two hashes in. An OutLayer enclave reads those receipts, checks the creator's money paid for the buy, and signs. The token checks that signature against its pinned key and pays the hunter 20 percent of the bag. The rest stays frozen."

**0:62 to 0:74. A planted path fails.**
```sh
near contract call-function as-transaction $TOKEN challenge \
  json-args "{\"wallet\":\"$OUTSIDER\",\"path\":[\"$DUST_TX\",\"$OUTSIDER_BUY_TX\"],\"bond\":\"$(echo $P | jq -r .min_bond)\"}" \
  prepaid-gas '300.0 Tgas' attached-deposit "$DEPOSIT yoctoNEAR" \
  sign-as $HUNTER network-config mainnet sign-with-keychain send
view forfeited '{}'
```
Screen: `challenge_rejected` event, `forfeited` up by the bond.
VO: "Money sent after the buy proves nothing. The verdict is rejected and the hunter loses the bond."

**0:74 to 0:82. Nobody can fake the verdict.**
```sh
near contract call-function as-transaction $TOKEN on_verdict \
  json-args '{"challenge_id":0}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' \
  sign-as $HUNTER network-config mainnet sign-with-keychain send
```
Screen: `Method on_verdict is private`.
VO: "Only the OutLayer callback reaches the verdict, and only the pinned key passes."

**0:82 to 0:90. NEAR's role, then the repo.**
Screen: the four lines below, then the repo URL.

## NEAR's role, as said in the voiceover

- **The NEP-141 contract is the rule.** `on_outbound` (contracts/token/src/lib.rs:549) runs before every `ft_transfer` and `ft_transfer_call` and holds unvested opening buys. Parameters are fixed at `new`; there is no owner method.
- **OutLayer on NEAR runs the check.** `challenge` calls `request_execution` on `outlayer.near` (lib.rs:537) with the checker wasm URL and sha256 fixed in params. NEAR yield/resume holds the challenge until the enclave answers; silence leaves the vest as it was and the bond reclaimable.
- **The contract verifies the enclave.** `pin_verdict_key` pins the key the module proves it signs with; `on_verdict` runs `env::ed25519_verify` against it (lib.rs:418) and checks token, wallet, challenge id, receipt hash and block.
- **NEAR Intents is read as evidence.** The `dip4 native_withdraw` event names the owner account behind an Intents payout (crates/walker/src/receipts.rs:126), so funding routed through `intents.near` stays traceable. Customs settles nothing through Intents.

The voiceover names these four and no other NEAR feature.

## Cut that runs today, before the mainnet run

For a rehearsal or a backup video, both against real code:

```sh
# the challenge flow in a sandbox beside the outlayer.near code read from mainnet block 222386104
RUST_TEST_NOCAPTURE=1 cargo test -p customs-tests --test token upheld_challenge_pays_exactly_twenty_percent_of_the_unvested_bag
RUST_TEST_NOCAPTURE=1 cargo test -p customs-tests --test token verdict_signed_by_another_key_changes_nothing

# the replay against mainnet
cargo install --path crates/walker --locked
customs-walker replay --token phire.nearlytrade.near --creator provenhire.near --placebo-creator justai.near
```

Prerequisites: `cargo-near`, `jq`, `curl`, network access to `archival-rpc.mainnet.fastnear.com` and `tx.main.fastnear.com`.
