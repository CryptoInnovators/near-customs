//! Customs: a NEP-141 memecoin whose opening buyers vest by contract and can be seized from
//! by anyone who proves, through an OutLayer enclave verdict, that the creator's money paid
//! for the buy. The vest floor never depends on a backend. The verdict can only convict.

use customs_common::{hex_lower, max_path_len, path_hash_input, pin_message, verdict_message, VERDICT_REJECTED, VERDICT_UPHELD};
use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::borsh::BorshSerialize;
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, log, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    PromiseError, PromiseOrValue, PublicKey,
};

/// The OutLayer contract every Customs token asks, fixed in the code so the token's code hash attests to it.
pub const OUTLAYER_ID: &str = "outlayer.near";
/// sha256 of the checker module every Customs token asks OutLayer to run: `scripts/build-checker.sh` on
/// x86_64 Linux with the pinned toolchain (cargo mixes the host triple into symbol hashes, so the bytes are per host).
pub const CHECKER_SHA256: &str = "b7068024b29c0e2c93c4d49ac6c90fcee21ce17052351f9037122fcd4e069059";

const REQUEST_GAS: Gas = Gas::from_tgas(100);
const VERDICT_GAS: Gas = Gas::from_tgas(60);
const PIN_GAS: Gas = Gas::from_tgas(30);
const MIN_RECLAIM_BLOCKS: u64 = 201;
/// Largest enclave answer the callback reads.
const MAX_VERDICT_BYTES: usize = 16 * 1024;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Token,
    Metadata,
    Bags,
    Challenges,
    OpenByWallet,
}

/// Fixed at deployment. There is no setter and no owner: every rule below is readable
/// through `customs_params` and cannot change after `new`.
#[derive(Clone)]
#[near(serializers = [borsh, json])]
pub struct Params {
    /// The account whose outbound `ft_transfer` calls during the opening window are opening buys (the DEX pool).
    pub market_id: AccountId,
    /// The account whose money a challenge must trace.
    pub creator_id: AccountId,
    /// The OutLayer contract that runs the path checker.
    pub outlayer_id: AccountId,
    /// The checker module OutLayer is asked to run, and the sha256 it must match.
    pub module_url: String,
    pub module_sha256: String,
    /// Seconds ahead of its start that the creator must announce trading with `open_trading`.
    pub notice_s: u64,
    /// Seconds after the announced start in which a market transfer counts as an opening buy.
    pub window_s: u64,
    /// Seconds, from the announced start, over which every opening bag vests linearly.
    pub vest_s: u64,
    /// Share of an upheld wallet's unvested bag that goes to the challenger, in basis points.
    pub seize_bps: u16,
    /// Seconds the rest of an upheld wallet's unvested bag stays locked.
    pub lock_s: u64,
    pub min_bond: U128,
    /// Fixed native amount forwarded to OutLayer for the enclave run.
    pub exec_fee: U128,
    /// Blocks after which an unanswered challenge's bond can be reclaimed.
    pub reclaim_blocks: u64,
    /// Blocks a signed verdict stays valid after the block it names.
    pub max_age_blocks: u64,
    /// Most transfer hops a path may contain. Forwarded to the checker.
    pub max_hops: u8,
}

#[derive(Clone)]
#[near(serializers = [borsh, json])]
pub struct Bag {
    pub bought: U128,
    pub seized: bool,
    pub frozen_amount: U128,
    pub frozen_until_s: u64,
    /// Tokens received as a seizure payout. They stay locked until the vest ends, like the bag they came from,
    /// so a creator who challenges their own insider wallet from a second account unlocks nothing.
    pub bounty: U128,
}

#[derive(Clone, PartialEq, Debug)]
#[near(serializers = [borsh, json])]
pub enum ChallengeState {
    Pending,
    Upheld { seized: U128 },
    Rejected,
    Reclaimed,
    /// The enclave gave no usable answer. Terminal: the wallet is free to be challenged again and the bond is reclaimable.
    Unanswered,
}

#[derive(Clone)]
#[near(serializers = [borsh, json])]
pub struct Challenge {
    pub wallet: AccountId,
    pub challenger: AccountId,
    pub bond: U128,
    pub path: Vec<String>,
    pub path_hash: String,
    pub created_block: u64,
    pub state: ChallengeState,
}

#[near(serializers = [json])]
pub struct BagView {
    pub bought: U128,
    pub locked: U128,
    pub state: String,
    pub unlock_s: u64,
}

