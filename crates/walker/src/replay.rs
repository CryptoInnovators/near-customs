//! Replays a real launch: who bought in the opening window, how much of it moved within the vest
//! period, and how much was paid for with money that leads back to the creator under the path rule.
use crate::chain::{cost_into, ft_moves, Client, FtMove};
use crate::pathrule::{trace, Buy, Edge, Rule, Trace};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub struct Config {
    pub token: String,
    pub creator: String,
    pub market: String,
    pub window_s: u64,
    pub vest_s: u64,
    pub max_buyers: usize,
}

fn edge_json(e: &Edge) -> Value {
    json!({"tx": e.tx, "from": e.from, "to": e.to, "yocto": e.yocto.to_string(), "ts_ns": e.ts_ns, "block": e.height,
           "kind": format!("{:?}", e.kind)})
}

fn bps(part: u128, whole: u128) -> u64 {
    if whole == 0 {
        0
    } else {
        (part * 10_000 / whole) as u64
    }
}

pub fn run(c: &mut Client, cfg: &Config) -> Value {
    let (first, _, _) = c.account_page(&cfg.token, json!({"desc": false, "limit": 1}));
    let created = first.first().expect("token has no transactions").clone();
    let until = created.ts_ns + (cfg.vest_s + 3600) * 1_000_000_000;
    let list = c.account_txs_until(&cfg.token, created.height, until);
    let hashes: Vec<String> = list.iter().map(|t| t.hash.clone()).collect();
    let txs = c.txs(&hashes);
    let mut moves: Vec<FtMove> = txs.iter().flat_map(|t| ft_moves(t, &cfg.token)).collect();
    moves.sort_by_key(|m| m.ts_ns);
    let is_sale = |m: &FtMove| m.from == cfg.market && m.to != cfg.token && m.memo.as_deref() != Some("tax");
    let t0 = moves.iter().find(|m| is_sale(m)).expect("the market never sold").ts_ns;
    let win_end = t0 + cfg.window_s * 1_000_000_000;
    let vest_end = t0 + cfg.vest_s * 1_000_000_000;

    struct B {
        tokens: u128,
        first: FtMove,
        txs: Vec<String>,
    }
    let mut buyers: BTreeMap<String, B> = BTreeMap::new();
    for m in moves.iter().filter(|m| is_sale(m) && m.ts_ns < win_end) {
        let e = buyers.entry(m.to.clone()).or_insert(B { tokens: 0, first: m.clone(), txs: vec![] });
        e.tokens += m.amount;
        if !e.txs.contains(&m.tx) {
            e.txs.push(m.tx.clone());
        }
    }
    let total: u128 = buyers.values().map(|b| b.tokens).sum();
    let rule = Rule::new(&cfg.creator);
    let mut rows = Vec::new();
    let (mut direct, mut linked, mut unlinked, mut unpriced) = (0u128, 0u128, 0u128, 0u128);
    let (mut sold_all, mut sold_creator_side, mut sold_unlinked) = (0u128, 0u128, 0u128);
    let mut ordered: Vec<(&String, &B)> = buyers.iter().collect();
    ordered.sort_by(|a, b| b.1.tokens.cmp(&a.1.tokens));
    for (i, (wallet, b)) in ordered.iter().enumerate() {
        let out: u128 = moves.iter().filter(|m| &m.from == *wallet && m.ts_ns < vest_end && m.ts_ns >= b.first.ts_ns).map(|m| m.amount).sum();
        let sold = out.min(b.tokens);
        sold_all += sold;
        let cost: u128 = b.txs.iter().filter_map(|h| txs.iter().find(|t| &t.hash == h)).map(|t| cost_into(t, &cfg.market)).sum();
        let (class, path) = if *wallet == &cfg.creator {
            direct += b.tokens;
            sold_creator_side += sold;
            ("creator", vec![])
        } else if cost == 0 {
            unpriced += b.tokens;
            ("unpriced", vec![])
        } else if i >= cfg.max_buyers {
            unpriced += b.tokens;
            ("not_traced", vec![])
        } else {
            let buy = Buy { wallet: (*wallet).clone(), cost_yocto: cost, ts_ns: b.first.ts_ns };
            match trace(c, &buy, b.first.height, &rule) {
                Trace::Linked(p) => {
                    linked += b.tokens;
                    sold_creator_side += sold;
                    ("linked", p)
                }
                Trace::Direct => unreachable!(),
                Trace::Unlinked => {
                    unlinked += b.tokens;
                    sold_unlinked += sold;
                    ("unlinked", vec![])
                }
            }
        };
        eprintln!("{:>3} {:<22} {:>8} {:<9} sold {}%", i, &wallet[..wallet.len().min(22)], class, "", bps(sold, b.tokens) / 100);
        rows.push(json!({
            "wallet": wallet, "tokens": b.tokens.to_string(), "cost_yocto": cost.to_string(), "class": class,
            "first_buy_tx": b.first.tx, "buy_block": b.first.height, "sold_within_vest": sold.to_string(),
            "path": path.iter().map(edge_json).collect::<Vec<_>>(),
        }));
    }
    json!({
        "token": cfg.token, "creator": cfg.creator, "market": cfg.market,
        "window_s": cfg.window_s, "vest_s": cfg.vest_s,
        "opening_starts_ns": t0, "first_block_scanned": created.height, "txs_scanned": hashes.len(),
        "buyers": rows.len(), "opening_tokens": total.to_string(),
        "creator_direct_tokens": direct.to_string(),
        "creator_linked_tokens": linked.to_string(),
        "unlinked_tokens": unlinked.to_string(),
        "unpriced_tokens": unpriced.to_string(),
        "sold_within_vest_tokens": sold_all.to_string(),
        "shares_bps": {
            "creator_direct": bps(direct, total),
            "creator_linked": bps(linked, total),
            "creator_total": bps(direct + linked, total),
            "unpriced": bps(unpriced, total),
            "sold_within_vest": bps(sold_all, total),
            "sold_within_vest_by_creator_side": bps(sold_creator_side, direct + linked),
            "sold_within_vest_by_unlinked": bps(sold_unlinked, unlinked),
        },
        "rows": rows,
        "client": {"fastnear_calls": c.calls.get(), "cache_hits": c.hits.get()},
    })
}
