#!/usr/bin/env bash
# Break one guard at a time in the token source, run the test that guards it, expect RED, restore.
# Ends with the full suite on the restored source, expecting GREEN.
# usage: scripts/mutate.sh [name ...]   (no names = every mutation)
set -u
cd "$(dirname "$0")/.."
[ -f ../env.sh ] && source ../env.sh
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target}"
SRC=contracts/token/src/lib.rs
ORIG=$(mktemp)
cp "$SRC" "$ORIG"
trap 'cp "$ORIG" "$SRC"' EXIT
want=" $* "
fails=0

mut() {
  local name=$1 pat=$2 rep=$3 test=$4
  if [ "$want" != "  " ]; then case "$want" in *" $name "*) ;; *) return;; esac; fi
  cp "$ORIG" "$SRC"
  PAT="$pat" REP="$rep" perl -0pi -e 'BEGIN{$p=$ENV{PAT};$r=$ENV{REP}} $n = s/\Q$p\E/$r/; END{exit($n?0:3)}' "$SRC" \
    || { echo "BAD MUTATION $name: pattern not found"; fails=$((fails+1)); return; }
  local out rc
  out=$(cargo test -p customs-tests --test token "$test" -- --exact 2>&1); rc=$?
  cp "$ORIG" "$SRC"
  if [ $rc -ne 0 ] && echo "$out" | grep -q "test result: FAILED"; then
    echo "RED       $name | guarded by $test | $(echo "$out" | grep -m1 -E 'panicked at|assertion' | cut -c1-150)"
  else
    echo "NOT RED   $name | guarded by $test   <<< test does not guard this"; fails=$((fails+1))
  fi
}

mut hold 'balance - amount >= locked,' 'true,' opening_buyer_cannot_sell_or_move_unvested
mut signature 'env::ed25519_verify(&sig, &msg, &key)' 'true' verdict_signed_by_another_key_changes_nothing
mut payout_share 'mul_div(at_risk, p.seize_bps as u128, 10_000)' 'at_risk' upheld_challenge_pays_exactly_twenty_percent_of_the_unvested_bag
mut stale 'require!(head - v.block <= p.max_age_blocks, "customs: verdict is stale");' 'let _ = 0;' stale_verdict_is_refused
mut predates 'require!(v.block >= ch.created_block, "customs: verdict predates the challenge");' 'let _ = 0;' verdict_older_than_the_challenge_is_refused
mut receipts_bound 'require!(v.path_hash == ch.path_hash, "customs: verdict covers different receipts");' 'let _ = 0;' verdict_for_other_facts_is_refused
mut wallet_bound 'require!(v.wallet == ch.wallet, "customs: verdict names another wallet");' 'let _ = 0;' verdict_for_other_facts_is_refused
mut token_bound 'require!(v.token == env::current_account_id(), "customs: verdict names another token");' 'let _ = 0;' verdict_for_other_facts_is_refused
mut private_callback $'#[private]\n    pub fn on_verdict' 'pub fn on_verdict' on_verdict_is_private
mut reclaim_deadline 'env::block_height() >= ch.created_block + self.params.reclaim_blocks' 'true' silent_enclave_leaves_the_vest_and_the_bond_reclaimable_after_the_wait
mut window_end 'if now < start + self.params.window_s {' 'if true {' buyer_after_the_window_is_never_held
mut bond_forfeit 'self.forfeited += ch.bond.0;' 'let _ = near_sdk::Promise::new(ch.challenger.clone()).transfer(NearToken::from_yoctonear(ch.bond.0));' rejected_challenge_forfeits_the_bond_and_moves_nothing
mut one_open_challenge 'require!(!self.open_by_wallet.contains_key(&wallet), "customs: a challenge on this wallet is already open");' 'let _ = 0;' challenge_guards
mut seize_once 'require!(!bag.seized, "customs: wallet was already seized");' 'let _ = 0;' a_wallet_is_seized_once
mut frozen_remainder 'return if now < self.frozen_until_s { self.frozen_amount.0 } else { 0 };' 'return 0;' upheld_challenge_pays_exactly_twenty_percent_of_the_unvested_bag
mut market_call_guard 'require!(!is_call, "customs: the market pays opening buyers with ft_transfer");' 'let _ = 0;' market_cannot_pay_opening_buyers_through_a_call
mut min_bond 'require!(bond.0 >= p.min_bond.0, "customs: bond is below min_bond");' 'let _ = 0;' challenge_guards
mut exact_deposit 'env::attached_deposit().as_yoctonear() == bond.0 + p.exec_fee.0' 'true' challenge_guards
mut registered_challenger 'self.token.accounts.contains_key(&challenger),' 'true,' challenge_guards
mut vest_linear 'mul_div(self.bought.0, (vest_end - now) as u128, p.vest_s as u128)' 'self.bought.0' bag_vests_linearly_and_is_free_at_the_end

cp "$ORIG" "$SRC"
echo "restored source; full suite:"
cargo test -p customs-tests --test token 2>&1 | grep -E "^test |test result"
[ $fails -eq 0 ]