#[near(serializers = [json])]
pub struct WindowView {
    pub start_s: Option<u64>,
    pub opening_ends_s: Option<u64>,
    pub vest_ends_s: Option<u64>,
}

/// What the path checker returns for `public_key`: the key OutLayer derived for this token, and a signature
/// by that key over `pin_message`, so the key is only ever one the checker module can sign with.
#[derive(Clone)]
#[near(serializers = [json])]
pub struct PinOutput {
    pub token: AccountId,
    pub public_key: String,
    pub sig: String,
}

/// What the path checker returns as its stdout JSON. OutLayer hands this to the callback as the result.
#[derive(Clone)]
#[near(serializers = [json])]
pub struct Verdict {
    pub token: AccountId,
    pub wallet: AccountId,
    pub challenge_id: u64,
    pub path_hash: String,
    pub verdict: String,
    pub block: u64,
    /// base58 ed25519 signature over `customs_common::verdict_message`.
    pub sig: String,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Customs {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    params: Params,
    /// ed25519 key OutLayer derives for this token and the checker module. Set once by `pin_verdict_key`.
    verdict_key: Option<PublicKey>,
    window_start_s: Option<u64>,
    bags: LookupMap<AccountId, Bag>,
    challenges: LookupMap<u64, Challenge>,
    open_by_wallet: LookupMap<AccountId, u64>,
    next_challenge: u64,
    forfeited: u128,
}

/// The deployer does not choose the judge: OutLayer and the checker module are the ones this code names.
#[cfg(not(feature = "sandbox"))]
fn require_published_judge(p: &Params) {
    require!(p.outlayer_id.as_str() == OUTLAYER_ID, "customs: outlayer_id must be the published OutLayer contract");
    require!(p.module_sha256 == CHECKER_SHA256, "customs: module_sha256 must be the published checker module");
    require!(p.module_url.starts_with("https://"), "customs: module_url must be an https url");
}

#[cfg(feature = "sandbox")]
fn require_published_judge(_: &Params) {}

fn now_s() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

/// floor(a * b / c) without overflowing u128 for b <= c.
fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    (a / c) * b + (a % c) * b / c
}

impl Bag {
    fn empty() -> Bag {
        Bag { bought: U128(0), seized: false, frozen_amount: U128(0), frozen_until_s: 0, bounty: U128(0) }
    }

    fn locked(&self, p: &Params, window_start_s: u64, now: u64) -> u128 {
        let bounty = if now < window_start_s + p.vest_s { self.bounty.0 } else { 0 };
        self.base_locked(p, window_start_s, now) + bounty
    }

    /// The part of the lock that opening buys created, which is all a challenge can seize.
    fn base_locked(&self, p: &Params, window_start_s: u64, now: u64) -> u128 {
        if self.seized {
            return if now < self.frozen_until_s { self.frozen_amount.0 } else { 0 };
        }
        let vest_end = window_start_s + p.vest_s;
        if now >= vest_end {
            return 0;
        }
        mul_div(self.bought.0, (vest_end - now) as u128, p.vest_s as u128)
    }

    fn state(&self, p: &Params, window_start_s: u64, now: u64) -> &'static str {
        if self.seized {
            if now < self.frozen_until_s { "seized_frozen" } else { "seized_released" }
        } else if now < window_start_s + p.vest_s {
            "vesting"
        } else {
            "vested"
        }
    }

    fn unlock_s(&self, p: &Params, window_start_s: u64) -> u64 {
        if self.seized { self.frozen_until_s } else { window_start_s + p.vest_s }
    }
}

