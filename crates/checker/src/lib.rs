//! The evidence checker OutLayer runs inside its enclave. It reads the receipts a challenger names,
//! applies the funding path rule from `customs_walker::pathrule`, and signs a verdict that the token
//! verifies on chain. All decisions live here and take their inputs as arguments, so the WASI binary,
//! the offline walker and the tests run the same code.

use customs_common::{hex_lower, path_hash_input, pin_message, verdict_message, VERDICT_REJECTED, VERDICT_UPHELD};
use customs_walker::pathrule::{check, hub_list, Buy, Rule, BUSY_TXS};
use customs_walker::receipts::{cost_into, ft_moves, path_edges, Tx};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub trait Signer {
    fn public_key(&self) -> Result<[u8; 32], String>;
    fn sign(&self, message: &[u8]) -> Result<[u8; 64], String>;
}

pub trait TxSource {
    /// The transactions with these hashes, in any order. A hash the source cannot find is an error:
    /// the checker never judges a path it could not read.
    fn txs(&self, hashes: &[String]) -> Result<Vec<Tx>, String>;
    /// How many transactions have touched `account`. An account that cannot be measured is an error, never "quiet".
    fn tx_count(&self, account: &str) -> Result<u64, String>;
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    PublicKey {
        token: String,
    },
    VerifyFundingPath {
        token: String,
        creator: String,
        market: String,
        wallet: String,
        challenge_id: u64,
        /// Hop transactions in order, then the opening-buy transaction.
        path: Vec<String>,
        path_hash: String,
        max_hops: u8,
        /// The block of the request. Echoed into the signed verdict.
        block: u64,
        window_start_ns: u64,
        window_end_ns: u64,
    },
}

#[derive(Debug, PartialEq)]
pub struct Decision {
    pub verdict: &'static str,
    pub reason: Option<String>,
    pub buy_tx: String,
    pub buy_tokens: u128,
    pub buy_cost_yocto: u128,
}

pub fn ed25519_string(key: &[u8; 32]) -> String {
    format!("ed25519:{}", bs58::encode(key).into_string())
}

/// Judge one challenge from the transactions it names. `txs` must contain every hash in `path`.
#[allow(clippy::too_many_arguments)]
pub fn decide(
    token: &str,
    creator: &str,
    market: &str,
    wallet: &str,
    path: &[String],
    max_hops: u8,
    window_ns: (u64, u64),
    busy: &[String],
    txs: &[Tx],
) -> Decision {
    let find = |h: &String| txs.iter().find(|t| &t.hash == h).expect("caller supplies every named transaction");
    let (buy_hash, hop_hashes) = path.split_last().expect("path has an opening buy");
    let reject = |reason: String, tokens: u128, cost: u128| Decision {
        verdict: VERDICT_REJECTED,
        reason: Some(reason),
        buy_tx: buy_hash.clone(),
        buy_tokens: tokens,
        buy_cost_yocto: cost,
    };
    let buy_tx = find(buy_hash);
    let moves: Vec<_> = ft_moves(buy_tx, token)
        .into_iter()
        .filter(|m| m.from == market && m.to == wallet && m.memo.as_deref() != Some("tax"))
        .collect();
    let Some(first) = moves.first() else {
        return reject("the last transaction is not a market sale to the wallet".into(), 0, 0);
    };
    let tokens: u128 = moves.iter().map(|m| m.amount).sum();
    let cost = cost_into(buy_tx, market);
    if first.ts_ns < window_ns.0 || first.ts_ns >= window_ns.1 {
        return reject("the named buy is outside the opening window".into(), tokens, cost);
    }
    let hops: Vec<Tx> = hop_hashes.iter().map(|h| find(h).clone()).collect();
    let edges = path_edges(creator, &hops);
    let mut rule = Rule::new(creator);
    rule.max_hops = max_hops as usize;
    rule.busy = busy.to_vec();
    let buy = Buy { wallet: wallet.to_string(), cost_yocto: cost, ts_ns: first.ts_ns };
    match check(&edges, &buy, &rule) {
        Ok(()) => Decision {
            verdict: VERDICT_UPHELD,
            reason: None,
            buy_tx: buy_hash.clone(),
            buy_tokens: tokens,
            buy_cost_yocto: cost,
        },
        Err(r) => reject(format!("{r:?}"), tokens, cost),
    }
}

/// Run one request. Errors mean no verdict is produced; the token then leaves the vest alone.
pub fn run(input: &str, src: &dyn TxSource, signer: &dyn Signer) -> Result<Value, String> {
    match serde_json::from_str::<Request>(input).map_err(|e| format!("bad request: {e}"))? {
        Request::PublicKey { token } => {
            let key = ed25519_string(&signer.public_key()?);
            let sig = signer.sign(&pin_message(&token, &key))?;
            Ok(json!({"op": "public_key", "token": token, "public_key": key, "sig": bs58::encode(sig).into_string()}))
        }
        Request::VerifyFundingPath {
            token, creator, market, wallet, challenge_id, path, path_hash, max_hops, block, window_start_ns, window_end_ns,
        } => {
            if hex_lower(&Sha256::digest(path_hash_input(&path))) != path_hash {
                return Err("path_hash does not match path".into());
            }
            if path.len() < 2 || path.len() > max_hops as usize + 1 {
                return Err("path must hold 1..=max_hops hop transactions and then the buy".into());
            }
            let found = src.txs(&path)?;
            for h in &path {
                if !found.iter().any(|t| &t.hash == h) {
                    return Err(format!("transaction {h} not found"));
                }
            }
            // every account the money rested in on the way, not the creator and not the wallet
            let hop_txs: Vec<Tx> = path[..path.len() - 1]
                .iter()
                .map(|h| found.iter().find(|t| &t.hash == h).cloned().expect("checked above"))
                .collect();
            let edges = path_edges(&creator, &hop_txs);
            let mut busy = Vec::new();
            for e in edges.iter().take(edges.len().saturating_sub(1)) {
                if !busy.contains(&e.to) && src.tx_count(&e.to)? > BUSY_TXS {
                    busy.push(e.to.clone());
                }
            }
            let d = decide(&token, &creator, &market, &wallet, &path, max_hops, (window_start_ns, window_end_ns), &busy, &found);
            let msg = verdict_message(&token, &wallet, challenge_id, &path_hash, d.verdict, block);
            let sig = signer.sign(&msg)?;
            Ok(json!({
                "op": "verify_funding_path", "token": token, "wallet": wallet, "challenge_id": challenge_id,
                "path_hash": path_hash, "verdict": d.verdict, "block": block,
                "sig": bs58::encode(sig).into_string(),
                "reason": d.reason, "buy_tx": d.buy_tx,
                "hub_list": {"version": hub_list().version, "sha256": hub_list().sha256},
                "buy_tokens": d.buy_tokens.to_string(), "buy_cost_yocto": d.buy_cost_yocto.to_string(),
            }))
        }
    }
}
