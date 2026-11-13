//! Customs stamp: a launch's creator posts a slashable NEAR bond that says none of the opening buyers is the creator's money.
//! A stranger who proves one was collects the bond. The judge is a WASI program whose sha256 is a constant of this code, run by
//! OutLayer in an enclave and answered through yield/resume; its verdict is accepted only if it verifies against the key pinned for
//! this contract. There is no owner and no setter: every rule is fixed in `new` and readable through `stamp_params`.

use customs_common::{hex_lower, max_path_len, path_hash_input, pin_message, verdict_message, VERDICT_REJECTED, VERDICT_UPHELD};
use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{env, log, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, PromiseError, PublicKey};

/// The OutLayer contract and the checker module this stamp asks. Constants, so the code hash attests to them.
pub const OUTLAYER_ID: &str = "outlayer.testnet";
pub const CHECKER_SHA256: &str = "fc72c7b662fc48ca497c9582a0b1aa8271e051d132283a9645cd5395b485f975";

const REQUEST_GAS: Gas = Gas::from_tgas(100);
const VERDICT_GAS: Gas = Gas::from_tgas(60);
const PIN_GAS: Gas = Gas::from_tgas(30);
const MIN_RECLAIM_BLOCKS: u64 = 201;
const MAX_VERDICT_BYTES: usize = 16 * 1024;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum Key {
    Stamps,
    Challenges,
    OpenByWallet,
}

#[derive(Clone)]
#[near(serializers = [borsh, json])]
pub struct Params {
    pub outlayer_id: AccountId,
    pub module_url: String,
    pub module_sha256: String,
    /// Smallest creator bond, yoctoNEAR.
    pub min_stamp: U128,
    /// Seconds a stamp's bond stays up before the creator may take it back.
    pub hold_s: u64,
    pub min_bond: U128,
    pub exec_fee: U128,
    pub reclaim_blocks: u64,
    pub max_age_blocks: u64,
    pub max_hops: u8,
}

#[derive(Clone, PartialEq, Debug)]
#[near(serializers = [borsh, json])]
pub enum StampState {
    Standing,
    Broken { prover: AccountId, wallet: AccountId, challenge_id: u64, paid: U128 },
    Released,
}

#[derive(Clone)]
#[near(serializers = [borsh, json])]
pub struct Stamp {
    pub launch: AccountId,
    pub creator: AccountId,
    pub market: AccountId,
    pub window_start_s: u64,
    pub window_end_s: u64,
    pub bond: U128,
    pub posted_s: u64,
    pub release_s: u64,
    /// Challenges on this launch that are filed and not yet closed.
    pub open: u32,
    pub state: StampState,
}

#[derive(Clone, PartialEq, Debug)]
#[near(serializers = [borsh, json])]
pub enum ChallengeState {
    Pending,
    Upheld { paid: U128 },
    Rejected,
    Reclaimed,
    /// The enclave gave no usable answer. Terminal; the filing bond is reclaimable.
    Unanswered,
}

#[derive(Clone)]
#[near(serializers = [borsh, json])]
pub struct Challenge {
    pub launch: AccountId,
    pub wallet: AccountId,
    pub challenger: AccountId,
    pub bond: U128,
    pub path: Vec<String>,
    pub path_hash: String,
    pub created_block: u64,
    pub state: ChallengeState,
}

#[derive(Clone)]
#[near(serializers = [json])]
pub struct PinOutput {
    pub token: AccountId,
    pub public_key: String,
    pub sig: String,
}