#[near]
impl Customs {
    #[init]
    pub fn new(
        owner_id: AccountId,
        total_supply: U128,
        metadata: FungibleTokenMetadata,
        params: Params,
    ) -> Self {
        require!(!env::state_exists(), "Already initialized");
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "customs: only the token account initializes itself, in the transaction that deploys it"
        );
        require!(params.creator_id == owner_id, "customs: the creator whose money a challenge traces is the owner who holds the supply");
        require_published_judge(&params);
        require!(params.notice_s > 0, "notice_s must be positive");
        metadata.assert_valid();
        require!(params.vest_s > 0 && params.window_s > 0, "window_s and vest_s must be positive");
        require!(params.window_s <= params.vest_s, "the opening window cannot outlast the vest");
        require!(params.seize_bps > 0 && params.seize_bps <= 10_000, "seize_bps must be 1..=10000");
        require!(params.max_hops > 0, "max_hops must be positive");
        require!(
            params.reclaim_blocks >= MIN_RECLAIM_BLOCKS,
            "reclaim_blocks must exceed the 200 block yield window"
        );
        require!(params.max_age_blocks > 0, "max_age_blocks must be positive");
        require!(params.min_bond.0 > 0, "min_bond must be positive");
        require!(
            params.market_id != owner_id && params.market_id != env::current_account_id(),
            "the market must be a separate account"
        );
        let mut this = Self {
            token: FungibleToken::new(StorageKey::Token),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            params,
            verdict_key: None,
            window_start_s: None,
            bags: LookupMap::new(StorageKey::Bags),
            challenges: LookupMap::new(StorageKey::Challenges),
            open_by_wallet: LookupMap::new(StorageKey::OpenByWallet),
            next_challenge: 0,
            forfeited: 0,
        };
        this.token.internal_register_account(&owner_id);
        this.token.internal_deposit(&owner_id, total_supply.into());
        FtMint { owner_id: &owner_id, amount: total_supply, memo: Some("customs mint") }.emit();
        this
    }

    /// File a challenge: `path` names the transactions through which the creator's money reached
    /// `wallet`, in order, followed by the wallet's opening buy transaction. Attach `bond + exec_fee`. An upheld verdict pays the
    /// challenger `seize_bps` of the wallet's unvested bag and returns the bond. A rejected one
    /// forfeits the bond. No usable answer from the enclave changes nothing, frees the wallet at once, and the bond can be reclaimed.
    #[payable]
    pub fn challenge(&mut self, wallet: AccountId, path: Vec<String>, bond: U128) -> near_sdk::Promise {
        let p = self.params.clone();
        let challenger = env::predecessor_account_id();
        require!(bond.0 >= p.min_bond.0, "customs: bond is below min_bond");
        require!(
            env::attached_deposit().as_yoctonear() == bond.0 + p.exec_fee.0,
            "customs: attach exactly bond + exec_fee"
        );
        require!(challenger != wallet, "customs: a wallet cannot challenge itself");
        require!(
            self.token.accounts.contains_key(&challenger),
            "customs: the challenger must be registered with the token to receive a seizure"
        );
        require!(self.verdict_key.is_some(), "customs: the verdict key is not pinned yet; call pin_verdict_key");
        require!(
            path.len() >= 2 && path.len() <= max_path_len(p.max_hops),
            "customs: path is at least one hop transaction, each hop split over a few at most, followed by the opening buy transaction"
        );
        for h in &path {
            let ok = near_sdk::bs58::decode(h).into_vec().map(|b| b.len() == 32).unwrap_or(false);
            require!(ok, "customs: every path entry must be a base58 transaction hash");
        }
        let start = self.window_start_s.unwrap_or_else(|| env::panic_str("customs: trading has not opened"));
        let bag = self.bags.get(&wallet).unwrap_or_else(|| env::panic_str("customs: wallet has no opening bag"));
        require!(!bag.seized, "customs: wallet was already seized");
        require!(bag.base_locked(&p, start, now_s()) > 0, "customs: wallet has nothing unvested");
        require!(!self.open_by_wallet.contains_key(&wallet), "customs: a challenge on this wallet is already open");

        let id = self.next_challenge;
        self.next_challenge += 1;
        let path_hash = hex_lower(&env::sha256(&path_hash_input(&path)));
        self.challenges.insert(
            id,
            Challenge {
                wallet: wallet.clone(),
                challenger: challenger.clone(),
                bond,
                path: path.clone(),
                path_hash: path_hash.clone(),
                created_block: env::block_height(),
                state: ChallengeState::Pending,
            },
        );
        self.open_by_wallet.insert(wallet.clone(), id);

        let input = json!({
            "op": "verify_funding_path",
            "token": env::current_account_id(),
            "creator": p.creator_id,
            "market": p.market_id,
            "wallet": wallet,
            "challenge_id": id,
            "path": path,
            "path_hash": path_hash,
            "max_hops": p.max_hops,
            "block": env::block_height(),
            // two seconds of slack: an indexer may stamp the first sale's receipt a block before the block clock the contract read
            "window_start_ns": start.saturating_sub(2) * 1_000_000_000,
            "window_end_ns": (start + p.window_s) * 1_000_000_000,
        })
        .to_string();
        log!(
            "EVENT_JSON:{}",
            json!({"standard":"customs","version":"1.0.0","event":"challenge_filed","data":{
                "challenge_id": id, "wallet": wallet, "challenger": challenger, "bond": bond, "path_hash": path_hash
            }})
        );
        self.request_checker(input, challenger).then(Self::ext(env::current_account_id()).with_static_gas(VERDICT_GAS).on_verdict(id))
    }

    /// Announce when trading opens: the one moment the opening window and the vest are measured from. Creator
    /// only, once, at least `notice_s` ahead. Until `start_s` the market account cannot pay anyone, so the
    /// window cannot be started early by a token bought quietly in an empty pool.
    pub fn open_trading(&mut self, start_s: u64) {
        require!(env::predecessor_account_id() == self.params.creator_id, "customs: only the creator opens trading");
        require!(self.window_start_s.is_none(), "customs: trading is already scheduled");
        require!(start_s >= now_s() + self.params.notice_s, "customs: trading must be announced at least notice_s ahead");
        self.window_start_s = Some(start_s);
        self.event("trading_opens", json!({"start_s": start_s, "window_ends_s": start_s + self.params.window_s, "vest_ends_s": start_s + self.params.vest_s}));
    }

    /// Ask the checker module for the public key OutLayer derives for this token, and pin it. Anyone can
    /// call it once; it takes no argument, so the caller chooses nothing the key depends on. Attach `exec_fee`.
    #[payable]
    pub fn pin_verdict_key(&mut self) -> near_sdk::Promise {
        require!(self.verdict_key.is_none(), "customs: the verdict key is already pinned");
        require!(
            env::attached_deposit().as_yoctonear() == self.params.exec_fee.0,
            "customs: attach exactly exec_fee"
        );
        let input = json!({"op": "public_key", "token": env::current_account_id()}).to_string();
        self.request_checker(input, env::predecessor_account_id())
            .then(Self::ext(env::current_account_id()).with_static_gas(PIN_GAS).on_pin())
    }

    /// Callback of the key request. The key is accepted only when the module proved it can sign with it,
    /// and only while none is pinned: a second answer changes nothing.
    #[private]
    pub fn on_pin(&mut self, #[callback_result] result: Result<Option<PinOutput>, PromiseError>) -> bool {
        let Ok(Some(out)) = result else {
            log!("customs: no key answer; the key stays unpinned");
            return false;
        };
        if self.verdict_key.is_some() {
            return false;
        }
        require!(out.token == env::current_account_id(), "customs: key answer names another token");
        let key: PublicKey = out.public_key.parse().unwrap_or_else(|_| env::panic_str("customs: malformed public key"));
        require!(key.curve_type() == near_sdk::CurveType::ED25519, "customs: the verdict key must be ed25519");
        let sig: [u8; 64] = near_sdk::bs58::decode(&out.sig)
            .into_vec()
            .ok()
            .and_then(|b| b.try_into().ok())
            .unwrap_or_else(|| env::panic_str("customs: malformed signature"));
        let raw: [u8; 32] = key.as_bytes()[1..].try_into().unwrap_or_else(|_| env::panic_str("customs: malformed public key"));
        require!(
            env::ed25519_verify(&sig, &pin_message(&out.token.to_string(), &out.public_key), &raw),
            "customs: the key answer is not signed by the key it reports"
        );
        self.verdict_key = Some(key.clone());
        self.event("verdict_key_pinned", json!({"public_key": out.public_key}));
        true
    }

    /// Callback of the OutLayer run. Only this contract can call it. The verdict it carries has to verify against
    /// the pinned key, name this token, this wallet, this challenge and these receipts, and be recent. An answer that
    /// fails any of that, or that cannot be applied, closes the challenge as `Unanswered`: the vest stays where it was,
    /// the wallet can be challenged again at once, and the challenger can reclaim the bond. This callback never panics
    /// on the content of an answer, so no answer can leave a wallet pinned behind a challenge nobody can resolve.
    #[private]
    pub fn on_verdict(&mut self, challenge_id: u64) -> bool {
        let ch = self
            .challenges
            .get(&challenge_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("customs: unknown challenge"));
        if ch.state != ChallengeState::Pending {
            log!("customs: challenge {} is already closed; the late answer changes nothing", challenge_id);
            return false;
        }
        let verdict = match self.judge(&ch, challenge_id) {
            Ok(v) => v,
            Err(why) => {
                self.close_unanswered(challenge_id, ch, &why);
                return false;
            }
        };
        let p = self.params.clone();
        self.release(&ch.wallet, challenge_id);
        let mut ch = ch;
        if verdict.verdict == VERDICT_REJECTED {
            self.forfeited += ch.bond.0;
            ch.state = ChallengeState::Rejected;
            self.challenges.insert(challenge_id, ch.clone());
            self.event("challenge_rejected", json!({"challenge_id": challenge_id, "wallet": ch.wallet, "forfeited": ch.bond}));
            return false;
        }

        let start = self.window_start_s.unwrap_or_default();
        let now = now_s();
        let mut bag = self.bags.get(&ch.wallet).cloned().unwrap_or_else(Bag::empty);
        let balance = self.token.ft_balance_of(ch.wallet.clone()).0;
        let at_risk = bag.base_locked(&p, start, now).min(balance);
        let seized = mul_div(at_risk, p.seize_bps as u128, 10_000);
        if seized > 0 {
            self.token.internal_transfer(&ch.wallet, &ch.challenger, seized, Some("customs seizure".to_string()));
            let mut prize = self.bags.get(&ch.challenger).cloned().unwrap_or_else(Bag::empty);
            prize.bounty = U128(prize.bounty.0 + seized);
            self.bags.insert(ch.challenger.clone(), prize);
        }
        bag.seized = true;
        bag.frozen_amount = U128(at_risk - seized);
        bag.frozen_until_s = now + p.lock_s;
        self.bags.insert(ch.wallet.clone(), bag);
        ch.state = ChallengeState::Upheld { seized: U128(seized) };
        self.challenges.insert(challenge_id, ch.clone());
        let _ = near_sdk::Promise::new(ch.challenger.clone()).transfer(NearToken::from_yoctonear(ch.bond.0));
        self.event(
            "wallet_seized",
            json!({"challenge_id": challenge_id, "wallet": ch.wallet, "challenger": ch.challenger,
                   "seized": U128(seized), "frozen": U128(at_risk - seized), "frozen_until_s": now + p.lock_s}),
        );
        true
    }

    /// Return the bond of a challenge the enclave never answered: at once when the callback closed it as
    /// `Unanswered`, and after `reclaim_blocks` if it is somehow still pending.
    pub fn reclaim_bond(&mut self, challenge_id: u64) -> near_sdk::Promise {
        let mut ch = self
            .challenges
            .get(&challenge_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("customs: unknown challenge"));
        require!(env::predecessor_account_id() == ch.challenger, "customs: only the challenger reclaims");
        match ch.state {
            ChallengeState::Pending => require!(
                env::block_height() >= ch.created_block + self.params.reclaim_blocks,
                "customs: the enclave may still answer"
            ),
            ChallengeState::Unanswered => {}
            _ => env::panic_str("customs: challenge already resolved"),
        }
        ch.state = ChallengeState::Reclaimed;
        self.challenges.insert(challenge_id, ch.clone());
        self.release(&ch.wallet, challenge_id);
        near_sdk::Promise::new(ch.challenger).transfer(NearToken::from_yoctonear(ch.bond.0))
    }

    /// Free a wallet pinned behind a challenge that is still pending after `reclaim_blocks`. Anyone can call it.
    /// It touches no bond: the challenger still reclaims theirs.
    pub fn clear_stale(&mut self, challenge_id: u64) {
        let ch = self
            .challenges
            .get(&challenge_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("customs: unknown challenge"));
        require!(
            ch.state == ChallengeState::Pending && env::block_height() >= ch.created_block + self.params.reclaim_blocks,
            "customs: the challenge is not stale"
        );
        self.release(&ch.wallet, challenge_id);
    }

    pub fn customs_params(&self) -> Params {
        self.params.clone()
    }

    pub fn verdict_key(&self) -> Option<PublicKey> {
        self.verdict_key.clone()
    }

    pub fn opening_of(&self, account_id: AccountId) -> Option<BagView> {
        let start = self.window_start_s?;
        let now = now_s();
        let bag = self.bags.get(&account_id)?;
        Some(BagView {
            bought: bag.bought,
            locked: U128(bag.locked(&self.params, start, now)),
            state: bag.state(&self.params, start, now).to_string(),
            unlock_s: bag.unlock_s(&self.params, start),
        })
    }

    pub fn window(&self) -> WindowView {
        WindowView {
            start_s: self.window_start_s,
            opening_ends_s: self.window_start_s.map(|s| s + self.params.window_s),
            vest_ends_s: self.window_start_s.map(|s| s + self.params.vest_s),
        }
    }

    pub fn challenge_of(&self, challenge_id: u64) -> Option<Challenge> {
        self.challenges.get(&challenge_id).cloned()
    }

    pub fn open_challenge_of(&self, wallet: AccountId) -> Option<u64> {
        self.open_by_wallet.get(&wallet).copied()
    }

    /// Native token forfeited by rejected challenges. The contract has no method that moves it out.
    pub fn forfeited(&self) -> U128 {
        U128(self.forfeited)
    }
}

