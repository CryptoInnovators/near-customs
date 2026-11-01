# TESTS

## Suite

`cargo test --workspace`: 89 tests. 47 sandbox tests in `tests/tests/token.rs` (near-workspaces, the token wasm built with `cargo near --features sandbox` and the deployed OutLayer contract code read from mainnet at block 222386104, sha256 `4969ffe8a1d09f55183f94ca5e02c956e3374476699dbca251645dfa2aff403f`), 11 token unit tests in `contracts/token` (built without the sandbox feature, so they run the shipped judge check), 27 rule and receipt tests in `crates/walker`, 4 wire-format tests in `crates/common`. The sandbox tests that name an enclave run the checker module itself against a fake chain source, so the contract, the OutLayer yield/resume code and the checker are exercised together. When the checker cannot read a transaction the worker role answers as the real module does: the run fails and the token hears nothing.

The sandbox build differs from the shipped wasm in one place: the `sandbox` feature lifts the published-judge check in `new`, because the sandbox deploys OutLayer beside the token and runs its own checker build. The unit tests cover that check on the code that ships (`a_foreign_outlayer_cannot_be_the_judge`, `a_foreign_checker_cannot_be_the_judge`, `the_checker_is_fetched_over_https`).

Test fixtures live under `tests/` and `crates/walker/tests/fixtures/`: the sandbox plays only the enclave worker (a fixed ed25519 seed in `tests/src/lib.rs`) against the real `outlayer.near` contract code. Three fixtures are unedited mainnet transactions from `tx.main.fastnear.com`: `intents-withdraw-hx23fz.json` (Hx23FZyuBYeL7C2YuuSisSPBMdKkXdFu3BkhHZhNDUX6, an Intents `native_withdraw`), `wnear-ft-transfer-8b6aY7.json` (8B6aY7koTr2tp98ZUTiezajVbGmaPVuLUUH6mmkzSv9c, a `wrap.near` `ft_transfer` and its `Transfer` log line) and `intents-transfer-49VuVm.json` (49VuVmyCkdxEfWh9SXjsFAqhMKEttRqzrDcdA8MZDUak, a `dip4 transfer` of `nep141:wrap.near`).

## Failing-test-first record for the 2026-11-01 fix pass

| Finding | Red, before the fix | Green, after |
|---|---|---|
| A junk challenge pins a wallet for the whole vest | `a_junk_challenge_that_is_never_reclaimed_cannot_pin_the_wallet`: `left: String("Pending") right: "Unanswered"`; `an_answer_that_cannot_be_applied_never_pins_the_wallet`: `Smart contract panicked: customs: verdict signature does not verify against the pinned key` (the callback panicked and rolled back) | both pass; the tests that expected a panicking callback now expect a closed `Unanswered` challenge, and all pass |
| Funding by wNEAR, Intents transfer, function call deposit, split transfers | 7 of 8 new rule tests failed (`cargo test -p customs-walker --lib receipts`: `test result: FAILED. 6 passed; 7 failed`), `funding_split_across_transactions_is_upheld_when_the_pieces_add_up` failed with `path must hold 1..=max_hops hop transactions and then the buy` | `cargo test -p customs-walker`: `test result: ok. 25 passed` then 27 |
| Intents events accepted from any contract's logs | `an_intents_event_logged_by_any_other_contract_is_not_evidence` failed (a forged `dip4` line printed by `evil.near` produced edges) | passes; `intents_withdraw_emitter` and `intents_transfer_emitter` go red when either filter is removed |
| The deployer picks the judge, the opening starts on a quiet first sale | the guards are new: each is covered by a mutation that goes red (below) | 11 unit tests and 4 sandbox tests pass |

## Mutation check

`scripts/mutate.sh` copies the source file, breaks one guard with an exact-pattern replacement (the script fails the run if the pattern is not found), runs the test that guards it and requires red, restores the file, runs the test again and requires green, then verifies the working tree is byte-identical. Full run on 2026-11-01 after the fix pass (the first 12 lines at commit 8620d67, the other 63 at commit a882097; CARGO_BUILD_JOBS=2):

