//! Customs: a NEP-141 memecoin whose opening buyers vest by contract and can be seized from
//! by anyone who proves, through an OutLayer enclave verdict, that the creator's money paid
//! for the buy. The vest floor never depends on a backend. The verdict can only convict.

use customs_common::{hex_lower, path_hash_input, verdict_message, VERDICT_REJECTED, VERDICT_UPHELD};
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

const REQUEST_GAS: Gas = Gas::from_tgas(100);
const VERDICT_GAS: Gas = Gas::from_tgas(60);
const MIN_RECLAIM_BLOCKS: u64 = 201;

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
    /// ed25519 key the path checker signs verdicts with. Verified on chain in `on_verdict`.
    pub verdict_key: PublicKey,
    /// The checker module OutLayer is asked to run, and the sha256 it must match.
    pub module_url: String,
    pub module_sha256: String,
    /// Seconds after the first market sale in which a market transfer counts as an opening buy.
    pub window_s: u64,
    /// Seconds, from the first market sale, over which every opening bag vests linearly.
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
}

#[derive(Clone, PartialEq, Debug)]
#[near(serializers = [borsh, json])]
pub enum ChallengeState {
    Pending,
    Upheld { seized: U128 },
    Rejected,
    Reclaimed,
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
    window_start_s: Option<u64>,
    bags: LookupMap<AccountId, Bag>,
    challenges: LookupMap<u64, Challenge>,
    open_by_wallet: LookupMap<AccountId, u64>,
    next_challenge: u64,
    forfeited: u128,
}

fn now_s() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

/// floor(a * b / c) without overflowing u128 for b <= c.
fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    (a / c) * b + (a % c) * b / c
}