impl Customs {
    /// The one place this contract talks to OutLayer: the checker module, by URL and sha256, with the
    /// request as `input_data`, answered as JSON. The unused part of the attached fee refunds to `payer`.
    fn request_checker(&self, input: String, payer: AccountId) -> near_sdk::Promise {
        let p = &self.params;
        let args = json!({
            "source": { "WasmUrl": {
                "url": p.module_url, "hash": p.module_sha256, "build_target": "wasm32-wasip2"
            }},
            "resource_limits": {
                "max_instructions": 2_000_000_000u64, "max_memory_mb": 256, "max_execution_seconds": 60
            },
            "input_data": input,
            "response_format": "Json",
            "payer_account_id": payer,
        })
        .to_string()
        .into_bytes();
        near_sdk::Promise::new(p.outlayer_id.clone()).function_call(
            "request_execution".to_string(),
            args,
            NearToken::from_yoctonear(p.exec_fee.0),
            REQUEST_GAS,
        )
    }

    /// The enclave's answer for `ch`, or why there is none to apply. Reads only; a refusal here changes nothing.
    fn judge(&self, ch: &Challenge, challenge_id: u64) -> Result<Verdict, String> {
        let bytes = env::promise_result_checked(0, MAX_VERDICT_BYTES).map_err(|_| "customs: no verdict from the enclave".to_string())?;
        if bytes.is_empty() {
            return Err("customs: no verdict from the enclave".into());
        }
        let v = match near_sdk::serde_json::from_slice::<Option<Verdict>>(&bytes) {
            Ok(Some(v)) => v,
            Ok(None) => return Err("customs: no verdict from the enclave".into()),
            Err(e) => return Err(format!("customs: the enclave's answer is not a verdict: {e}")),
        };
        let p = &self.params;
        let check = |ok: bool, why: &str| if ok { Ok(()) } else { Err(why.to_string()) };
        check(v.token == env::current_account_id(), "customs: verdict names another token")?;
        check(v.wallet == ch.wallet, "customs: verdict names another wallet")?;
        check(v.challenge_id == challenge_id, "customs: verdict names another challenge")?;
        check(v.path_hash == ch.path_hash, "customs: verdict covers different receipts")?;
        check(v.verdict == VERDICT_UPHELD || v.verdict == VERDICT_REJECTED, "customs: unknown verdict value")?;
        let head = env::block_height();
        check(v.block == ch.created_block, "customs: verdict names another block than the challenge")?;
        check(v.block <= head, "customs: verdict names a future block")?;
        check(head - v.block <= p.max_age_blocks, "customs: verdict is stale")?;
        let msg = verdict_message(&v.token.to_string(), &v.wallet.to_string(), v.challenge_id, &v.path_hash, &v.verdict, v.block);
        let sig: [u8; 64] = near_sdk::bs58::decode(&v.sig)
            .into_vec()
            .ok()
            .and_then(|b| b.try_into().ok())
            .ok_or("customs: malformed signature")?;
        let key: [u8; 32] = self
            .verdict_key
            .as_ref()
            .ok_or("customs: no pinned verdict key")?
            .as_bytes()[1..]
            .try_into()
            .map_err(|_| "customs: malformed pinned key")?;
        check(env::ed25519_verify(&sig, &msg, &key), "customs: verdict signature does not verify against the pinned key")?;
        if v.verdict == VERDICT_UPHELD {
            // what applying an upheld verdict needs, checked before anything is written
            check(self.window_start_s.is_some(), "customs: trading has not opened")?;
            let bag = self.bags.get(&ch.wallet).ok_or("customs: the wallet has no opening bag")?;
            check(!bag.seized, "customs: wallet was already seized")?;
            check(self.token.accounts.contains_key(&ch.challenger), "customs: the challenger is not registered with the token")?;
        }
        Ok(v)
    }