```

RED->GREEN hold_balance_level | contracts/token/src/lib.rs | guarded by opening_buyer_cannot_sell_or_move_unvested
RED->GREEN hold_runs_on_ft_transfer | contracts/token/src/lib.rs | guarded by opening_buyer_cannot_sell_or_move_unvested
RED->GREEN hold_runs_on_ft_transfer_call | contracts/token/src/lib.rs | guarded by opening_buyer_cannot_sell_or_move_unvested
RED->GREEN vest_linear | contracts/token/src/lib.rs | guarded by bag_vests_linearly_and_is_free_at_the_end
RED->GREEN window_end | contracts/token/src/lib.rs | guarded by buyer_after_the_window_is_never_held
RED->GREEN market_call_guard | contracts/token/src/lib.rs | guarded by market_cannot_pay_opening_buyers_through_a_call
RED->GREEN min_bond | contracts/token/src/lib.rs | guarded by challenge_guards
RED->GREEN exact_deposit | contracts/token/src/lib.rs | guarded by challenge_guards
RED->GREEN registered_challenger | contracts/token/src/lib.rs | guarded by challenge_guards
RED->GREEN self_challenge | contracts/token/src/lib.rs | guarded by challenge_guards
RED->GREEN path_length | contracts/token/src/lib.rs | guarded by challenge_guards
RED->GREEN path_is_hashes | contracts/token/src/lib.rs | guarded by challenge_guards
RED->GREEN one_open_challenge | contracts/token/src/lib.rs | guarded by challenge_guards
RED->GREEN seize_once | contracts/token/src/lib.rs | guarded by a_wallet_is_seized_once
RED->GREEN key_pinned_first | contracts/token/src/lib.rs | guarded by nothing_can_be_challenged_before_the_key_is_pinned
RED->GREEN pin_once | contracts/token/src/lib.rs | guarded by the_key_is_pinned_once
RED->GREEN pin_proof | contracts/token/src/lib.rs | guarded by a_key_the_module_did_not_prove_is_not_pinned
RED->GREEN verdict_signature | contracts/token/src/lib.rs | guarded by verdict_signed_by_another_key_changes_nothing
RED->GREEN verdict_fresh | contracts/token/src/lib.rs | guarded by stale_verdict_is_refused
RED->GREEN verdict_block | contracts/token/src/lib.rs | guarded by verdict_for_another_block_is_refused
RED->GREEN verdict_receipts | contracts/token/src/lib.rs | guarded by verdict_for_other_facts_is_refused
RED->GREEN verdict_wallet | contracts/token/src/lib.rs | guarded by verdict_for_other_facts_is_refused
RED->GREEN verdict_token | contracts/token/src/lib.rs | guarded by verdict_for_other_facts_is_refused
RED->GREEN verdict_value | contracts/token/src/lib.rs | guarded by an_unknown_verdict_value_is_refused
RED->GREEN on_verdict_private | contracts/token/src/lib.rs | guarded by on_verdict_is_private
RED->GREEN on_pin_private | contracts/token/src/lib.rs | guarded by on_pin_is_private
RED->GREEN payout_share | contracts/token/src/lib.rs | guarded by upheld_challenge_pays_exactly_twenty_percent_of_the_unvested_bag
RED->GREEN frozen_remainder | contracts/token/src/lib.rs | guarded by upheld_challenge_pays_exactly_twenty_percent_of_the_unvested_bag
RED->GREEN bond_returned_on_upheld | contracts/token/src/lib.rs | guarded by upheld_challenge_pays_exactly_twenty_percent_of_the_unvested_bag
RED->GREEN bounty_vests | contracts/token/src/lib.rs | guarded by seized_tokens_vest_with_the_hunter_so_a_self_challenge_unlocks_nothing
RED->GREEN bond_forfeit | contracts/token/src/lib.rs | guarded by rejected_challenge_forfeits_the_bond_and_moves_nothing
RED->GREEN reclaim_deadline | contracts/token/src/lib.rs | guarded by a_challenge_still_waiting_for_the_enclave_cannot_be_reclaimed_or_cleared
RED->GREEN reclaim_only_challenger | contracts/token/src/lib.rs | guarded by silent_enclave_leaves_the_vest_and_the_bond_reclaimable
RED->GREEN unanswered_frees_the_wallet | contracts/token/src/lib.rs | guarded by a_junk_challenge_that_is_never_reclaimed_cannot_pin_the_wallet
RED->GREEN release_only_the_own_entry | contracts/token/src/lib.rs | guarded by reclaiming_an_old_challenge_does_not_free_the_wallet_from_a_newer_one
RED->GREEN payout_needs_a_registered_challenger | contracts/token/src/lib.rs | guarded by a_challenger_who_leaves_the_token_cannot_pin_the_wallet_by_breaking_the_payout
RED->GREEN clear_stale_deadline | contracts/token/src/lib.rs | guarded by a_challenge_still_waiting_for_the_enclave_cannot_be_reclaimed_or_cleared
RED->GREEN open_only_creator | contracts/token/src/lib.rs | guarded by trading_is_announced_once_by_the_creator_with_notice_and_nothing_sells_before_it
RED->GREEN open_notice | contracts/token/src/lib.rs | guarded by trading_is_announced_once_by_the_creator_with_notice_and_nothing_sells_before_it
RED->GREEN open_once | contracts/token/src/lib.rs | guarded by trading_is_announced_once_by_the_creator_with_notice_and_nothing_sells_before_it
RED->GREEN pool_floor | contracts/token/src/lib.rs | guarded by trading_cannot_be_announced_for_a_pool_that_is_not_funded
RED->GREEN market_needs_announcement | contracts/token/src/lib.rs | guarded by a_market_transfer_before_trading_is_announced_fails
RED->GREEN market_waits_for_start | contracts/token/src/lib.rs | guarded by trading_is_announced_once_by_the_creator_with_notice_and_nothing_sells_before_it
RED->GREEN creator_only_funds_market | contracts/token/src/lib.rs | guarded by until_the_window_closes_the_creator_can_only_fund_the_market
RED->GREEN judge_outlayer | contracts/token/src/lib.rs | guarded by a_foreign_outlayer_cannot_be_the_judge
RED->GREEN judge_checker | contracts/token/src/lib.rs | guarded by a_foreign_checker_cannot_be_the_judge
RED->GREEN judge_https | contracts/token/src/lib.rs | guarded by the_checker_is_fetched_over_https
RED->GREEN creator_is_owner | contracts/token/src/lib.rs | guarded by a_decoy_creator_is_refused
RED->GREEN init_by_the_token_account | contracts/token/src/lib.rs | guarded by nobody_else_can_initialize_a_deployed_token
RED->GREEN seize_once_on_answer | contracts/token/src/lib.rs | guarded by a_signed_upheld_answer_for_an_already_seized_wallet_applies_nothing
RED->GREEN clear_stale_unit | contracts/token/src/lib.rs | guarded by a_challenge_inside_the_wait_cannot_be_cleared
RED->GREEN release_only_the_own_entry_unit | contracts/token/src/lib.rs | guarded by clearing_an_old_challenge_leaves_a_newer_one_in_place
RED->GREEN rule_hop_limit_3 | crates/walker/src/pathrule.rs | guarded by default_hop_limit_is_three
RED->GREEN rule_hub_list | crates/walker/src/pathrule.rs | guarded by a_hop_through_a_hub_is_rejected
RED->GREEN rule_busy_wallet | crates/walker/src/pathrule.rs | guarded by a_path_through_an_unlisted_busy_wallet_convicts_nothing
RED->GREEN rule_before_buy | crates/walker/src/pathrule.rs | guarded by dust_planted_after_the_buy_is_rejected
RED->GREEN rule_half_cost_floor | crates/walker/src/pathrule.rs | guarded by dust_before_the_buy_is_rejected_by_the_half_cost_floor
RED->GREEN rule_first_hop_creator | crates/walker/src/pathrule.rs | guarded by broken_chain_and_wrong_start_and_wrong_end
RED->GREEN rule_hop_order | crates/walker/src/pathrule.rs | guarded by five_hops_is_too_long_and_hop_order_matters
RED->GREEN intents_owner_decode | crates/walker/src/receipts.rs | guarded by real_intents_withdrawal_names_the_owner_not_the_relay
RED->GREEN checker_busy_measured | crates/checker/src/lib.rs | guarded by a_path_through_an_unlisted_busy_wallet_convicts_nothing
RED->GREEN checker_window | crates/checker/src/lib.rs | guarded by a_buy_outside_the_opening_window_is_rejected_by_the_enclave
RED->GREEN checker_buy_is_market_sale | crates/checker/src/lib.rs | guarded by a_transaction_that_is_not_a_market_sale_is_rejected_by_the_enclave
RED->GREEN checker_path_hash | crates/checker/src/lib.rs | guarded by the_enclave_refuses_a_path_hash_that_does_not_match_the_path
RED->GREEN wnear_edge | crates/walker/src/receipts.rs | guarded by real_wnear_ft_transfer_is_an_edge
RED->GREEN intents_transfer_edge | crates/walker/src/receipts.rs | guarded by real_intents_internal_transfer_is_an_edge
RED->GREEN function_call_deposit_edge | crates/walker/src/receipts.rs | guarded by a_function_call_deposit_to_the_wallet_is_an_edge
RED->GREEN failed_receipt_moves_nothing | crates/walker/src/receipts.rs | guarded by a_failed_receipt_moves_no_wnear
RED->GREEN split_pieces_add_up | crates/walker/src/receipts.rs | guarded by split_funding_is_one_hop_with_the_summed_amount
RED->GREEN split_ends_at_a_stray_transaction | crates/walker/src/receipts.rs | guarded by a_transaction_that_moves_nothing_from_the_hop_ends_the_walk
RED->GREEN same_receiver_moves_add_up | crates/walker/src/receipts.rs | guarded by several_moves_in_one_transaction_to_the_same_receiver_add_up
RED->GREEN intents_withdraw_emitter | crates/walker/src/receipts.rs | guarded by an_intents_event_logged_by_any_other_contract_is_not_evidence
RED->GREEN intents_transfer_emitter | crates/walker/src/receipts.rs | guarded by an_intents_event_logged_by_any_other_contract_is_not_evidence
RED->GREEN wnear_refund_netting | crates/walker/src/receipts.rs | guarded by a_wnear_transfer_the_receiver_gave_back_is_netted
RED->GREEN checker_split_allowance | crates/checker/src/lib.rs | guarded by a_path_with_more_transactions_than_the_split_allowance_gives_no_verdict
failures: 0
```