#[derive(Clone)]
#[near(serializers = [json])]
pub struct Verdict {
    pub token: AccountId,
    pub wallet: AccountId,
    pub challenge_id: u64,
    pub path_hash: String,
    pub verdict: String,
    pub block: u64,
    pub sig: String,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct StampBook {
    params: Params,
    verdict_key: Option<PublicKey>,
    stamps: LookupMap<AccountId, Stamp>,
    challenges: LookupMap<u64, Challenge>,
    open_by_wallet: LookupMap<(AccountId, AccountId), u64>,
    next_challenge: u64,
    forfeited: u128,
}

fn now_s() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

#[cfg(not(feature = "sandbox"))]
fn require_published_judge(p: &Params) {
    require!(p.outlayer_id.as_str() == OUTLAYER_ID, "stamp: outlayer_id must be the published OutLayer contract");
    require!(p.module_sha256 == CHECKER_SHA256, "stamp: module_sha256 must be the published checker module");
    require!(p.module_url.starts_with("https://"), "stamp: module_url must be an https url");
}

#[cfg(feature = "sandbox")]
fn require_published_judge(_: &Params) {}

#[near]
impl StampBook {
    #[init]
    pub fn new(params: Params) -> Self {
        require!(!env::state_exists(), "Already initialized");
        require_published_judge(&params);
        require!(params.max_hops > 0, "max_hops must be positive");
        require!(params.reclaim_blocks >= MIN_RECLAIM_BLOCKS, "reclaim_blocks must exceed the 200 block yield window");
        require!(params.max_age_blocks > 0, "max_age_blocks must be positive");
        require!(params.min_bond.0 > 0 && params.min_stamp.0 > 0, "min_bond and min_stamp must be positive");
        Self {
            params,
            verdict_key: None,
            stamps: LookupMap::new(Key::Stamps),
            challenges: LookupMap::new(Key::Challenges),
            open_by_wallet: LookupMap::new(Key::OpenByWallet),
            next_challenge: 0,
            forfeited: 0,
        }
    }

    /// The creator of `launch` posts the bond: the attached deposit. The window is the opening a challenge's buy must fall in.
    /// One stamp per launch, ever, so a broken stamp cannot be replaced by a fresh clean one.
    #[payable]
    pub fn post_stamp(&mut self, launch: AccountId, market: AccountId, window_start_s: u64, window_end_s: u64) {
        let creator = env::predecessor_account_id();
        let bond = env::attached_deposit().as_yoctonear();
        require!(bond >= self.params.min_stamp.0, "stamp: the bond is below min_stamp");
        require!(window_end_s > window_start_s, "stamp: the opening window must end after it starts");
        require!(creator != launch && market != launch, "stamp: the creator and the market are accounts other than the launch");
        require!(!self.stamps.contains_key(&launch), "stamp: this launch already has a stamp");
        let now = now_s();
        self.stamps.insert(
            launch.clone(),
            Stamp {
                launch: launch.clone(),
                creator: creator.clone(),
                market,
                window_start_s,
                window_end_s,
                bond: U128(bond),
                posted_s: now,
                release_s: now + self.params.hold_s,
                open: 0,
                state: StampState::Standing,
            },
        );
        self.event("stamp_posted", json!({"launch": launch, "creator": creator, "bond": U128(bond), "release_s": now + self.params.hold_s}));
    }

    /// Prove that the creator's money paid `wallet` before it bought. `path` is the hop transactions in order, then the buy.
    /// Attach `bond + exec_fee`. Upheld: the prover is paid the creator's bond and gets the filing bond back. Rejected: the filing
    /// bond is forfeited. No usable answer: the filing bond is reclaimable.
    #[payable]
    pub fn challenge(&mut self, launch: AccountId, wallet: AccountId, path: Vec<String>, bond: U128) -> near_sdk::Promise {
        let p = self.params.clone();
        let challenger = env::predecessor_account_id();
        require!(bond.0 >= p.min_bond.0, "stamp: bond is below min_bond");
        require!(env::attached_deposit().as_yoctonear() == bond.0 + p.exec_fee.0, "stamp: attach exactly bond + exec_fee");
        require!(self.verdict_key.is_some(), "stamp: the verdict key is not pinned yet; call pin_verdict_key");
        require!(challenger != wallet, "stamp: a wallet cannot challenge itself");
        require!(path.len() >= 2 && path.len() <= max_path_len(p.max_hops), "stamp: path is the hop transactions, then the opening buy");
        for h in &path {
            let ok = near_sdk::bs58::decode(h).into_vec().map(|b| b.len() == 32).unwrap_or(false);
            require!(ok, "stamp: every path entry must be a base58 transaction hash");
        }
        let mut stamp = self.stamps.get(&launch).cloned().unwrap_or_else(|| env::panic_str("stamp: this launch has no stamp"));
        require!(stamp.state == StampState::Standing, "stamp: this stamp is no longer standing");
        require!(wallet != stamp.creator || true, "");
        require!(!self.open_by_wallet.contains_key(&(launch.clone(), wallet.clone())), "stamp: a challenge on this wallet is already open");

        let id = self.next_challenge;
        self.next_challenge += 1;
        let path_hash = hex_lower(&env::sha256(&path_hash_input(&path)));
        self.challenges.insert(
            id,
            Challenge {
                launch: launch.clone(),
                wallet: wallet.clone(),
                challenger: challenger.clone(),
                bond,
                path: path.clone(),
                path_hash: path_hash.clone(),
                created_block: env::block_height(),
                state: ChallengeState::Pending,
            },
        );
        self.open_by_wallet.insert((launch.clone(), wallet.clone()), id);
        stamp.open += 1;
        self.stamps.insert(launch.clone(), stamp.clone());

        let input = json!({
            "op": "verify_funding_path",
            "token": launch,
            "creator": stamp.creator,
            "market": stamp.market,
            "wallet": wallet,
            "challenge_id": id,
            "path": path,
            "path_hash": path_hash,
            "max_hops": p.max_hops,
            "block": env::block_height(),
            "window_start_ns": stamp.window_start_s.saturating_sub(2) * 1_000_000_000,
            "window_end_ns": stamp.window_end_s * 1_000_000_000,
        })
        .to_string();
        self.event("challenge_filed", json!({"challenge_id": id, "launch": launch, "wallet": wallet, "challenger": challenger, "bond": bond, "path_hash": path_hash}));
        self.request_checker(input, challenger).then(Self::ext(env::current_account_id()).with_static_gas(VERDICT_GAS).on_verdict(id))
    }