    /// End a challenge nobody can apply an answer to: terminal, the wallet is freed, the bond stays reclaimable.
    fn close_unanswered(&mut self, challenge_id: u64, mut ch: Challenge, why: &str) {
        ch.state = ChallengeState::Unanswered;
        self.challenges.insert(challenge_id, ch.clone());
        self.release(&ch.wallet, challenge_id);
        self.event("challenge_unanswered", json!({"challenge_id": challenge_id, "wallet": ch.wallet, "reason": why}));
    }

    /// Drop `wallet`'s open-challenge entry if it is still the one for `challenge_id`.
    fn release(&mut self, wallet: &AccountId, challenge_id: u64) {
        if self.open_by_wallet.get(wallet) == Some(&challenge_id) {
            self.open_by_wallet.remove(wallet);
        }
    }

    fn event(&self, name: &str, data: near_sdk::serde_json::Value) {
        log!("EVENT_JSON:{}", json!({"standard":"customs","version":"1.0.0","event":name,"data":data}));
    }

    /// The whole hold. Runs before every outbound move of every account.
    fn on_outbound(&mut self, sender: &AccountId, receiver: &AccountId, amount: u128, is_call: bool) {
        let now = now_s();
        if *sender == self.params.market_id {
            let start = self.window_start_s.unwrap_or_else(|| env::panic_str("customs: trading has not been announced; the creator calls open_trading first"));
            require!(now >= start, "customs: trading has not opened yet");
            if now < start + self.params.window_s {
                require!(!is_call, "customs: the market pays opening buyers with ft_transfer");
                if *receiver != self.params.market_id {
                    let mut bag = self.bags.get(receiver).cloned().unwrap_or(Bag::empty());
                    bag.bought = U128(bag.bought.0 + amount);
                    self.bags.insert(receiver.clone(), bag);
                }
            }
            return;
        }
        if *sender == self.params.creator_id {
            // an opening bag is bought from the market and from nowhere else: the supply cannot be handed to insiders around it
            require!(
                *receiver == self.params.market_id || self.window_start_s.is_some_and(|s| now >= s + self.params.window_s),
                "customs: until the opening window closes the creator can only fund the market"
            );
        }
        let (Some(start), Some(bag)) = (self.window_start_s, self.bags.get(sender)) else {
            return;
        };
        let locked = bag.locked(&self.params, start, now);
        if locked == 0 {
            return;
        }
        let balance = self.token.ft_balance_of(sender.clone()).0;
        if amount <= balance {
            require!(
                balance - amount >= locked,
                format!(
                    "customs: {} of {} tokens are locked until {} (unix s); transferable now: {}",
                    locked,
                    balance,
                    bag.unlock_s(&self.params, start),
                    balance - locked.min(balance)
                )
            );
        }
    }
}

