//! Read-only mainnet access through FastNEAR's transaction API, with an on-disk cache so a run
//! can be repeated and audited. Every response that feeds a number is stored under the cache directory.
use crate::pathrule::{Edge, EdgeKind, Inflows};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

pub const TX_API: &str = "https://tx.main.fastnear.com";
const BUSY_TXS: u64 = 3000;

#[derive(Clone, Debug)]
pub struct Receipt {
    pub pred: String,
    pub recv: String,
    pub ts_ns: u64,
    pub height: u64,
    pub transfers: Vec<u128>,
    pub logs: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Tx {
    pub hash: String,
    pub signer: String,
    pub receipts: Vec<Receipt>,
}

#[derive(Clone, Debug)]
pub struct AccountTx {
    pub hash: String,
    pub height: u64,
    pub ts_ns: u64,
}

#[derive(Clone, Debug)]
pub struct FtMove {
    pub tx: String,
    pub from: String,
    pub to: String,
    pub amount: u128,
    pub memo: Option<String>,
    pub ts_ns: u64,
    pub height: u64,
}

pub struct Client {
    cache: PathBuf,
    gap: Duration,
    last: Cell<Option<Instant>>,
    pub calls: Cell<u64>,
    pub hits: Cell<u64>,
    busy: RefCell<HashMap<String, bool>>,
    txmem: RefCell<HashMap<String, Tx>>,
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn u(v: &Value) -> u128 {
    match v {
        Value::String(x) => x.parse().unwrap_or(0),
        Value::Number(n) => n.as_u64().unwrap_or(0) as u128,
        _ => 0,
    }
}

impl Client {
    pub fn new(cache: &str, gap_ms: u64) -> Client {
        std::fs::create_dir_all(PathBuf::from(cache).join("tx")).expect("cache dir");
        Client {
            cache: PathBuf::from(cache),
            gap: Duration::from_millis(gap_ms),
            last: Cell::new(None),
            calls: Cell::new(0),
            hits: Cell::new(0),
            busy: RefCell::new(HashMap::new()),
            txmem: RefCell::new(HashMap::new()),
        }
    }

    fn post(&self, path: &str, body: &Value) -> Value {
        let key = customs_common::hex_lower(&Sha256::digest(format!("{path}{body}").as_bytes()));
        let file = self.cache.join(format!("{key}.json"));
        if let Ok(t) = std::fs::read_to_string(&file) {
            if let Ok(v) = serde_json::from_str(&t) {
                self.hits.set(self.hits.get() + 1);
                return v;
            }
        }
        let mut wait = 1u64;
        for attempt in 0..8 {
            if let Some(l) = self.last.get() {
                let el = l.elapsed();
                if el < self.gap {
                    std::thread::sleep(self.gap - el);
                }
            }
            self.last.set(Some(Instant::now()));
            self.calls.set(self.calls.get() + 1);
            match ureq::post(&format!("{TX_API}{path}")).timeout(Duration::from_secs(60)).send_json(body.clone()) {
                Ok(r) => {
                    let v: Value = r.into_json().expect("json body");
                    std::fs::write(&file, v.to_string()).expect("cache write");
                    return v;
                }
                Err(ureq::Error::Status(code, _)) if code == 429 || code >= 500 => {
                    eprintln!("fastnear {code} on {path}, retry {attempt} in {wait}s");
                    std::thread::sleep(Duration::from_secs(wait));
                    wait = (wait * 2).min(30);
                }
                Err(e) => panic!("fastnear {path}: {e}"),
            }
        }
        panic!("fastnear {path}: gave up after retries");
    }

    pub fn account_page(&self, account: &str, extra: Value) -> (Vec<AccountTx>, Option<String>, Option<u64>) {
        let mut body = json!({ "account_id": account });
        for (k, v) in extra.as_object().unwrap() {
            body[k] = v.clone();
        }
        let r = self.post("/v0/account", &body);
        let list = r["account_txs"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|t| AccountTx {
                        hash: s(&t["transaction_hash"]),
                        height: t["tx_block_height"].as_u64().unwrap_or(0),
                        ts_ns: u(&t["tx_block_timestamp"]) as u64,
                    })
                    .collect()
            })
            .unwrap_or_default();
        (list, r["resume_token"].as_str().map(|x| x.to_string()), r["txs_count"].as_u64())
    }