    /// Ask the checker module for the key OutLayer derives for this contract, and pin it. Anyone, once. Attach `exec_fee`.
    #[payable]
    pub fn pin_verdict_key(&mut self) -> near_sdk::Promise {
        require!(self.verdict_key.is_none(), "stamp: the verdict key is already pinned");
        require!(env::attached_deposit().as_yoctonear() == self.params.exec_fee.0, "stamp: attach exactly exec_fee");
        let input = json!({"op": "public_key", "token": env::current_account_id()}).to_string();
        self.request_checker(input, env::predecessor_account_id()).then(Self::ext(env::current_account_id()).with_static_gas(PIN_GAS).on_pin())
    }

    #[private]
    pub fn on_pin(&mut self, #[callback_result] result: Result<Option<PinOutput>, PromiseError>) -> bool {
        let Ok(Some(out)) = result else {
            log!("stamp: no key answer; the key stays unpinned");
            return false;
        };
        if self.verdict_key.is_some() {
            return false;
        }
        require!(out.token == env::current_account_id(), "stamp: key answer names another account");
        let key: PublicKey = out.public_key.parse().unwrap_or_else(|_| env::panic_str("stamp: malformed public key"));
        require!(key.curve_type() == near_sdk::CurveType::ED25519, "stamp: the verdict key must be ed25519");
        let sig: [u8; 64] = near_sdk::bs58::decode(&out.sig).into_vec().ok().and_then(|b| b.try_into().ok()).unwrap_or_else(|| env::panic_str("stamp: malformed signature"));
        let raw: [u8; 32] = key.as_bytes()[1..].try_into().unwrap_or_else(|_| env::panic_str("stamp: malformed public key"));
        require!(env::ed25519_verify(&sig, &pin_message(&out.token.to_string(), &out.public_key), &raw), "stamp: the key answer is not signed by the key it reports");
        self.verdict_key = Some(key);
        self.event("verdict_key_pinned", json!({"public_key": out.public_key}));
        true
    }

