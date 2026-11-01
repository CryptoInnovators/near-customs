#!/usr/bin/env bash
# Break one guard at a time, run the test that guards it, expect RED, restore, expect GREEN.
# Every mutation is applied to a real source file and restored from a copy taken before the run,
# so the working tree ends byte-identical (the script verifies that with git diff).
# usage: scripts/mutate.sh [name ...]   (no names = every mutation)
set -u
cd "$(dirname "$0")/.."
[ -f ../env.sh ] && source ../env.sh
# a private target dir keeps this run off the lock other cargo jobs hold on a shared one
export CARGO_TARGET_DIR="${CUSTOMS_TARGET:-$PWD/target}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
want=" $* "
fails=0
before=$(git diff -- contracts crates | md5)
ORIGS=()
restore_all() { for f in "${ORIGS[@]:-}"; do [ -n "$f" ] && cp "${f#*:}" "${f%%:*}"; done; }
trap restore_all EXIT

TOK=contracts/token/src/lib.rs
RULE=crates/walker/src/pathrule.rs
CHK=crates/checker/src/lib.rs

sandbox() { cargo test -p customs-tests --test token "$1" 2>&1; }
walker() { cargo test -p customs-walker --lib "$1" 2>&1; }
unit() { cargo test -p customs-token --lib "$1" 2>&1; }

# mut NAME FILE PATTERN REPLACEMENT RUNNER TEST
mut() {
  local name=$1 file=$2 pat=$3 rep=$4 runner=$5 test=$6
  if [ "$want" != "  " ]; then case "$want" in *" $name "*) ;; *) return;; esac; fi
  local orig; orig=$(mktemp); cp "$file" "$orig"; ORIGS+=("$file:$orig")
  if ! PAT="$pat" REP="$rep" perl -0pi -e 'BEGIN{$p=$ENV{PAT};$r=$ENV{REP}} $n = s/\Q$p\E/$r/; END{exit($n?0:3)}' "$file"; then
    echo "BAD MUTATION $name: pattern not found in $file"; fails=$((fails+1)); cp "$orig" "$file"; return
  fi
  local out rc; out=$($runner "$test"); rc=$?
  cp "$orig" "$file"
  local red="no"
  if [ $rc -ne 0 ] && echo "$out" | grep -q "test result: FAILED"; then red="yes"; fi
  out=$($runner "$test"); rc=$?
  local green="no"
  if [ $rc -eq 0 ] && echo "$out" | grep -q "test result: ok. [1-9]"; then green="yes"; fi
  if [ "$red" = yes ] && [ "$green" = yes ]; then
    echo "RED->GREEN $name | $file | guarded by $test"
  else
    echo "FAIL       $name | $file | guarded by $test | red=$red restored_green=$green"; fails=$((fails+1))
  fi

}