    /// Every transaction touching `account` from block `from_h` while the tx timestamp is before `until_ns`, oldest first.
    pub fn account_txs_until(&self, account: &str, from_h: u64, until_ns: u64) -> Vec<AccountTx> {
        let mut out: Vec<AccountTx> = Vec::new();
        let mut resume: Option<String> = None;
        loop {
            let mut extra = json!({"desc": false, "limit": 200, "from_tx_block_height": from_h});
            if let Some(r) = &resume {
                extra["resume_token"] = json!(r);
            }
            let (page, next, _) = self.account_page(account, extra);
            let done = page.iter().any(|t| t.ts_ns >= until_ns);
            out.extend(page.into_iter().filter(|t| t.ts_ns < until_ns));
            match next {
                Some(n) if !done => resume = Some(n),
                _ => break,
            }
        }
        out
    }

    pub fn txs(&self, hashes: &[String]) -> Vec<Tx> {
        let mut out = Vec::new();
        let mut missing: Vec<String> = Vec::new();
        for h in hashes {
            if let Some(t) = self.txmem.borrow().get(h) {
                out.push(t.clone());
                continue;
            }
            let f = self.cache.join("tx").join(format!("{h}.json"));
            if let Ok(t) = std::fs::read_to_string(&f) {
                if let Ok(v) = serde_json::from_str::<Value>(&t) {
                    let tx = parse_tx(&v);
                    self.txmem.borrow_mut().insert(h.clone(), tx.clone());
                    out.push(tx);
                    continue;
                }
            }
            missing.push(h.clone());
        }
        for chunk in missing.chunks(20) {
            let r = self.post("/v0/transactions", &json!({ "tx_hashes": chunk }));
            for raw in r["transactions"].as_array().cloned().unwrap_or_default() {
                let h = s(&raw["transaction"]["hash"]);
                std::fs::write(self.cache.join("tx").join(format!("{h}.json")), raw.to_string()).expect("cache write");
                let tx = parse_tx(&raw);
                self.txmem.borrow_mut().insert(h, tx.clone());
                out.push(tx);
            }
        }
        out
    }

    pub fn tx_count(&self, account: &str) -> u64 {
        self.account_page(account, json!({"limit": 1})).2.unwrap_or(0)
    }
}

pub fn parse_tx(raw: &Value) -> Tx {
    let mut receipts = Vec::new();
    for r in raw["receipts"].as_array().cloned().unwrap_or_default() {
        let rc = &r["receipt"];
        let mut transfers = Vec::new();
        for a in rc["receipt"]["Action"]["actions"].as_array().cloned().unwrap_or_default() {
            if let Some(t) = a.get("Transfer") {
                transfers.push(u(&t["deposit"]));
            }
        }
        let ok = r["execution_outcome"]["outcome"]["status"].get("Failure").is_none();
        receipts.push(Receipt {
            pred: s(&rc["predecessor_id"]),
            recv: s(&rc["receiver_id"]),
            ts_ns: rc["block_timestamp"].as_u64().unwrap_or(0),
            height: rc["block_height"].as_u64().unwrap_or(0),
            transfers: if ok { transfers } else { vec![] },
            logs: r["execution_outcome"]["outcome"]["logs"]
                .as_array()
                .map(|l| l.iter().map(s).collect())
                .unwrap_or_default(),
        });
    }
    Tx { hash: s(&raw["transaction"]["hash"]), signer: s(&raw["transaction"]["signer_id"]), receipts }
}

fn events(log: &str) -> Option<Value> {
    serde_json::from_str(log.strip_prefix("EVENT_JSON:")?).ok()
}