    /// Callback of the OutLayer run. An answer that fails any check closes the challenge as `Unanswered`; this never panics on the
    /// content of an answer, so no answer can leave a stamp pinned behind a challenge nobody can resolve.
    #[private]
    pub fn on_verdict(&mut self, challenge_id: u64) -> bool {
        let ch = self.challenges.get(&challenge_id).cloned().unwrap_or_else(|| env::panic_str("stamp: unknown challenge"));
        if ch.state != ChallengeState::Pending {
            log!("stamp: challenge {} is already closed; the late answer changes nothing", challenge_id);
            return false;
        }
        let verdict = match self.judge(&ch, challenge_id) {
            Ok(v) => v,
            Err(why) => {
                self.close_unanswered(challenge_id, ch, &why);
                return false;
            }
        };
        let mut ch = ch;
        let mut stamp = self.stamps.get(&ch.launch).cloned().unwrap_or_else(|| env::panic_str("stamp: unknown stamp"));
        self.release_wallet(&ch, challenge_id);
        stamp.open = stamp.open.saturating_sub(1);
        if verdict.verdict == VERDICT_REJECTED {
            self.forfeited += ch.bond.0;
            ch.state = ChallengeState::Rejected;
            self.challenges.insert(challenge_id, ch.clone());
            self.stamps.insert(ch.launch.clone(), stamp);
            self.event("challenge_rejected", json!({"challenge_id": challenge_id, "launch": ch.launch, "wallet": ch.wallet, "forfeited": ch.bond}));
            return false;
        }
        let paid = stamp.bond.0 + ch.bond.0;
        stamp.state = StampState::Broken { prover: ch.challenger.clone(), wallet: ch.wallet.clone(), challenge_id, paid: U128(paid) };
        self.stamps.insert(ch.launch.clone(), stamp.clone());
        ch.state = ChallengeState::Upheld { paid: U128(paid) };
        self.challenges.insert(challenge_id, ch.clone());
        let _ = near_sdk::Promise::new(ch.challenger.clone()).transfer(NearToken::from_yoctonear(paid));
        self.event("stamp_broken", json!({"challenge_id": challenge_id, "launch": ch.launch, "wallet": ch.wallet, "prover": ch.challenger, "paid": U128(paid)}));
        true
    }

    /// Return the filing bond of a challenge the enclave never answered.
    pub fn reclaim_bond(&mut self, challenge_id: u64) -> near_sdk::Promise {
        let mut ch = self.challenges.get(&challenge_id).cloned().unwrap_or_else(|| env::panic_str("stamp: unknown challenge"));
        require!(env::predecessor_account_id() == ch.challenger, "stamp: only the challenger reclaims");
        match ch.state {
            ChallengeState::Pending => require!(env::block_height() >= ch.created_block + self.params.reclaim_blocks, "stamp: the enclave may still answer"),
            ChallengeState::Unanswered => {}
            _ => env::panic_str("stamp: challenge already resolved"),
        }
        if ch.state == ChallengeState::Pending {
            self.release_wallet(&ch, challenge_id);
            self.close_open(&ch.launch);
        }
        ch.state = ChallengeState::Reclaimed;
        self.challenges.insert(challenge_id, ch.clone());
        near_sdk::Promise::new(ch.challenger).transfer(NearToken::from_yoctonear(ch.bond.0))
    }

    /// The creator takes the bond back after `hold_s`, when the stamp still stands and no challenge is open.
    pub fn release_stamp(&mut self, launch: AccountId) -> near_sdk::Promise {
        let mut stamp = self.stamps.get(&launch).cloned().unwrap_or_else(|| env::panic_str("stamp: this launch has no stamp"));
        require!(env::predecessor_account_id() == stamp.creator, "stamp: only the creator releases the bond");
        require!(stamp.state == StampState::Standing, "stamp: this stamp is not standing");
        require!(now_s() >= stamp.release_s, "stamp: the bond is held until release_s");
        require!(stamp.open == 0, "stamp: a challenge is open on this launch");
        stamp.state = StampState::Released;
        let bond = stamp.bond.0;
        self.stamps.insert(launch.clone(), stamp.clone());
        self.event("stamp_released", json!({"launch": launch, "creator": stamp.creator, "bond": U128(bond)}));
        near_sdk::Promise::new(stamp.creator).transfer(NearToken::from_yoctonear(bond))
    }