#[near]
impl FungibleTokenCore for Customs {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        let sender = env::predecessor_account_id();
        self.on_outbound(&sender, &receiver_id, amount.0, false);
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let sender = env::predecessor_account_id();
        self.on_outbound(&sender, &receiver_id, amount.0, true);
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Customs {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            log!("Account @{} burned {}", sender_id, burned);
        }
        used.into()
    }
}

#[near]
impl StorageManagement for Customs {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Customs {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, CurveType, PromiseResult};

    fn acct(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn params() -> Params {
        Params {
            market_id: acct("dex.near"),
            creator_id: acct("creator.near"),
            outlayer_id: acct(OUTLAYER_ID),
            module_url: "https://example.com/customs-checker.wasm".into(),
            module_sha256: CHECKER_SHA256.into(),
            notice_s: 60,
            window_s: 600,
            vest_s: 86_400,
            seize_bps: 2000,
            lock_s: 100,
            min_bond: U128(1),
            exec_fee: U128(1),
            reclaim_blocks: 220,
            max_age_blocks: 50,
            max_hops: 3,
        }
    }

    fn metadata() -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: "ft-1.0.0".into(),
            name: "T".into(),
            symbol: "T".into(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 24,
        }
    }

    fn ctx(predecessor: &str) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acct("token.near")).predecessor_account_id(acct(predecessor));
        b
    }

    fn deploy(p: Params) -> Customs {
        testing_env!(ctx("token.near").build());
        Customs::new(acct("creator.near"), U128(1_000), metadata(), p)
    }

    fn pending(wallet: &str, challenger: &str, created_block: u64) -> Challenge {
        Challenge {
            wallet: acct(wallet),
            challenger: acct(challenger),
            bond: U128(5),
            path: vec![],
            path_hash: "ph".into(),
            created_block,
            state: ChallengeState::Pending,
        }
    }

    #[test]
    fn mul_div_floors_and_never_overflows() {
        assert_eq!(mul_div(100, 1, 3), 33);
        assert_eq!(mul_div(u128::MAX / 2, 86_400, 86_400), u128::MAX / 2);
        assert_eq!(mul_div(1_000_000_000u128 * 10u128.pow(24), 43_200, 86_400), 500_000_000u128 * 10u128.pow(24));
    }

    #[test]
    fn the_published_judge_deploys() {
        deploy(params());
    }

    #[test]
    #[cfg(not(feature = "sandbox"))]
    #[should_panic(expected = "outlayer_id must be the published OutLayer contract")]
    fn a_foreign_outlayer_cannot_be_the_judge() {
        let mut p = params();
        p.outlayer_id = acct("my-own-judge.near");
        deploy(p);
    }

    #[test]
    #[cfg(not(feature = "sandbox"))]
    #[should_panic(expected = "module_sha256 must be the published checker module")]
    fn a_foreign_checker_cannot_be_the_judge() {
        let mut p = params();
        p.module_sha256 = "0".repeat(64);
        deploy(p);
    }

    #[test]
    #[cfg(not(feature = "sandbox"))]
    #[should_panic(expected = "module_url must be an https url")]
    fn the_checker_is_fetched_over_https() {
        let mut p = params();
        p.module_url = "http://example.com/customs-checker.wasm".into();
        deploy(p);
    }

    #[test]
    #[should_panic(expected = "the creator whose money a challenge traces is the owner")]
    fn a_decoy_creator_is_refused() {
        let mut p = params();
        p.creator_id = acct("decoy.near");
        deploy(p);
    }

    #[test]
    #[should_panic(expected = "only the token account initializes itself")]
    fn nobody_else_can_initialize_a_deployed_token() {
        testing_env!(ctx("front-runner.near").build());
        Customs::new(acct("creator.near"), U128(1_000), metadata(), params());
    }

    #[test]
    #[should_panic(expected = "the challenge is not stale")]
    fn a_challenge_inside_the_wait_cannot_be_cleared() {
        let mut c = deploy(params());
        c.challenges.insert(0, pending("w.near", "h.near", 100));
        c.open_by_wallet.insert(acct("w.near"), 0);
        testing_env!(ctx("anyone.near").block_height(100 + 219).build());
        c.clear_stale(0);
    }

    #[test]
    fn a_stale_challenge_frees_the_wallet_and_keeps_the_bond() {
        let mut c = deploy(params());
        c.challenges.insert(0, pending("w.near", "h.near", 100));
        c.open_by_wallet.insert(acct("w.near"), 0);
        testing_env!(ctx("anyone.near").block_height(100 + 220).build());
        c.clear_stale(0);
        assert_eq!(c.open_challenge_of(acct("w.near")), None);
        let ch = c.challenge_of(0).unwrap();
        assert_eq!((ch.state, ch.bond.0), (ChallengeState::Pending, 5), "the bond is not touched");
    }

    #[test]
    fn clearing_an_old_challenge_leaves_a_newer_one_in_place() {
        let mut c = deploy(params());
        c.challenges.insert(0, pending("w.near", "h.near", 100));
        c.challenges.insert(1, pending("w.near", "g.near", 300));
        c.open_by_wallet.insert(acct("w.near"), 1);
        testing_env!(ctx("anyone.near").block_height(100 + 220).build());
        c.clear_stale(0);
        assert_eq!(c.open_challenge_of(acct("w.near")), Some(1));
    }

    #[test]
    fn a_signed_upheld_answer_for_an_already_seized_wallet_applies_nothing() {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let mut c = deploy(params());
        c.verdict_key = Some(PublicKey::from_parts(CurveType::ED25519, sk.verifying_key().to_bytes().to_vec()).unwrap());
        c.window_start_s = Some(1_000);
        let mut bag = Bag::empty();
        bag.bought = U128(100);
        bag.seized = true;
        c.bags.insert(acct("w.near"), bag);
        c.token.accounts.insert(&acct("h.near"), &0u128);
        c.challenges.insert(0, pending("w.near", "h.near", 100));
        c.open_by_wallet.insert(acct("w.near"), 0);
        let msg = verdict_message("token.near", "w.near", 0, "ph", VERDICT_UPHELD, 100);
        let answer = json!({"token": "token.near", "wallet": "w.near", "challenge_id": 0, "path_hash": "ph", "verdict": "upheld",
            "block": 100, "sig": near_sdk::bs58::encode(sk.sign(&msg).to_bytes()).into_string()});
        let bytes = answer.to_string().into_bytes();
        testing_env!(
            ctx("token.near").block_height(101).block_timestamp(1_100 * 1_000_000_000).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Successful(bytes)]
        );
        assert!(!c.on_verdict(0));
        assert_eq!(c.challenge_of(0).unwrap().state, ChallengeState::Unanswered);
        assert_eq!(c.open_challenge_of(acct("w.near")), None);
    }
}