/// NEP-141 `ft_transfer` events emitted by `token` in this transaction.
pub fn ft_moves(tx: &Tx, token: &str) -> Vec<FtMove> {
    let mut out = Vec::new();
    for r in tx.receipts.iter().filter(|r| r.recv == token) {
        for l in &r.logs {
            let Some(e) = events(l) else { continue };
            if e["standard"] != "nep141" || e["event"] != "ft_transfer" {
                continue;
            }
            for d in e["data"].as_array().cloned().unwrap_or_default() {
                out.push(FtMove {
                    tx: tx.hash.clone(),
                    from: s(&d["old_owner_id"]),
                    to: s(&d["new_owner_id"]),
                    amount: u(&d["amount"]),
                    memo: d["memo"].as_str().map(|m| m.to_string()),
                    ts_ns: r.ts_ns,
                    height: r.height,
                });
            }
        }
    }
    out
}

/// NEAR the transaction paid into `market` as wNEAR, read from wrap.near's own transfer log lines.
pub fn cost_into(tx: &Tx, market: &str) -> u128 {
    let mut total = 0u128;
    for r in tx.receipts.iter().filter(|r| r.recv == "wrap.near") {
        for l in &r.logs {
            // "Transfer 333333333333333333333334 from <a> to dclv2.ref-labs.near"
            let Some(rest) = l.strip_prefix("Transfer ") else { continue };
            let mut it = rest.split(' ');
            let (Some(amt), Some("from"), Some(_a), Some("to"), Some(to)) = (it.next(), it.next(), it.next(), it.next(), it.next()) else {
                continue;
            };
            if to == market {
                total += amt.parse::<u128>().unwrap_or(0);
            }
        }
    }
    total
}

/// Every movement of NEAR in this transaction: plain transfers and Intents withdrawals.
pub fn edges_all(tx: &Tx) -> Vec<Edge> {
    let mut withdraws: Vec<Edge> = Vec::new();
    for r in &tx.receipts {
        for l in &r.logs {
            let Some(e) = events(l) else { continue };
            if e["standard"] != "dip4" || e["event"] != "native_withdraw" {
                continue;
            }
            for d in e["data"].as_array().cloned().unwrap_or_default() {
                withdraws.push(Edge {
                    tx: tx.hash.clone(),
                    from: s(&d["account_id"]),
                    to: s(&d["receiver_id"]),
                    yocto: u(&d["amount"]),
                    ts_ns: r.ts_ns,
                    height: r.height,
                    kind: EdgeKind::IntentsWithdraw,
                });
            }
        }
    }
    let mut out = withdraws.clone();
    for r in tx.receipts.iter().filter(|r| r.pred != "system") {
        for &y in &r.transfers {
            // the last hop of an Intents withdrawal is intents.near paying out; the event already names the owner
            if r.pred == "intents.near" && withdraws.iter().any(|w| w.to == r.recv) {
                continue;
            }
            out.push(Edge {
                tx: tx.hash.clone(),
                from: r.pred.clone(),
                to: r.recv.clone(),
                yocto: y,
                ts_ns: r.ts_ns,
                height: r.height,
                kind: EdgeKind::Transfer,
            });
        }
    }
    out
}

pub fn edges_into(tx: &Tx, account: &str) -> Vec<Edge> {
    edges_all(tx).into_iter().filter(|e| e.to == account).collect()
}

impl Inflows for Client {
    fn inflows(&mut self, account: &str, before_ts_ns: u64, before_height: u64, min_yocto: u128) -> Vec<Edge> {
        let (list, _, _) = self.account_page(
            account,
            json!({"is_receiver": true, "is_success": true, "desc": true, "limit": 60, "to_tx_block_height": before_height}),
        );
        let hashes: Vec<String> = list.iter().map(|t| t.hash.clone()).collect();
        let mut out: Vec<Edge> = Vec::new();
        for tx in self.txs(&hashes) {
            for e in edges_into(&tx, account) {
                if e.ts_ns < before_ts_ns && e.yocto >= min_yocto {
                    out.push(e);
                }
            }
        }
        out.sort_by(|a, b| b.yocto.cmp(&a.yocto));
        out.truncate(6);
        out
    }