    pub fn stamp_params(&self) -> Params {
        self.params.clone()
    }
    pub fn verdict_key(&self) -> Option<PublicKey> {
        self.verdict_key.clone()
    }
    pub fn stamp_of(&self, launch: AccountId) -> Option<Stamp> {
        self.stamps.get(&launch).cloned()
    }
    pub fn challenge_of(&self, challenge_id: u64) -> Option<Challenge> {
        self.challenges.get(&challenge_id).cloned()
    }
    pub fn forfeited(&self) -> U128 {
        U128(self.forfeited)
    }
}

impl StampBook {
    fn request_checker(&self, input: String, payer: AccountId) -> near_sdk::Promise {
        let p = &self.params;
        let args = json!({
            "source": { "WasmUrl": { "url": p.module_url, "hash": p.module_sha256, "build_target": "wasm32-wasip2" }},
            "resource_limits": { "max_instructions": 2_000_000_000u64, "max_memory_mb": 256, "max_execution_seconds": 60 },
            "input_data": input,
            "response_format": "Json",
            "payer_account_id": payer,
        })
        .to_string()
        .into_bytes();
        near_sdk::Promise::new(p.outlayer_id.clone()).function_call("request_execution".to_string(), args, NearToken::from_yoctonear(p.exec_fee.0), REQUEST_GAS)
    }

    fn judge(&self, ch: &Challenge, challenge_id: u64) -> Result<Verdict, String> {
        let bytes = env::promise_result_checked(0, MAX_VERDICT_BYTES).map_err(|_| "stamp: no verdict from the enclave".to_string())?;
        if bytes.is_empty() {
            return Err("stamp: no verdict from the enclave".into());
        }
        let v = match near_sdk::serde_json::from_slice::<Option<Verdict>>(&bytes) {
            Ok(Some(v)) => v,
            Ok(None) => return Err("stamp: no verdict from the enclave".into()),
            Err(e) => return Err(format!("stamp: the enclave's answer is not a verdict: {e}")),
        };
        let p = &self.params;
        let check = |ok: bool, why: &str| if ok { Ok(()) } else { Err(why.to_string()) };
        check(v.token == ch.launch, "stamp: verdict names another launch")?;
        check(v.wallet == ch.wallet, "stamp: verdict names another wallet")?;
        check(v.challenge_id == challenge_id, "stamp: verdict names another challenge")?;
        check(v.path_hash == ch.path_hash, "stamp: verdict covers different receipts")?;
        check(v.verdict == VERDICT_UPHELD || v.verdict == VERDICT_REJECTED, "stamp: unknown verdict value")?;
        let head = env::block_height();
        check(v.block == ch.created_block, "stamp: verdict names another block than the challenge")?;
        check(v.block <= head, "stamp: verdict names a future block")?;
        check(head - v.block <= p.max_age_blocks, "stamp: verdict is stale")?;
        let msg = verdict_message(&v.token.to_string(), &v.wallet.to_string(), v.challenge_id, &v.path_hash, &v.verdict, v.block);
        let sig: [u8; 64] = near_sdk::bs58::decode(&v.sig).into_vec().ok().and_then(|b| b.try_into().ok()).ok_or("stamp: malformed signature")?;
        let key: [u8; 32] = self.verdict_key.as_ref().ok_or("stamp: no pinned verdict key")?.as_bytes()[1..].try_into().map_err(|_| "stamp: malformed pinned key")?;
        check(env::ed25519_verify(&sig, &msg, &key), "stamp: verdict signature does not verify against the pinned key")?;
        if v.verdict == VERDICT_UPHELD {
            let stamp = self.stamps.get(&ch.launch).ok_or("stamp: unknown stamp")?;
            check(stamp.state == StampState::Standing, "stamp: the stamp was already broken or released")?;
        }
        Ok(v)
    }

    fn close_unanswered(&mut self, challenge_id: u64, mut ch: Challenge, why: &str) {
        ch.state = ChallengeState::Unanswered;
        self.challenges.insert(challenge_id, ch.clone());
        self.release_wallet(&ch, challenge_id);
        self.close_open(&ch.launch);
        self.event("challenge_unanswered", json!({"challenge_id": challenge_id, "launch": ch.launch, "wallet": ch.wallet, "reason": why}));
    }

    fn release_wallet(&mut self, ch: &Challenge, challenge_id: u64) {
        let k = (ch.launch.clone(), ch.wallet.clone());
        if self.open_by_wallet.get(&k) == Some(&challenge_id) {
            self.open_by_wallet.remove(&k);
        }
    }

    fn close_open(&mut self, launch: &AccountId) {
        if let Some(s) = self.stamps.get(launch).cloned() {
            let mut s = s;
            s.open = s.open.saturating_sub(1);
            self.stamps.insert(launch.clone(), s);
        }
    }

