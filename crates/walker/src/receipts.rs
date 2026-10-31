//! Chain facts read from FastNEAR-shaped transaction JSON. Pure functions: the offline walker and the
//! WASI checker both parse receipts with exactly this code.
use crate::pathrule::{Edge, EdgeKind};
use serde_json::Value;

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
pub struct FtMove {
    pub tx: String,
    pub from: String,
    pub to: String,
    pub amount: u128,
    pub memo: Option<String>,
    pub ts_ns: u64,
    pub height: u64,
}

pub fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

pub fn u(v: &Value) -> u128 {
    match v {
        Value::String(x) => x.parse().unwrap_or(0),
        Value::Number(n) => n.as_u64().unwrap_or(0) as u128,
        _ => 0,
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

/// The edges a printed path of transaction hashes walks, starting at `creator`. Each transaction
/// contributes the largest movement out of the account the previous one reached; a transaction
/// that moves nothing out of it ends the walk, so the rule then rejects a path that stops short.
pub fn path_edges(creator: &str, txs: &[Tx]) -> Vec<Edge> {
    let mut edges = Vec::new();
    let mut at = creator.to_string();
    for tx in txs {
        match edges_all(tx).into_iter().filter(|e| e.from == at).max_by_key(|e| e.yocto) {
            Some(e) => {
                at = e.to.clone();
                edges.push(e);
            }
            None => break,
        }
    }
    edges
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
