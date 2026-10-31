//! Replays a real launch: who bought in the opening window, how much of it moved within the vest
//! period, and how much was paid for with money that leads back to the creator under the path rule.
use crate::chain::{cost_into, edges_all, ft_moves, Client, FtMove};
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
    /// An account unrelated to this launch, standing in for the creator. The same walk must find nothing.
    pub placebo_creator: Option<String>,
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
    // creator-traceable tokens by the length of the shortest printed path: index 0 is one hop
    let mut by_hops = [0u128; 8];
    let (mut placebo_tested, mut placebo_linked) = (0u64, 0u128);
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
                    by_hops[(p.len() - 1).min(7)] += b.tokens;
                    linked += b.tokens;
                    sold_creator_side += sold;
                    ("linked", p)
                }
                Trace::Direct => unreachable!(),
                Trace::Unlinked => {
                    if let Some(fake) = &cfg.placebo_creator {
                        placebo_tested += 1;
                        if matches!(trace(c, &buy, b.first.height, &Rule::new(fake)), Trace::Linked(_) | Trace::Direct) {
                            placebo_linked += b.tokens;
                        }
                    }
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
    // Visible creator funding of opening buyers: how many arrived before the wallet's first opening buy, how many after.
    let floor_of = |w: &str| -> u128 {
        let b = &buyers[w];
        let cost: u128 = b.txs.iter().filter_map(|h| txs.iter().find(|t| &t.hash == h)).map(|t| cost_into(t, &cfg.market)).sum();
        rule.min_hop(cost)
    };
    let ctx = c.account_txs_until(&cfg.creator, created.height, vest_end);
    let chashes: Vec<String> = ctx.iter().map(|t| t.hash.clone()).collect();
    let (mut fund_before, mut fund_after) = (std::collections::BTreeSet::new(), std::collections::BTreeSet::new());
    for t in c.txs(&chashes) {
        for e in edges_all(&t).into_iter().filter(|e| e.from == cfg.creator && buyers.contains_key(&e.to) && e.to != cfg.creator) {
            if e.yocto == 0 || e.yocto < floor_of(&e.to) {
                continue;
            }
            if e.ts_ns < buyers[&e.to].first.ts_ns {
                fund_before.insert(e.to.clone());
            } else {
                fund_after.insert(e.to.clone());
            }
        }
    }
    json!({
        "creator_funding_of_buyers": {
            "wallets_funded_before_first_buy": fund_before.len(), "wallets_funded_only_after": fund_after.difference(&fund_before).count(),
            "before": fund_before, "after": fund_after,
        },
        "placebo": {"creator": cfg.placebo_creator, "buyers_tested": placebo_tested, "linked_tokens": placebo_linked.to_string(),
                    "linked_bps": bps(placebo_linked, total)},
        "creator_linked_bps_by_hops": {
            "1": bps(by_hops[0], total), "2": bps(by_hops[0] + by_hops[1], total),
            "3": bps(by_hops[0] + by_hops[1] + by_hops[2], total),
        },
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

/// Positive control on real chain data. Walks forward from `creator` along its largest real NEAR transfers
/// for up to `depth` hops, invents a purchase by the account reached (cost chosen so every real hop clears
/// the half-cost floor, time just after the last hop), and asks the backward search to find the path from
/// the wallet alone. A walker that cannot find a path that provably exists would also report "0 linked"
/// on a launch that has some, so every spike run is paired with this.
pub fn control(c: &mut Client, creator: &str, depth: usize) -> Value {
    let mut at = creator.to_string();
    let mut edges: Vec<Edge> = Vec::new();
    let mut seen = vec![creator.to_string()];
    for _ in 0..depth {
        let (list, _, _) = c.account_page(&at, json!({"desc": true, "limit": 60}));
        let hashes: Vec<String> = list.iter().map(|t| t.hash.clone()).collect();
        let last_ts = edges.last().map(|e| e.ts_ns).unwrap_or(0);
        let next = c
            .txs(&hashes)
            .iter()
            .flat_map(edges_all)
            .filter(|e| e.from == at && e.ts_ns > last_ts && !crate::pathrule::is_hub(&e.to) && !seen.contains(&e.to) && e.yocto >= 10u128.pow(23))
            .max_by_key(|e| e.yocto);
        match next {
            Some(e) => {
                at = e.to.clone();
                seen.push(at.clone());
                edges.push(e);
            }
            None => break,
        }
    }
    let Some(last) = edges.last().cloned() else {
        return json!({"creator": creator, "forward_hops": 0, "backward_search": "no forward chain to test"});
    };
    let cost = edges.iter().map(|e| e.yocto).min().unwrap();
    let buy = Buy { wallet: last.to.clone(), cost_yocto: cost, ts_ns: last.ts_ns + 1 };
    let found = trace(c, &buy, last.height + 1, &Rule::new(creator));
    let (verdict, back) = match &found {
        Trace::Linked(p) => ("linked", p.clone()),
        Trace::Direct => ("direct", vec![]),
        Trace::Unlinked => ("unlinked", vec![]),
    };
    // the same buy against a creator that never sent this wallet anything
    let wrong = trace(c, &buy, last.height + 1, &Rule::new("customs-no-such-creator.near"));
    json!({
        "creator": creator, "wallet": last.to, "forward_hops": edges.len(),
        "forward": edges.iter().map(edge_json).collect::<Vec<_>>(),
        "backward_search": verdict, "backward_path": back.iter().map(edge_json).collect::<Vec<_>>(),
        "same_wallet_other_creator_unlinked": matches!(wrong, Trace::Unlinked),
    })
}