Every method that moves or gates value, and the mutation that guards it:

| Method | What it gates | Mutations |
|---|---|---|
| `ft_transfer`, `ft_transfer_call` (`on_outbound`) | no move into an opening buyer's unvested amount | hold_balance_level, hold_runs_on_ft_transfer, hold_runs_on_ft_transfer_call, vest_linear, window_end, market_call_guard |
| `challenge` | bond, exact deposit, registered challenger, no self challenge, path length, hash shape, one open challenge per wallet, one seizure per wallet, key pinned first, path split no wider than the allowance | min_bond, exact_deposit, registered_challenger, self_challenge, path_length, path_is_hashes, one_open_challenge, seize_once, key_pinned_first |
| `pin_verdict_key`, `on_pin` | the verdict key is pinned once and only if the module proved it | pin_once, pin_proof, on_pin_private |
| `on_verdict` (`judge`, `close_unanswered`, `release`) | signature, freshness, block, receipts, wallet, token, verdict value, caller; every answer that cannot be applied closes the challenge `Unanswered`, frees the wallet and never panics; an upheld answer needs a registered challenger and an unseized wallet | verdict_signature, verdict_fresh, verdict_block, verdict_receipts, verdict_wallet, verdict_token, verdict_value, on_verdict_private, unanswered_frees_the_wallet, release_only_the_own_entry, release_only_the_own_entry_unit, payout_needs_a_registered_challenger, seize_once_on_answer |
| payout | exactly 20% of the unvested bag, remainder frozen, bounty keeps vesting, bond returned or forfeited | payout_share, frozen_remainder, bond_returned_on_upheld, bounty_vests, bond_forfeit |
| `reclaim_bond`, `clear_stale` | an unanswered challenge's bond is reclaimable at once, a pending one only after the wait, only by the challenger; a pending challenge older than the wait frees its wallet and touches no bond | reclaim_deadline, reclaim_only_challenger, clear_stale_deadline, clear_stale_unit |
| Intents decoder | a withdrawal through `intents.near` is attributed to the owner account named in the `dip4 native_withdraw` event, never to the relay | intents_owner_decode |
| path rule | 3 hops, hub list, busy wallet, funding before the buy, half-cost floor, first hop from the creator, hop order | rule_hop_limit_3, rule_hub_list, rule_busy_wallet, rule_before_buy, rule_half_cost_floor, rule_first_hop_creator, rule_hop_order |
| checker | busy wallet measured on chain, buy inside the opening window, buy is a market sale, path hash matches the path | checker_busy_measured, checker_window, checker_buy_is_market_sale, checker_path_hash |
| `new` | the deployer cannot choose the judge: OutLayer id, checker sha256, https url, creator is the owner, only the token account initializes it | judge_outlayer, judge_checker, judge_https, creator_is_owner, init_by_the_token_account |
| `open_trading`, `on_outbound` (market and creator) | one announcement by the creator with notice, for a funded pool; the market pays nobody before the announced start; until the window closes the creator moves tokens only to the market | open_only_creator, open_notice, open_once, pool_floor, market_needs_announcement, market_waits_for_start, creator_only_funds_market |
| funding edges | wNEAR transfers (refunds netted), Intents transfers, function call deposits count as funding; Intents events count only when `intents.near` logged them; split funding adds up per hop within the allowance | wnear_edge, wnear_refund_netting, intents_transfer_edge, intents_withdraw_emitter, intents_transfer_emitter, function_call_deposit_edge, failed_receipt_moves_nothing, split_pieces_add_up, split_ends_at_a_stray_transaction, same_receiver_moves_add_up, checker_split_allowance |

