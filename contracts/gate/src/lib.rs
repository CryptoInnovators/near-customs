//! Customs gate: an agent's vault that spends only on a Customs verdict.
//! The Customs oracle anchors ALLOW, WARN or BLOCK per launch. The agent's function-call key can call `buy` and nothing else.
//! `buy` releases funds on ALLOW and panics, moving nothing, on WARN, on BLOCK and on a launch with no anchored verdict.

use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{env, log, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum Key {
    Verdicts,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Anchored {
    pub verdict: String,
    pub reason: String,
    pub buyers: u32,
    pub funded: u32,
    pub evidence: String,
    pub block: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Gate {
    oracle: AccountId,
    agent: AccountId,
    venue: AccountId,
    max_per_buy: U128,
    verdicts: LookupMap<String, Anchored>,
}

#[near]
impl Gate {
    #[init]
    pub fn new(oracle: AccountId, agent: AccountId, venue: AccountId, max_per_buy: U128) -> Self {
        Self { oracle, agent, venue, max_per_buy, verdicts: LookupMap::new(Key::Verdicts) }
    }

    /// Oracle only. Stores the verdict for a launch; a later anchor replaces it.
    pub fn anchor(&mut self, token: String, verdict: String, reason: String, buyers: u32, funded: u32, evidence: String) {
        require!(env::predecessor_account_id() == self.oracle, "only the Customs oracle may anchor a verdict");
        require!(matches!(verdict.as_str(), "ALLOW" | "WARN" | "BLOCK"), "verdict must be ALLOW, WARN or BLOCK");
        require!(reason.len() <= 400 && evidence.len() <= 128 && token.len() <= 128, "field too long");
        let block = env::block_height();
        self.verdicts.insert(token.clone(), Anchored { verdict: verdict.clone(), reason, buyers, funded, evidence, block });
        log!("EVENT_JSON:{}", json!({ "standard": "customs_gate", "version": "1.0.0", "event": "anchored", "data": { "token": token, "verdict": verdict, "block": block } }));
    }

    pub fn verdict_of(&self, token: String) -> Option<Anchored> {
        self.verdicts.get(&token).cloned()
    }

    pub fn config(&self) -> (AccountId, AccountId, AccountId, U128) {
        (self.oracle.clone(), self.agent.clone(), self.venue.clone(), self.max_per_buy)
    }

    /// Agent only. Releases `amount` yoctoNEAR from the vault to the venue when the launch is ALLOW.
    pub fn buy(&mut self, token: String, amount: U128) -> Promise {
        require!(env::predecessor_account_id() == self.agent, "only the agent account may buy through the gate");
        require!(amount.0 <= self.max_per_buy.0, "amount is above the per-buy limit");
        let Some(v) = self.verdicts.get(&token) else {
            env::panic_str("NO VERDICT: Customs has not anchored a verdict for this launch, so the gate releases nothing");
        };
        if v.verdict != "ALLOW" {
            env::panic_str(&format!("{}: {} The gate releases nothing.", v.verdict, v.reason));
        }
        log!("EVENT_JSON:{}", json!({ "standard": "customs_gate", "version": "1.0.0", "event": "buy_cleared", "data": { "token": token, "amount": amount, "venue": self.venue } }));
        Promise::new(self.venue.clone()).transfer(NearToken::from_yoctonear(amount.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn as_account(id: AccountId) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(id).build());
    }
    fn gate() -> Gate {
        Gate::new(accounts(0), accounts(1), accounts(2), U128(10u128.pow(22)))
    }
    fn anchor(g: &mut Gate, token: &str, verdict: &str) {
        as_account(accounts(0));
        g.anchor(token.into(), verdict.into(), "Creator money paid 1 of 2 opening buyers.".into(), 2, 1, "ev".into());
    }

    #[test]
    #[should_panic(expected = "BLOCK: Creator money paid 1 of 2 opening buyers.")]
    fn block_is_refused_with_its_reason() {
        let mut g = gate();
        anchor(&mut g, "t.near", "BLOCK");
        as_account(accounts(1));
        g.buy("t.near".into(), U128(1));
    }

    #[test]
    #[should_panic(expected = "WARN:")]
    fn warn_is_refused() {
        let mut g = gate();
        anchor(&mut g, "t.near", "WARN");
        as_account(accounts(1));
        g.buy("t.near".into(), U128(1));
    }

    #[test]
    #[should_panic(expected = "NO VERDICT")]
    fn no_verdict_is_refused() {
        let mut g = gate();
        as_account(accounts(1));
        g.buy("t.near".into(), U128(1));
    }

    #[test]
    fn allow_releases_funds() {
        let mut g = gate();
        anchor(&mut g, "t.near", "ALLOW");
        as_account(accounts(1));
        let _ = g.buy("t.near".into(), U128(5));
        assert_eq!(g.verdict_of("t.near".into()).unwrap().verdict, "ALLOW");
    }

    #[test]
    #[should_panic(expected = "only the agent account")]
    fn a_stranger_cannot_buy() {
        let mut g = gate();
        anchor(&mut g, "t.near", "ALLOW");
        as_account(accounts(3));
        g.buy("t.near".into(), U128(1));
    }

    #[test]
    #[should_panic(expected = "only the Customs oracle")]
    fn a_stranger_cannot_anchor() {
        let mut g = gate();
        as_account(accounts(3));
        g.anchor("t.near".into(), "ALLOW".into(), "x".into(), 1, 0, "e".into());
    }

    #[test]
    #[should_panic(expected = "above the per-buy limit")]
    fn the_limit_holds() {
        let mut g = gate();
        anchor(&mut g, "t.near", "ALLOW");
        as_account(accounts(1));
        g.buy("t.near".into(), U128(10u128.pow(22) + 1));
    }
}