# ---- the hold -------------------------------------------------------------------------------
mut hold_balance_level $TOK 'balance - amount >= locked,' 'true,' sandbox opening_buyer_cannot_sell_or_move_unvested
mut hold_runs_on_ft_transfer $TOK $'        let sender = env::predecessor_account_id();\n        self.on_outbound(&sender, &receiver_id, amount.0, false);' $'        let sender = env::predecessor_account_id();' sandbox opening_buyer_cannot_sell_or_move_unvested
mut hold_runs_on_ft_transfer_call $TOK 'self.on_outbound(&sender, &receiver_id, amount.0, true);' '' sandbox opening_buyer_cannot_sell_or_move_unvested
mut vest_linear $TOK 'mul_div(self.bought.0, (vest_end - now) as u128, p.vest_s as u128)' 'self.bought.0' sandbox bag_vests_linearly_and_is_free_at_the_end
mut window_end $TOK 'if now < start + self.params.window_s {' 'if true {' sandbox buyer_after_the_window_is_never_held
mut market_call_guard $TOK 'require!(!is_call, "customs: the market pays opening buyers with ft_transfer");' 'let _ = 0;' sandbox market_cannot_pay_opening_buyers_through_a_call
# ---- challenge entry --------------------------------------------------------------------------
mut min_bond $TOK 'require!(bond.0 >= p.min_bond.0, "customs: bond is below min_bond");' 'let _ = 0;' sandbox challenge_guards
mut exact_deposit $TOK 'env::attached_deposit().as_yoctonear() == bond.0 + p.exec_fee.0' 'true' sandbox challenge_guards
mut registered_challenger $TOK 'self.token.accounts.contains_key(&challenger),' 'true,' sandbox challenge_guards
mut self_challenge $TOK 'require!(challenger != wallet, "customs: a wallet cannot challenge itself");' 'let _ = 0;' sandbox challenge_guards
mut path_length $TOK 'path.len() >= 2 && path.len() <= max_path_len(p.max_hops),' 'true,' sandbox challenge_guards
mut path_is_hashes $TOK 'require!(ok, "customs: every path entry must be a base58 transaction hash");' 'let _ = ok;' sandbox challenge_guards
mut one_open_challenge $TOK 'require!(!self.open_by_wallet.contains_key(&wallet), "customs: a challenge on this wallet is already open");' 'let _ = 0;' sandbox challenge_guards
mut seize_once $TOK 'require!(!bag.seized, "customs: wallet was already seized");' 'let _ = 0;' sandbox a_wallet_is_seized_once
mut key_pinned_first $TOK 'require!(self.verdict_key.is_some(), "customs: the verdict key is not pinned yet; call pin_verdict_key");' 'let _ = 0;' sandbox nothing_can_be_challenged_before_the_key_is_pinned
# ---- the key --------------------------------------------------------------------------------
mut pin_once $TOK 'require!(self.verdict_key.is_none(), "customs: the verdict key is already pinned");' 'let _ = 0;' sandbox the_key_is_pinned_once
mut pin_proof $TOK 'env::ed25519_verify(&sig, &pin_message(&out.token.to_string(), &out.public_key), &raw),' 'true,' sandbox a_key_the_module_did_not_prove_is_not_pinned
# ---- the verdict ------------------------------------------------------------------------------
mut verdict_signature $TOK 'env::ed25519_verify(&sig, &msg, &key)' 'true' sandbox verdict_signed_by_another_key_changes_nothing
mut verdict_fresh $TOK 'check(head - v.block <= p.max_age_blocks, "customs: verdict is stale")?;' 'let _ = 0;' sandbox stale_verdict_is_refused
mut verdict_block $TOK 'check(v.block == ch.created_block, "customs: verdict names another block than the challenge")?;' 'let _ = 0;' sandbox verdict_for_another_block_is_refused
mut verdict_receipts $TOK 'check(v.path_hash == ch.path_hash, "customs: verdict covers different receipts")?;' 'let _ = 0;' sandbox verdict_for_other_facts_is_refused
mut verdict_wallet $TOK 'check(v.wallet == ch.wallet, "customs: verdict names another wallet")?;' 'let _ = 0;' sandbox verdict_for_other_facts_is_refused
mut verdict_token $TOK 'check(v.token == env::current_account_id(), "customs: verdict names another token")?;' 'let _ = 0;' sandbox verdict_for_other_facts_is_refused
mut verdict_value $TOK 'check(v.verdict == VERDICT_UPHELD || v.verdict == VERDICT_REJECTED, "customs: unknown verdict value")?;' 'let _ = 0;' sandbox an_unknown_verdict_value_is_refused
mut on_verdict_private $TOK $'#[private]\n    pub fn on_verdict' 'pub fn on_verdict' sandbox on_verdict_is_private
mut on_pin_private $TOK $'#[private]\n    pub fn on_pin' 'pub fn on_pin' sandbox on_pin_is_private
# ---- the payout -------------------------------------------------------------------------------
mut payout_share $TOK 'mul_div(at_risk, p.seize_bps as u128, 10_000)' 'at_risk' sandbox upheld_challenge_pays_exactly_twenty_percent_of_the_unvested_bag
mut frozen_remainder $TOK 'return if now < self.frozen_until_s { self.frozen_amount.0 } else { 0 };' 'return 0;' sandbox upheld_challenge_pays_exactly_twenty_percent_of_the_unvested_bag
mut bond_returned_on_upheld $TOK 'let _ = near_sdk::Promise::new(ch.challenger.clone()).transfer(NearToken::from_yoctonear(ch.bond.0));' '' sandbox upheld_challenge_pays_exactly_twenty_percent_of_the_unvested_bag
mut bounty_vests $TOK 'let bounty = if now < window_start_s + p.vest_s { self.bounty.0 } else { 0 };' 'let bounty = 0u128;' sandbox seized_tokens_vest_with_the_hunter_so_a_self_challenge_unlocks_nothing
mut bond_forfeit $TOK 'self.forfeited += ch.bond.0;' 'let _ = near_sdk::Promise::new(ch.challenger.clone()).transfer(NearToken::from_yoctonear(ch.bond.0));' sandbox rejected_challenge_forfeits_the_bond_and_moves_nothing
# ---- silence ----------------------------------------------------------------------------------
mut reclaim_deadline $TOK 'env::block_height() >= ch.created_block + self.params.reclaim_blocks' 'true' sandbox a_challenge_still_waiting_for_the_enclave_cannot_be_reclaimed_or_cleared
mut reclaim_only_challenger $TOK 'require!(env::predecessor_account_id() == ch.challenger, "customs: only the challenger reclaims");' 'let _ = 0;' sandbox silent_enclave_leaves_the_vest_and_the_bond_reclaimable
# ---- a wallet can never be pinned behind a challenge -------------------------------------------
mut unanswered_frees_the_wallet $TOK $'        self.challenges.insert(challenge_id, ch.clone());\n        self.release(&ch.wallet, challenge_id);\n        self.event("challenge_unanswered"' $'        self.challenges.insert(challenge_id, ch.clone());\n        self.event("challenge_unanswered"' sandbox a_junk_challenge_that_is_never_reclaimed_cannot_pin_the_wallet
mut release_only_the_own_entry $TOK 'if self.open_by_wallet.get(wallet) == Some(&challenge_id) {' 'if true {' sandbox reclaiming_an_old_challenge_does_not_free_the_wallet_from_a_newer_one
mut payout_needs_a_registered_challenger $TOK 'check(self.token.accounts.contains_key(&ch.challenger), "customs: the challenger is not registered with the token")?;' 'let _ = 0;' sandbox a_challenger_who_leaves_the_token_cannot_pin_the_wallet_by_breaking_the_payout
mut clear_stale_deadline $TOK 'ch.state == ChallengeState::Pending && env::block_height() >= ch.created_block + self.params.reclaim_blocks,' 'true,' sandbox a_challenge_still_waiting_for_the_enclave_cannot_be_reclaimed_or_cleared
# ---- the opening is announced by the creator, not started by a quiet first sale ------------------
mut open_only_creator $TOK 'require!(env::predecessor_account_id() == self.params.creator_id, "customs: only the creator opens trading");' 'let _ = 0;' sandbox trading_is_announced_once_by_the_creator_with_notice_and_nothing_sells_before_it
mut open_notice $TOK 'require!(start_s >= now_s() + self.params.notice_s, "customs: trading must be announced at least notice_s ahead");' 'let _ = 0;' sandbox trading_is_announced_once_by_the_creator_with_notice_and_nothing_sells_before_it
mut open_once $TOK 'require!(self.window_start_s.is_none(), "customs: trading is already scheduled");' 'let _ = 0;' sandbox trading_is_announced_once_by_the_creator_with_notice_and_nothing_sells_before_it
mut market_needs_announcement $TOK 'let start = self.window_start_s.unwrap_or_else(|| env::panic_str("customs: trading has not been announced; the creator calls open_trading first"));' 'let start = self.window_start_s.unwrap_or(now);' sandbox a_market_transfer_before_trading_is_announced_fails
mut market_waits_for_start $TOK 'require!(now >= start, "customs: trading has not opened yet");' 'let _ = 0;' sandbox trading_is_announced_once_by_the_creator_with_notice_and_nothing_sells_before_it
mut creator_only_funds_market $TOK '*receiver == self.params.market_id || self.window_start_s.is_some_and(|s| now >= s + self.params.window_s),' 'true,' sandbox until_the_window_closes_the_creator_can_only_fund_the_market
# ---- the judge is fixed by the code, not chosen by the deployer ---------------------------------
mut judge_outlayer $TOK 'require!(p.outlayer_id.as_str() == OUTLAYER_ID, "customs: outlayer_id must be the published OutLayer contract");' 'let _ = 0;' unit a_foreign_outlayer_cannot_be_the_judge
mut judge_checker $TOK 'require!(p.module_sha256 == CHECKER_SHA256, "customs: module_sha256 must be the published checker module");' 'let _ = 0;' unit a_foreign_checker_cannot_be_the_judge
mut judge_https $TOK 'require!(p.module_url.starts_with("https://"), "customs: module_url must be an https url");' 'let _ = 0;' unit the_checker_is_fetched_over_https
mut creator_is_owner $TOK 'require!(params.creator_id == owner_id, "customs: the creator whose money a challenge traces is the owner who holds the supply");' 'let _ = 0;' unit a_decoy_creator_is_refused
mut init_by_the_token_account $TOK 'env::predecessor_account_id() == env::current_account_id(),
            "customs: only the token account initializes itself, in the transaction that deploys it"' 'true,
            "customs: only the token account initializes itself, in the transaction that deploys it"' unit nobody_else_can_initialize_a_deployed_token