    fn event(&self, name: &str, data: near_sdk::serde_json::Value) {
        log!("EVENT_JSON:{}", json!({"standard":"customs_stamp","version":"1.0.0","event":name,"data":data}));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const E24: u128 = 10u128.pow(24);

    fn ctx(who: AccountId, deposit: u128, ts_s: u64) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(who).attached_deposit(NearToken::from_yoctonear(deposit)).block_timestamp(ts_s * 1_000_000_000).build());
    }
    fn params() -> Params {
        Params {
            outlayer_id: OUTLAYER_ID.parse().unwrap(),
            module_url: "https://example.org/checker.wasm".into(),
            module_sha256: CHECKER_SHA256.into(),
            min_stamp: U128(E24),
            hold_s: 1000,
            min_bond: U128(E24 / 10),
            exec_fee: U128(E24 / 100),
            reclaim_blocks: 300,
            max_age_blocks: 100,
            max_hops: 3,
        }
    }
    fn book() -> StampBook {
        ctx(accounts(0), 0, 100);
        StampBook::new(params())
    }

    #[test]
    #[should_panic(expected = "module_sha256 must be the published checker module")]
    fn a_stamp_pinned_to_another_checker_cannot_be_deployed() {
        ctx(accounts(0), 0, 100);
        let mut p = params();
        p.module_sha256 = "00".repeat(32);
        StampBook::new(p);
    }

    #[test]
    fn the_creator_posts_a_bond_and_only_one_stamp_per_launch_exists() {
        let mut b = book();
        ctx(accounts(1), 2 * E24, 200);
        b.post_stamp(accounts(2), accounts(3), 150, 750);
        let s = b.stamp_of(accounts(2)).unwrap();
        assert_eq!(s.bond.0, 2 * E24);
        assert_eq!(s.creator, accounts(1));
        assert_eq!(s.release_s, 1200);
        assert_eq!(s.state, StampState::Standing);
    }

    #[test]
    #[should_panic(expected = "this launch already has a stamp")]
    fn a_second_stamp_for_the_same_launch_is_refused() {
        let mut b = book();
        ctx(accounts(1), 2 * E24, 200);
        b.post_stamp(accounts(2), accounts(3), 150, 750);
        ctx(accounts(1), 2 * E24, 201);
        b.post_stamp(accounts(2), accounts(3), 150, 750);
    }

    #[test]
    #[should_panic(expected = "the bond is below min_stamp")]
    fn a_dust_bond_is_refused() {
        let mut b = book();
        ctx(accounts(1), E24 / 2, 200);
        b.post_stamp(accounts(2), accounts(3), 150, 750);
    }

    #[test]
    #[should_panic(expected = "the verdict key is not pinned yet")]
    fn a_challenge_waits_for_the_pinned_key() {
        let mut b = book();
        ctx(accounts(1), 2 * E24, 200);
        b.post_stamp(accounts(2), accounts(3), 150, 750);
        let h = "11111111111111111111111111111111".to_string();
        ctx(accounts(4), E24 / 10 + E24 / 100, 300);
        b.challenge(accounts(2), accounts(5), vec![h.clone(), h], U128(E24 / 10));
    }

    #[test]
    #[should_panic(expected = "the bond is held until release_s")]
    fn the_creator_cannot_pull_the_bond_early() {
        let mut b = book();
        ctx(accounts(1), 2 * E24, 200);
        b.post_stamp(accounts(2), accounts(3), 150, 750);
        ctx(accounts(1), 0, 900);
        b.release_stamp(accounts(2));
    }

    #[test]
    fn the_creator_takes_the_bond_back_after_the_hold() {
        let mut b = book();
        ctx(accounts(1), 2 * E24, 200);
        b.post_stamp(accounts(2), accounts(3), 150, 750);
        ctx(accounts(1), 0, 1300);
        let _ = b.release_stamp(accounts(2));
        assert_eq!(b.stamp_of(accounts(2)).unwrap().state, StampState::Released);
    }

    #[test]
    #[should_panic(expected = "only the creator releases the bond")]
    fn a_stranger_cannot_release_the_bond() {
        let mut b = book();
        ctx(accounts(1), 2 * E24, 200);
        b.post_stamp(accounts(2), accounts(3), 150, 750);
        ctx(accounts(4), 0, 1300);
        let _ = b.release_stamp(accounts(2));
    }
}