impl Bag {
    fn locked(&self, p: &Params, window_start_s: u64, now: u64) -> u128 {
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
            params.verdict_key.curve_type() == near_sdk::CurveType::ED25519,
            "verdict_key must be an ed25519 key"
        );
        require!(
            params.market_id != owner_id && params.market_id != env::current_account_id(),
            "the market must be a separate account"
        );
        let mut this = Self {
            token: FungibleToken::new(StorageKey::Token),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            params,
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
    /// `wallet` before its opening buy. Attach `bond + exec_fee`. An upheld verdict pays the
    /// challenger `seize_bps` of the wallet's unvested bag and returns the bond. A rejected one
    /// forfeits the bond. No answer from the enclave changes nothing and the bond can be reclaimed.
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
        require!(path.len() <= p.max_hops as usize, "customs: path is longer than max_hops");
        for h in &path {
            let ok = near_sdk::bs58::decode(h).into_vec().map(|b| b.len() == 32).unwrap_or(false);
            require!(ok, "customs: every path entry must be a base58 transaction hash");
        }
        let start = self.window_start_s.unwrap_or_else(|| env::panic_str("customs: trading has not opened"));
        let bag = self.bags.get(&wallet).unwrap_or_else(|| env::panic_str("customs: wallet has no opening bag"));
        require!(!bag.seized, "customs: wallet was already seized");
        require!(bag.locked(&p, start, now_s()) > 0, "customs: wallet has nothing unvested");
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
        })
        .to_string();
        let args = json!({
            "source": { "WasmUrl": {
                "url": p.module_url, "hash": p.module_sha256, "build_target": "wasm32-wasip2"
            }},
            "resource_limits": {
                "max_instructions": 2_000_000_000u64, "max_memory_mb": 256, "max_execution_seconds": 60
            },
            "input_data": input,
            "response_format": "Json",
            "payer_account_id": challenger,
        })
        .to_string()
        .into_bytes();
        log!(
            "EVENT_JSON:{}",
            json!({"standard":"customs","version":"1.0.0","event":"challenge_filed","data":{
                "challenge_id": id, "wallet": wallet, "challenger": challenger, "bond": bond, "path_hash": path_hash
            }})
        );
        near_sdk::Promise::new(p.outlayer_id)
            .function_call("request_execution".to_string(), args, NearToken::from_yoctonear(p.exec_fee.0), REQUEST_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(VERDICT_GAS).on_verdict(id))
    }

    /// Callback of the OutLayer run. Only this contract can call it; the verdict it carries still has to
    /// verify against the pinned key, name this token, this wallet, this challenge and these receipts,
    /// and be recent. Anything else leaves the vest and the bond exactly where they were.
    #[private]
    pub fn on_verdict(
        &mut self,
        challenge_id: u64,
        #[callback_result] result: Result<Option<Verdict>, PromiseError>,
    ) -> bool {
        let mut ch = self
            .challenges
            .get(&challenge_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("customs: unknown challenge"));
        require!(ch.state == ChallengeState::Pending, "customs: challenge already resolved");
        let v = match result {
            Ok(Some(v)) => v,
            _ => {
                log!("customs: no verdict for challenge {}; vest unchanged, bond reclaimable", challenge_id);
                return false;
            }
        };
        let p = self.params.clone();
        require!(v.token == env::current_account_id(), "customs: verdict names another token");
        require!(v.wallet == ch.wallet, "customs: verdict names another wallet");
        require!(v.challenge_id == challenge_id, "customs: verdict names another challenge");
        require!(v.path_hash == ch.path_hash, "customs: verdict covers different receipts");
        require!(
            v.verdict == VERDICT_UPHELD || v.verdict == VERDICT_REJECTED,
            "customs: unknown verdict value"
        );
        let head = env::block_height();
        require!(v.block >= ch.created_block, "customs: verdict predates the challenge");
        require!(v.block <= head, "customs: verdict names a future block");
        require!(head - v.block <= p.max_age_blocks, "customs: verdict is stale");

        let msg = verdict_message(&v.token.to_string(), &v.wallet.to_string(), v.challenge_id, &v.path_hash, &v.verdict, v.block);
        let sig: [u8; 64] = near_sdk::bs58::decode(&v.sig)
            .into_vec()
            .ok()
            .and_then(|b| b.try_into().ok())
            .unwrap_or_else(|| env::panic_str("customs: malformed signature"));
        let key: [u8; 32] = p.verdict_key.as_bytes()[1..]
            .try_into()
            .unwrap_or_else(|_| env::panic_str("customs: malformed pinned key"));
        require!(env::ed25519_verify(&sig, &msg, &key), "customs: verdict signature does not verify against the pinned key");

        self.open_by_wallet.remove(&ch.wallet);
        if v.verdict == VERDICT_REJECTED {
            self.forfeited += ch.bond.0;
            ch.state = ChallengeState::Rejected;
            self.challenges.insert(challenge_id, ch.clone());
            self.event("challenge_rejected", json!({"challenge_id": challenge_id, "wallet": ch.wallet, "forfeited": ch.bond}));
            return false;
        }

        let start = self.window_start_s.unwrap();
        let now = now_s();
        let mut bag = self.bags.get(&ch.wallet).cloned().unwrap_or_else(|| env::panic_str("customs: bag vanished"));
        let balance = self.token.ft_balance_of(ch.wallet.clone()).0;
        let at_risk = bag.locked(&p, start, now).min(balance);
        let seized = mul_div(at_risk, p.seize_bps as u128, 10_000);
        if seized > 0 {
            self.token.internal_transfer(&ch.wallet, &ch.challenger, seized, Some("customs seizure".to_string()));
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

    /// Return the bond of a challenge the enclave never answered.
    pub fn reclaim_bond(&mut self, challenge_id: u64) -> near_sdk::Promise {
        let mut ch = self
            .challenges
            .get(&challenge_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("customs: unknown challenge"));
        require!(env::predecessor_account_id() == ch.challenger, "customs: only the challenger reclaims");
        require!(ch.state == ChallengeState::Pending, "customs: challenge already resolved");
        require!(
            env::block_height() >= ch.created_block + self.params.reclaim_blocks,
            "customs: the enclave may still answer"
        );
        ch.state = ChallengeState::Reclaimed;
        self.challenges.insert(challenge_id, ch.clone());
        self.open_by_wallet.remove(&ch.wallet);
        near_sdk::Promise::new(ch.challenger).transfer(NearToken::from_yoctonear(ch.bond.0))
    }

    pub fn customs_params(&self) -> Params {
        self.params.clone()
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
    fn event(&self, name: &str, data: near_sdk::serde_json::Value) {
        log!("EVENT_JSON:{}", json!({"standard":"customs","version":"1.0.0","event":name,"data":data}));
    }

    /// The whole hold. Runs before every outbound move of every account.
    fn on_outbound(&mut self, sender: &AccountId, receiver: &AccountId, amount: u128, is_call: bool) {
        let now = now_s();
        if *sender == self.params.market_id {
            let start = *self.window_start_s.get_or_insert(now);
            if now < start + self.params.window_s {
                require!(!is_call, "customs: the market pays opening buyers with ft_transfer");
                if *receiver != self.params.market_id {
                    let mut bag = self.bags.get(receiver).cloned().unwrap_or(Bag {
                        bought: U128(0),
                        seized: false,
                        frozen_amount: U128(0),
                        frozen_until_s: 0,
                    });
                    bag.bought = U128(bag.bought.0 + amount);
                    self.bags.insert(receiver.clone(), bag);
                }
            }
            return;
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

    #[test]
    fn mul_div_floors_and_never_overflows() {
        assert_eq!(mul_div(100, 1, 3), 33);
        assert_eq!(mul_div(u128::MAX / 2, 86_400, 86_400), u128::MAX / 2);
        assert_eq!(mul_div(1_000_000_000u128 * 10u128.pow(24), 43_200, 86_400), 500_000_000u128 * 10u128.pow(24));
    }
}