mut seize_once_on_answer $TOK 'check(!bag.seized, "customs: wallet was already seized")?;' 'let _ = 0;' unit a_signed_upheld_answer_for_an_already_seized_wallet_applies_nothing
mut clear_stale_unit $TOK 'ch.state == ChallengeState::Pending && env::block_height() >= ch.created_block + self.params.reclaim_blocks,' 'ch.state == ChallengeState::Pending,' unit a_challenge_inside_the_wait_cannot_be_cleared
mut release_only_the_own_entry_unit $TOK 'if self.open_by_wallet.get(wallet) == Some(&challenge_id) {' 'if true {' unit clearing_an_old_challenge_leaves_a_newer_one_in_place
# ---- the rule the enclave applies -------------------------------------------------------------
mut rule_hop_limit_3 $RULE 'max_hops: 3, busy: vec![]' 'max_hops: 4, busy: vec![]' walker default_hop_limit_is_three
mut rule_hub_list $RULE 'hub_list().hubs.iter().any(|h| h == who)' 'false' walker a_hop_through_a_hub_is_rejected
mut rule_busy_wallet $RULE 'if i + 1 < path.len() && rule.busy.contains(&e.to) {' 'if false {' walker a_path_through_an_unlisted_busy_wallet_convicts_nothing
mut rule_before_buy $RULE 'if last.ts_ns >= buy.ts_ns {' 'if false {' walker dust_planted_after_the_buy_is_rejected
mut rule_half_cost_floor $RULE 'if e.yocto < floor {' 'if false {' walker dust_before_the_buy_is_rejected_by_the_half_cost_floor
mut rule_first_hop_creator $RULE 'if path[0].from != rule.creator {' 'if false {' walker broken_chain_and_wrong_start_and_wrong_end
mut rule_hop_order $RULE 'if path[i - 1].ts_ns >= e.ts_ns {' 'if false {' walker five_hops_is_too_long_and_hop_order_matters
mut intents_owner_decode crates/walker/src/receipts.rs 'e["standard"] != "dip4" || e["event"] != "native_withdraw"' 'true' walker real_intents_withdrawal_names_the_owner_not_the_relay
mut checker_busy_measured $CHK 'src.tx_count(&e.to)? > BUSY_TXS' 'false' sandbox a_path_through_an_unlisted_busy_wallet_convicts_nothing
mut checker_window $CHK 'if first.ts_ns < window_ns.0 || first.ts_ns >= window_ns.1 {' 'if false {' sandbox a_buy_outside_the_opening_window_is_rejected_by_the_enclave
mut checker_buy_is_market_sale $CHK 'm.from == market && m.to == wallet' 'm.to == wallet' sandbox a_transaction_that_is_not_a_market_sale_is_rejected_by_the_enclave
mut checker_path_hash $CHK 'if hex_lower(&Sha256::digest(path_hash_input(&path))) != path_hash {' 'if false {' sandbox the_enclave_refuses_a_path_hash_that_does_not_match_the_path

