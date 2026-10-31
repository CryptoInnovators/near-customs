//! Read-only mainnet access through FastNEAR's transaction API, with an on-disk cache so a run
//! can be repeated and audited. Every response that feeds a number is stored under the cache directory.
use crate::pathrule::{Edge, Inflows};
pub use crate::receipts::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

pub const TX_API: &str = "https://tx.main.fastnear.com";
use crate::pathrule::BUSY_TXS;

#[derive(Clone, Debug)]
pub struct AccountTx {
    pub hash: String,
    pub height: u64,
    pub ts_ns: u64,
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