Hold-margin fix recorded during the run: `hold_is_balance_level_so_later_buys_stay_free` asserted a refusal one token past the free amount, and vesting between two sandbox blocks is larger than that, so it failed under load. The refused amount is now a tenth of the bag, which vesting cannot reach in a block.

Intents decoder mutation run on 2026-11-01 (`scripts/mutate.sh intents_owner_decode`, CARGO_BUILD_JOBS=2): the guard `e["standard"] != "dip4" || e["event"] != "native_withdraw"` replaced by `true` turns `real_intents_withdrawal_names_the_owner_not_the_relay` red, the restored file turns it green:

```
RED->GREEN intents_owner_decode | crates/walker/src/receipts.rs | guarded by real_intents_withdrawal_names_the_owner_not_the_relay
failures: 0
```

## Demo page network layer and serial-buyer analysis

`scripts/check-web.sh` (also the first step of `scripts/check.sh`, so GitHub Actions runs it): `node --check web/app.js`, `node --test web/test/net.test.mjs` (5 tests, `postWithRetry` in `web/net.js` with a scripted fetch), `python3 -m unittest discover -s spikes -p 'test_*.py'` (3 tests, `spikes/serial.py` on synthetic launches and on the real replay files). The retry covers the refused connections and rate limits that a public endpoint returns under load: in a mainnet run on 2026-11-01 the page absorbed 5 failed requests in one trace and finished with 24 of 24 buyers traced.