    fn is_busy(&mut self, account: &str) -> bool {
        if let Some(b) = self.busy.borrow().get(account) {
            return *b;
        }
        let b = self.tx_count(account) > BUSY_TXS;
        self.busy.borrow_mut().insert(account.to_string(), b);
        b
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tx_from(v: Value) -> Tx {
        parse_tx(&v)
    }

    fn receipt(pred: &str, recv: &str, ts: u64, transfers: Vec<&str>, logs: Vec<String>) -> Value {
        json!({
            "execution_outcome": {"outcome": {"logs": logs, "status": {"SuccessValue": ""}}},
            "receipt": {"predecessor_id": pred, "receiver_id": recv, "block_timestamp": ts, "block_height": ts / 10,
                "receipt": {"Action": {"actions": transfers.iter().map(|d| json!({"Transfer": {"deposit": d}})).collect::<Vec<_>>()}}}
        })
    }

    #[test]
    fn plain_transfer_becomes_an_edge_and_system_refunds_do_not() {
        let tx = tx_from(json!({"transaction": {"hash": "H", "signer_id": "a.near"},
            "receipts": [receipt("a.near", "b.near", 100, vec!["5000"], vec![]), receipt("system", "b.near", 101, vec!["9"], vec![])]}));
        let e = edges_into(&tx, "b.near");
        assert_eq!(e.len(), 1);
        assert_eq!((e[0].from.as_str(), e[0].yocto), ("a.near", 5000));
    }

    #[test]
    fn intents_withdraw_names_the_owner_not_intents_near() {
        let ev = r#"EVENT_JSON:{"standard":"dip4","version":"0.4.3","event":"native_withdraw","data":[{"intent_hash":"x","account_id":"owner.near","receiver_id":"w.near","amount":"15"}]}"#.to_string();
        let tx = tx_from(json!({"transaction": {"hash": "H", "signer_id": "intents.near"},
            "receipts": [receipt("intents.near", "intents.near", 100, vec![], vec![ev]), receipt("intents.near", "w.near", 102, vec!["15"], vec![])]}));
        let e = edges_into(&tx, "w.near");
        assert_eq!(e.len(), 1, "{e:?}");
        assert_eq!((e[0].from.as_str(), e[0].kind.clone()), ("owner.near", EdgeKind::IntentsWithdraw));
        assert!(edges_into(&tx, "someone-else.near").is_empty());
    }

    #[test]
    fn cost_reads_wrap_near_transfer_lines_to_the_market_only() {
        let logs = vec!["Transfer 300 from a.near to dclv2.ref-labs.near".to_string(), "Transfer 7 from a.near to other.near".to_string()];
        let tx = tx_from(json!({"transaction": {"hash": "H", "signer_id": "a.near"}, "receipts": [receipt("a.near", "wrap.near", 1, vec![], logs)]}));
        assert_eq!(cost_into(&tx, "dclv2.ref-labs.near"), 300);
    }

    #[test]
    fn ft_events_are_read_from_the_token_receipts() {
        let ev = r#"EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{"old_owner_id":"dclv2.ref-labs.near","new_owner_id":"b.near","amount":"42"},{"old_owner_id":"dclv2.ref-labs.near","new_owner_id":"t.near","amount":"3","memo":"tax"}]}"#.to_string();
        let tx = tx_from(json!({"transaction": {"hash": "H", "signer_id": "b.near"}, "receipts": [receipt("dclv2.ref-labs.near", "t.near", 9, vec![], vec![ev])]}));
        let m = ft_moves(&tx, "t.near");
        assert_eq!(m.len(), 2);
        assert_eq!((m[0].to.as_str(), m[0].amount, m[1].memo.as_deref()), ("b.near", 42, Some("tax")));
        assert!(ft_moves(&tx, "other.near").is_empty());
    }
}