# ---- funding routes beyond native transfers ---------------------------------------------------
RCV=crates/walker/src/receipts.rs
mut wnear_edge $RCV 'out.push(Edge { tx: tx.hash.clone(), from, to, yocto: y, ts_ns: r.ts_ns, height: r.height, kind: EdgeKind::WrapTransfer });' 'let _ = (from, to, y, r);' walker real_wnear_ft_transfer_is_an_edge
mut intents_transfer_edge $RCV 'if y > 0 {' 'if false {' walker real_intents_internal_transfer_is_an_edge
mut function_call_deposit_edge $RCV 'if d > 0 {' 'if false {' walker a_function_call_deposit_to_the_wallet_is_an_edge
mut failed_receipt_moves_nothing $RCV 'r.recv == "wrap.near" && r.ok' 'r.recv == "wrap.near"' walker a_failed_receipt_moves_no_wnear
mut split_pieces_add_up $RCV 'prev.yocto += piece.yocto;' '' walker split_funding_is_one_hop_with_the_summed_amount
mut split_ends_at_a_stray_transaction $RCV 'None => break,' 'None => continue,' walker a_transaction_that_moves_nothing_from_the_hop_ends_the_walk
mut same_receiver_moves_add_up $RCV 'mine().filter(|x| x.to == e.to).map(|x| x.yocto).sum::<u128>()' 'e.yocto' walker several_moves_in_one_transaction_to_the_same_receiver_add_up
mut checker_split_allowance $CHK 'path.len() > max_path_len(max_hops)' 'false' sandbox a_path_with_more_transactions_than_the_split_allowance_gives_no_verdict

after=$(git diff -- contracts crates | md5)
[ "$before" = "$after" ] || { echo "WORKING TREE CHANGED BY THE RUN"; fails=$((fails+1)); }
echo "failures: $fails"
[ $fails -eq 0 ]