Mutation checks run on 2026-11-01:

```
mutation: web/net.js  `res.status === 429 || res.status >= 500` -> `false`
  RED   ✖ 429 and 5xx are retried, and the last one is returned when all tries fail
restored
  GREEN ℹ pass 5, ℹ fail 0

mutation: spikes/serial.py  `len(ls) >= k` -> `len(ls) > k`
  RED   FAILED (failures=1)   Ran 3 tests
restored
  GREEN OK   Ran 3 tests
```

## Testnet network selection

Baseline: `cargo test -p customs-walker --features testnet --lib wnear_edge_testnet` failed because the `testnet` feature did not exist. After C1, the testnet wNEAR fixture and the mainnet `real_wnear_ft_transfer_is_an_edge` fixture each passed.

Targeted mutations ran with `CARGO_BUILD_JOBS=2` in `/tmp/customs-c1-target`:

```
RED->GREEN testnet_judge | contracts/token/src/lib.rs | guarded by testnet_judge_is_pinned
RED->GREEN testnet_wrap | crates/walker/src/net.rs | guarded by wnear_edge_testnet
failures: 0
```

The target directory was isolated because another build held the shared Cargo target lock. CI is responsible for the release WASI artifacts and full workspace suite.

## Window-buyer registration

`cargo test -p customs-tests --test token an_unregistered_window_buyer_still_gets_a_bag -- --exact` failed before C4 with `The account unregistered.test.near is not registered`. After registering the receiver before recording its opening bag, the same test passed and `opening_of` reports `vesting`.

The targeted `scripts/mutate.sh window_buyer_registered` run removed the registration branch, failed the buyer test, restored the source and passed it:

```
RED->GREEN window_buyer_registered | contracts/token/src/lib.rs | guarded by an_unregistered_window_buyer_still_gets_a_bag
failures: 0
```
