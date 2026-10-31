# TESTS

## Suite

`cargo test --workspace`: 55 tests. 35 sandbox tests in `tests/tests/token.rs` (near-workspaces, the token wasm built with `cargo near` and the deployed OutLayer contract code read from mainnet at block 222386104, sha256 `4969ffe8a1d09f55183f94ca5e02c956e3374476699dbca251645dfa2aff403f`), 16 rule tests in `crates/walker`, 4 wire-format tests in `crates/common`. The sandbox tests that name an enclave run the checker module itself against a fake chain source, so the contract, the OutLayer yield/resume code and the checker are exercised together.

## Mutation check

`scripts/mutate.sh` copies the source file, breaks one guard with an exact-pattern replacement (the script fails the run if the pattern is not found), runs the test that guards it and requires red, restores the file, runs the test again and requires green, then verifies the working tree is byte-identical. Run on 2026-10-31:

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
RED->GREEN reclaim_deadline | contracts/token/src/lib.rs | guarded by silent_enclave_leaves_the_vest_and_the_bond_reclaimable_after_the_wait
RED->GREEN reclaim_only_challenger | contracts/token/src/lib.rs | guarded by silent_enclave_leaves_the_vest_and_the_bond_reclaimable_after_the_wait
RED->GREEN rule_hop_limit_3 | crates/walker/src/pathrule.rs | guarded by default_hop_limit_is_three
RED->GREEN rule_hub_list | crates/walker/src/pathrule.rs | guarded by a_hop_through_a_hub_is_rejected
RED->GREEN rule_busy_wallet | crates/walker/src/pathrule.rs | guarded by a_path_through_an_unlisted_busy_wallet_convicts_nothing
RED->GREEN rule_before_buy | crates/walker/src/pathrule.rs | guarded by dust_planted_after_the_buy_is_rejected
RED->GREEN rule_half_cost_floor | crates/walker/src/pathrule.rs | guarded by dust_before_the_buy_is_rejected_by_the_half_cost_floor
RED->GREEN rule_first_hop_creator | crates/walker/src/pathrule.rs | guarded by broken_chain_and_wrong_start_and_wrong_end
RED->GREEN rule_hop_order | crates/walker/src/pathrule.rs | guarded by five_hops_is_too_long_and_hop_order_matters
RED->GREEN checker_busy_measured | crates/checker/src/lib.rs | guarded by a_path_through_an_unlisted_busy_wallet_convicts_nothing
RED->GREEN checker_window | crates/checker/src/lib.rs | guarded by a_buy_outside_the_opening_window_is_rejected_by_the_enclave
RED->GREEN checker_buy_is_market_sale | crates/checker/src/lib.rs | guarded by a_transaction_that_is_not_a_market_sale_is_rejected_by_the_enclave
RED->GREEN checker_path_hash | crates/checker/src/lib.rs | guarded by the_enclave_refuses_a_path_hash_that_does_not_match_the_path
failures: 0
```

Every method that moves or gates value, and the mutation that guards it:

| Method | What it gates | Mutations |
|---|---|---|
| `ft_transfer`, `ft_transfer_call` (`on_outbound`) | no move into an opening buyer's unvested amount | hold_balance_level, hold_runs_on_ft_transfer, hold_runs_on_ft_transfer_call, vest_linear, window_end, market_call_guard |
| `challenge` | bond, exact deposit, registered challenger, no self challenge, path length, hash shape, one open challenge per wallet, one seizure per wallet, key pinned first | min_bond, exact_deposit, registered_challenger, self_challenge, path_length, path_is_hashes, one_open_challenge, seize_once, key_pinned_first |
| `pin_verdict_key`, `on_pin` | the verdict key is pinned once and only if the module proved it | pin_once, pin_proof, on_pin_private |
| `on_verdict` | signature, freshness, block, receipts, wallet, token, verdict value, caller | verdict_signature, verdict_fresh, verdict_block, verdict_receipts, verdict_wallet, verdict_token, verdict_value, on_verdict_private |
| payout | exactly 20% of the unvested bag, remainder frozen, bounty keeps vesting, bond returned or forfeited | payout_share, frozen_remainder, bond_returned_on_upheld, bounty_vests, bond_forfeit |
| `reclaim_bond` | silence leaves the vest alone, only the challenger reclaims, only after the wait | reclaim_deadline, reclaim_only_challenger |
| path rule | 3 hops, hub list, busy wallet, funding before the buy, half-cost floor, first hop from the creator, hop order | rule_hop_limit_3, rule_hub_list, rule_busy_wallet, rule_before_buy, rule_half_cost_floor, rule_first_hop_creator, rule_hop_order |
| checker | busy wallet measured on chain, buy inside the opening window, buy is a market sale, path hash matches the path | checker_busy_measured, checker_window, checker_buy_is_market_sale, checker_path_hash |

Hold-margin fix recorded during the run: `hold_is_balance_level_so_later_buys_stay_free` asserted a refusal one token past the free amount, and vesting between two sandbox blocks is larger than that, so it failed under load. The refused amount is now a tenth of the bag, which vesting cannot reach in a block.
