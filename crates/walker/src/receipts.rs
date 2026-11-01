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
    /// NEAR this receipt moved from `pred` to `recv`: `Transfer` actions and `FunctionCall` deposits.
    pub transfers: Vec<u128>,
    pub logs: Vec<String>,
    /// False when the receipt's own execution failed, so nothing it logged or carried took effect.
    pub ok: bool,
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
            } else if let Some(f) = a.get("FunctionCall") {
                let d = u(&f["deposit"]);
                if d > 0 {
                    transfers.push(d);
                }
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
            ok,
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

/// Every wNEAR move `wrap.near` logged in this transaction: `(receipt index, from, to, amount)`, read from
/// its own `Transfer <amount> from <a> to <b>` line. A receipt that failed moved nothing.
fn wrap_moves(tx: &Tx) -> Vec<(usize, String, String, u128)> {
    let mut out = Vec::new();
    for (i, r) in tx.receipts.iter().enumerate().filter(|(_, r)| r.recv == "wrap.near" && r.ok) {
        for l in &r.logs {
            // "Transfer 333333333333333333333334 from <a> to dclv2.ref-labs.near"
            let Some(rest) = l.strip_prefix("Transfer ") else { continue };
            let mut it = rest.split(' ');
            let (Some(amt), Some("from"), Some(a), Some("to"), Some(to)) = (it.next(), it.next(), it.next(), it.next(), it.next()) else {
                continue;
            };
            if let Ok(n) = amt.parse::<u128>() {
                out.push((i, a.to_string(), to.to_string(), n));
            }
        }
    }
    out
}

/// NEAR the transaction paid into `market` as wNEAR, read from wrap.near's own transfer log lines.
pub fn cost_into(tx: &Tx, market: &str) -> u128 {
    wrap_moves(tx).iter().filter(|m| m.2 == market).map(|m| m.3).sum()
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
    for r in &tx.receipts {
        for l in &r.logs {
            let Some(e) = events(l) else { continue };
            if e["standard"] != "dip4" || e["event"] != "transfer" {
                continue;
            }
            for d in e["data"].as_array().cloned().unwrap_or_default() {
                // only wNEAR is NEAR value: other Intents tokens have no price in this rule
                let y = u(&d["tokens"]["nep141:wrap.near"]);
                if y > 0 {
                    out.push(Edge {
                        tx: tx.hash.clone(),
                        from: s(&d["account_id"]),
                        to: s(&d["receiver_id"]),
                        yocto: y,
                        ts_ns: r.ts_ns,
                        height: r.height,
                        kind: EdgeKind::IntentsTransfer,
                    });
                }
            }
        }
    }
    for (i, from, to, y) in wrap_moves(tx) {
        // Intents' own wNEAR movements are already edges through its dip4 events
        if from == "intents.near" {
            continue;
        }
        let r = &tx.receipts[i];
        out.push(Edge { tx: tx.hash.clone(), from, to, yocto: y, ts_ns: r.ts_ns, height: r.height, kind: EdgeKind::WrapTransfer });
    }
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

/// The edges a printed path of transaction hashes walks, starting at `creator`. A transaction moves
/// the money one hop on when it moves some out of the account the previous hop reached (the receiver
/// that got the most from it in that transaction). A transaction that does not, but moves more along
/// the previous hop's own sender and receiver, is a further piece of that hop and is added to it, so
/// funding split into several transfers is one hop of the summed amount. Anything else ends the walk,
/// and the rule then rejects a path that stops short.
pub fn path_edges(creator: &str, txs: &[Tx]) -> Vec<Edge> {
    let mut edges: Vec<Edge> = Vec::new();
    let mut at = creator.to_string();
    for tx in txs {
        let all = edges_all(tx);
        if let Some(e) = moved(&all, &at, None) {
            at = e.to.clone();
            edges.push(e);
        } else if let Some(prev) = edges.last_mut() {
            match moved(&all, &prev.from.clone(), Some(&prev.to.clone())) {
                Some(piece) => {
                    prev.yocto += piece.yocto;
                    prev.ts_ns = prev.ts_ns.max(piece.ts_ns);
                    prev.height = prev.height.max(piece.height);
                    prev.tx = piece.tx;
                }
                None => break,
            }
        } else {
            break;
        }
    }
    edges
}

/// What `from` moved in one transaction: to `to` if named, else to the receiver it moved the most to. The
/// amounts to that receiver add up; the kind and the tx are the largest single move's, the time the latest.
fn moved(all: &[Edge], from: &str, to: Option<&str>) -> Option<Edge> {
    let mine = || all.iter().filter(|e| e.from == from && to.map_or(true, |t| e.to == t));
    let best = mine().map(|e| (mine().filter(|x| x.to == e.to).map(|x| x.yocto).sum::<u128>(), e)).max_by_key(|(sum, _)| *sum)?;
    let (sum, top) = best;
    let latest = mine().filter(|x| x.to == top.to).max_by_key(|x| x.ts_ns).unwrap();
    let biggest = mine().filter(|x| x.to == top.to).max_by_key(|x| x.yocto).unwrap();
    Some(Edge { yocto: sum, ts_ns: latest.ts_ns, height: latest.height, ..biggest.clone() })
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

    /// Mainnet transaction Hx23FZyuBYeL7C2YuuSisSPBMdKkXdFu3BkhHZhNDUX6 (block 219230633), fetched unedited from
    /// tx.main.fastnear.com: an Intents `native_withdraw` of 15 NEAR from an owner account to a sniper wallet.
    const OWNER: &str = "d9eade234d867aa002539c484ed0dc808bdc5a0ccea6756a1ebfec0c0df9325a";
    const SNIPER: &str = "c8bde0e9209ac7329ca89867b8373add78bd2712a2543914eec7b8af96901899";

    #[test]
    fn real_intents_withdrawal_names_the_owner_not_the_relay() {
        let raw: Value = serde_json::from_str(include_str!("../tests/fixtures/intents-withdraw-hx23fz.json")).expect("fixture parses");
        let tx = parse_tx(&raw);
        assert_eq!(tx.hash, "Hx23FZyuBYeL7C2YuuSisSPBMdKkXdFu3BkhHZhNDUX6");
        let e = edges_into(&tx, SNIPER);
        assert_eq!(e.len(), 1, "{e:?}");
        assert_eq!((e[0].from.as_str(), e[0].yocto, e[0].kind.clone()), (OWNER, 15_000_000_000_000_000_000_000_000, EdgeKind::IntentsWithdraw));
        assert!(e.iter().all(|x| x.from != "intents.near"), "the relay must never be named as the funder");
        assert_eq!(e[0].height, 219_230_633);
        assert!(edges_into(&tx, OWNER).is_empty(), "the owner is the source here, never the receiver");
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

    fn fc_receipt(pred: &str, recv: &str, ts: u64, deposit: &str) -> Value {
        json!({
            "execution_outcome": {"outcome": {"logs": [], "status": {"SuccessValue": ""}}},
            "receipt": {"predecessor_id": pred, "receiver_id": recv, "block_timestamp": ts, "block_height": ts / 10,
                "receipt": {"Action": {"actions": [{"FunctionCall": {"method_name": "m", "args": "", "gas": 1, "deposit": deposit}}]}}}
        })
    }

    fn wrap_receipt(pred: &str, ts: u64, line: &str) -> Value {
        receipt(pred, "wrap.near", ts, vec![], vec![line.to_string()])
    }

    #[test]
    fn real_wnear_ft_transfer_is_an_edge() {
        // mainnet 8B6aY7koTr2tp98ZUTiezajVbGmaPVuLUUH6mmkzSv9c: the pool pays a buyer wNEAR with wrap.near ft_transfer
        let raw: Value = serde_json::from_str(include_str!("../tests/fixtures/wnear-ft-transfer-8b6aY7.json")).expect("fixture parses");
        let tx = parse_tx(&raw);
        let e = edges_into(&tx, "stranger.user.intear.near");
        let w: Vec<_> = e.iter().filter(|x| x.kind == EdgeKind::WrapTransfer).collect();
        assert_eq!(w.len(), 1, "{e:?}");
        assert_eq!((w[0].from.as_str(), w[0].yocto), ("dclv2.ref-labs.near", 45_784_593_930_406_662_817_199_108));
        assert_eq!(w[0].height, 222_128_697);
    }

    #[test]
    fn real_intents_internal_transfer_is_an_edge() {
        // mainnet 49VuVmyCkdxEfWh9SXjsFAqhMKEttRqzrDcdA8MZDUak: a dip4 `transfer` of nep141:wrap.near between two Intents accounts
        let raw: Value = serde_json::from_str(include_str!("../tests/fixtures/intents-transfer-49VuVm.json")).expect("fixture parses");
        let tx = parse_tx(&raw);
        let to = "143f2bb439575c286f4f585163f0e5fb4e464f8ce57ec06ae80741407d3cfb31";
        let e = edges_into(&tx, to);
        assert_eq!(e.len(), 1, "{e:?}");
        assert_eq!(
            (e[0].from.as_str(), e[0].yocto, e[0].kind.clone()),
            ("ad7f222a821ac81f53122d79f421078cb2d36995601534f1a95f7df5bc8dca94", 336_575_836_584_764_544_338, EdgeKind::IntentsTransfer)
        );
        // a transfer of another token is not NEAR value
        assert!(edges_into(&tx, "intents.tg").is_empty());
    }

    #[test]
    fn a_function_call_deposit_to_the_wallet_is_an_edge() {
        let tx = tx_from(json!({"transaction": {"hash": "H", "signer_id": "c.near"},
            "receipts": [fc_receipt("c.near", "w.near", 100, "7000")]}));
        let e = edges_into(&tx, "w.near");
        assert_eq!(e.len(), 1, "{e:?}");
        assert_eq!((e[0].from.as_str(), e[0].yocto, e[0].kind.clone()), ("c.near", 7000, EdgeKind::Transfer));
    }

    #[test]
    fn a_failed_receipt_moves_no_wnear() {
        let mut raw = json!({"transaction": {"hash": "H", "signer_id": "c.near"},
            "receipts": [wrap_receipt("c.near", 100, "Transfer 5 from c.near to w.near")]});
        raw["receipts"][0]["execution_outcome"]["outcome"]["status"] = json!({"Failure": {}});
        assert!(edges_into(&parse_tx(&raw), "w.near").is_empty());
    }

    fn pay(hash: &str, from: &str, to: &str, amount: u128, ts: u64) -> Tx {
        tx_from(json!({"transaction": {"hash": hash, "signer_id": from},
            "receipts": [wrap_receipt(from, ts, &format!("Transfer {amount} from {from} to {to}"))]}))
    }

    #[test]
    fn split_funding_is_one_hop_with_the_summed_amount() {
        let txs = vec![pay("a", "c.near", "w.near", 40, 100), pay("b", "c.near", "w.near", 30, 200), pay("c", "c.near", "w.near", 30, 300)];
        let e = path_edges("c.near", &txs);
        assert_eq!(e.len(), 1, "{e:?}");
        assert_eq!((e[0].from.as_str(), e[0].to.as_str(), e[0].yocto, e[0].ts_ns), ("c.near", "w.near", 100, 300));
    }

    #[test]
    fn pieces_belong_to_the_hop_they_follow() {
        // c -> r in two pieces, then r -> w: two hops
        let txs = vec![pay("a", "c.near", "r.near", 60, 100), pay("b", "c.near", "r.near", 60, 200), pay("c", "r.near", "w.near", 100, 300)];
        let e = path_edges("c.near", &txs);
        assert_eq!(e.len(), 2, "{e:?}");
        assert_eq!((e[0].yocto, e[0].ts_ns, e[1].yocto), (120, 200, 100));
    }

    #[test]
    fn a_transaction_that_moves_nothing_from_the_hop_ends_the_walk() {
        let txs = vec![pay("a", "c.near", "w.near", 40, 100), pay("b", "x.near", "y.near", 999, 200), pay("c", "c.near", "w.near", 30, 300)];
        let e = path_edges("c.near", &txs);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].yocto, 40, "the stray transaction ends the walk, the later piece is not counted");
    }

    #[test]
    fn several_moves_in_one_transaction_to_the_same_receiver_add_up() {
        let tx = tx_from(json!({"transaction": {"hash": "H", "signer_id": "c.near"}, "receipts": [
            receipt("c.near", "w.near", 100, vec!["30"], vec![]),
            wrap_receipt("c.near", 101, "Transfer 50 from c.near to w.near"),
            receipt("c.near", "other.near", 102, vec!["60"], vec![])]}));
        let e = path_edges("c.near", &[tx]);
        assert_eq!((e[0].to.as_str(), e[0].yocto), ("w.near", 80));
    }
}
