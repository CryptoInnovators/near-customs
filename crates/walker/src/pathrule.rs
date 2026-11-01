//! The rule that convicts. It decides one thing: did the creator's money pay for this opening buy.
//! It never decides who owns a wallet. Pure functions over receipt facts, so the same code runs in
//! the offline walker and in the enclave module that signs verdicts.

/// An account that has touched more transactions than this is treated as a hub.
pub const BUSY_TXS: u64 = 3000;

/// The published hub list, embedded so the offline walker and the enclave module read the same bytes.
#[cfg(not(feature = "testnet"))]
const HUBS_JSON: &str = include_str!("../hubs.json");
#[cfg(feature = "testnet")]
const HUBS_JSON: &str = include_str!("../hubs.testnet.json");

pub struct HubList {
    pub version: u64,
    pub sha256: String,
    pub hubs: Vec<String>,
}

pub fn hub_list() -> &'static HubList {
    static L: std::sync::OnceLock<HubList> = std::sync::OnceLock::new();
    L.get_or_init(|| {
        use sha2::{Digest, Sha256};
        let v: serde_json::Value = serde_json::from_str(HUBS_JSON).expect("hubs.json is valid json");
        HubList {
            version: v["version"].as_u64().expect("hubs.json has a version"),
            sha256: customs_common::hex_lower(&Sha256::digest(HUBS_JSON.as_bytes())),
            hubs: v["hubs"]
                .as_array()
                .expect("hubs.json has a hubs array")
                .iter()
                .map(|h| h["account"].as_str().expect("every hub names an account").to_string())
                .collect(),
        }
    })
}

#[derive(Clone, Debug, PartialEq)]
pub enum EdgeKind {
    /// Native NEAR: a `Transfer` action or a `FunctionCall` deposit.
    Transfer,
    IntentsWithdraw,
    /// wNEAR moved by `wrap.near`'s `ft_transfer`, read from its own `Transfer a from x to y` log line.
    WrapTransfer,
    /// wNEAR moved between two accounts inside `intents.near`, read from its `dip4 transfer` event.
    IntentsTransfer,
}

/// One movement of NEAR into `to`, read from a receipt or from an Intents `native_withdraw` event.
#[derive(Clone, Debug, PartialEq)]
pub struct Edge {
    pub tx: String,
    pub from: String,
    pub to: String,
    pub yocto: u128,
    pub ts_ns: u64,
    pub height: u64,
    pub kind: EdgeKind,
}

#[derive(Clone, Debug)]
pub struct Buy {
    pub wallet: String,
    pub cost_yocto: u128,
    pub ts_ns: u64,
}

#[derive(Clone, Debug)]
pub struct Rule {
    pub creator: String,
    pub max_hops: usize,
    /// Accounts the caller measured as too busy to be a person (an unlisted exchange hot wallet, a relayer).
    /// They count as hubs for this check only.
    pub busy: Vec<String>,
    /// Minimum share of the buy cost every hop must move, in basis points.
    pub min_share_bps: u128,
}

impl Rule {
    pub fn new(creator: &str) -> Rule {
        Rule { creator: creator.to_string(), max_hops: 3, busy: vec![], min_share_bps: 5000 }
    }
    pub fn min_hop(&self, cost: u128) -> u128 {
        cost / 10_000 * self.min_share_bps + (cost % 10_000) * self.min_share_bps / 10_000
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Reject {
    Empty,
    TooLong,
    FirstHopNotCreator,
    Broken { at: usize },
    HopTooSmall { at: usize },
    OutOfOrder { at: usize },
    NotBeforeBuy,
    EndsElsewhere,
    Hub { at: usize, who: String },
    Busy { at: usize, who: String },
    NoCost,
}

pub fn is_hub(who: &str) -> bool {
    hub_list().hubs.iter().any(|h| h == who)
}

/// Check a printed path, creator first. `Ok` means the creator's money reached the wallet before the buy.
pub fn check(path: &[Edge], buy: &Buy, rule: &Rule) -> Result<(), Reject> {
    if buy.wallet == rule.creator {
        return Ok(());
    }
    if buy.cost_yocto == 0 {
        return Err(Reject::NoCost);
    }
    if path.is_empty() {
        return Err(Reject::Empty);
    }
    if path.len() > rule.max_hops {
        return Err(Reject::TooLong);
    }
    if path[0].from != rule.creator {
        return Err(Reject::FirstHopNotCreator);
    }
    let floor = rule.min_hop(buy.cost_yocto);
    for (i, e) in path.iter().enumerate() {
        if is_hub(&e.from) && e.from != rule.creator {
            return Err(Reject::Hub { at: i, who: e.from.clone() });
        }
        if is_hub(&e.to) {
            return Err(Reject::Hub { at: i, who: e.to.clone() });
        }
        if i + 1 < path.len() && rule.busy.contains(&e.to) {
            return Err(Reject::Busy { at: i, who: e.to.clone() });
        }
        if e.yocto < floor {
            return Err(Reject::HopTooSmall { at: i });
        }
        if i > 0 {
            if path[i - 1].to != e.from {
                return Err(Reject::Broken { at: i });
            }
            if path[i - 1].ts_ns >= e.ts_ns {
                return Err(Reject::OutOfOrder { at: i });
            }
        }
    }
    let last = path.last().unwrap();
    if last.to != buy.wallet {
        return Err(Reject::EndsElsewhere);
    }
    if last.ts_ns >= buy.ts_ns {
        return Err(Reject::NotBeforeBuy);
    }
    Ok(())
}

/// Source of inflows for the backward search. The chain client implements it; tests use a table.
pub trait Inflows {
    /// Inflows into `account` that landed strictly before `before_ts_ns` (height `before_height`) and moved at least `min_yocto`.
    fn inflows(&mut self, account: &str, before_ts_ns: u64, before_height: u64, min_yocto: u128) -> Vec<Edge>;
    /// True when `account` is too busy to be a person (an exchange, a router, a relayer).
    fn is_busy(&mut self, account: &str) -> bool;
}

#[derive(Debug, PartialEq)]
pub enum Trace {
    Direct,
    Linked(Vec<Edge>),
    Unlinked,
}

/// Search backward from the wallet for a path that `check` accepts. Breadth first, so the shortest path wins.
pub fn trace<I: Inflows>(src: &mut I, buy: &Buy, buy_height: u64, rule: &Rule) -> Trace {
    if buy.wallet == rule.creator {
        return Trace::Direct;
    }
    let floor = rule.min_hop(buy.cost_yocto);
    if floor == 0 {
        return Trace::Unlinked;
    }
    // each frontier entry is the path from `node` forward to the wallet, with the time bound for inflows into `node`
    let mut frontier: Vec<(String, u64, u64, Vec<Edge>)> = vec![(buy.wallet.clone(), buy.ts_ns, buy_height, vec![])];
    let mut seen = vec![buy.wallet.clone()];
    for _depth in 0..rule.max_hops {
        let mut next = Vec::new();
        for (node, bound_ts, bound_h, tail) in &frontier {
            for e in src.inflows(node, *bound_ts, *bound_h, floor) {
                if e.yocto < floor || e.ts_ns >= *bound_ts {
                    continue;
                }
                let mut path = vec![e.clone()];
                path.extend(tail.iter().cloned());
                if e.from == rule.creator {
                    if check(&path, buy, rule).is_ok() {
                        return Trace::Linked(path);
                    }
                    continue;
                }
                if is_hub(&e.from) || seen.contains(&e.from) || src.is_busy(&e.from) {
                    continue;
                }
                seen.push(e.from.clone());
                next.push((e.from.clone(), e.ts_ns, e.height, path));
            }
        }
        if next.is_empty() {
            break;
        }
        frontier = next;
    }
    Trace::Unlinked
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const Y: u128 = 1_000_000_000_000_000_000_000_000;

    fn edge(tx: &str, from: &str, to: &str, near: u128, ts: u64) -> Edge {
        Edge { tx: tx.into(), from: from.into(), to: to.into(), yocto: near * Y / 10, ts_ns: ts, height: ts, kind: EdgeKind::Transfer }
    }

    fn buy(wallet: &str) -> Buy {
        Buy { wallet: wallet.into(), cost_yocto: 10 * Y, ts_ns: 1000 }
    }

    struct Table(HashMap<String, Vec<Edge>>);
    impl Inflows for Table {
        fn inflows(&mut self, a: &str, before: u64, _h: u64, min: u128) -> Vec<Edge> {
            self.0.get(a).map(|v| v.iter().filter(|e| e.ts_ns < before && e.yocto >= min).cloned().collect()).unwrap_or_default()
        }
        fn is_busy(&mut self, _a: &str) -> bool {
            false
        }
    }

    fn table(edges: Vec<Edge>) -> Table {
        let mut m: HashMap<String, Vec<Edge>> = HashMap::new();
        for e in edges {
            m.entry(e.to.clone()).or_default().push(e);
        }
        Table(m)
    }

    #[test]
    fn direct_funding_is_accepted() {
        let p = vec![edge("a", "creator.near", "w.near", 100, 500)];
        assert_eq!(check(&p, &buy("w.near"), &Rule::new("creator.near")), Ok(()));
    }

    #[test]
    fn three_hop_path_is_accepted_and_found() {
        let edges = vec![
            edge("a", "creator.near", "x.near", 120, 100),
            edge("b", "x.near", "y.near", 110, 200),
            edge("c", "y.near", "w.near", 100, 300),
        ];
        let mut t = table(edges.clone());
        assert_eq!(check(&edges, &buy("w.near"), &Rule::new("creator.near")), Ok(()));
        assert_eq!(trace(&mut t, &buy("w.near"), 1000, &Rule::new("creator.near")), Trace::Linked(edges));
    }

    #[test]
    fn dust_planted_after_the_buy_is_rejected() {
        let p = vec![edge("a", "creator.near", "w.near", 100, 1500)];
        assert_eq!(check(&p, &buy("w.near"), &Rule::new("creator.near")), Err(Reject::NotBeforeBuy));
        let mut t = table(p);
        assert_eq!(trace(&mut t, &buy("w.near"), 1000, &Rule::new("creator.near")), Trace::Unlinked);
    }

    #[test]
    fn dust_before_the_buy_is_rejected_by_the_half_cost_floor() {
        let p = vec![edge("a", "creator.near", "w.near", 1, 500)];
        assert_eq!(check(&p, &buy("w.near"), &Rule::new("creator.near")), Err(Reject::HopTooSmall { at: 0 }));
        let mut t = table(p);
        assert_eq!(trace(&mut t, &buy("w.near"), 1000, &Rule::new("creator.near")), Trace::Unlinked);
    }

    #[test]
    fn a_hop_through_a_hub_is_rejected() {
        let p = vec![
            edge("a", "creator.near", "wrap.near", 100, 100),
            edge("b", "wrap.near", "w.near", 100, 200),
        ];
        assert!(matches!(check(&p, &buy("w.near"), &Rule::new("creator.near")), Err(Reject::Hub { .. })));
    }

    #[test]
    fn five_hops_is_too_long_and_hop_order_matters() {
        let r = Rule::new("c.near");
        let name = |i: i32| if i < 0 { "c.near".to_string() } else if i == 4 { "w.near".to_string() } else { format!("n{i}") };
        let long: Vec<Edge> = (0..5).map(|i| edge("t", &name(i - 1), &name(i), 100, 100 + i as u64)).collect();
        assert_eq!(check(&long, &buy("w.near"), &r), Err(Reject::TooLong));
        let swapped = vec![edge("a", "c.near", "x.near", 100, 300), edge("b", "x.near", "w.near", 100, 200)];
        assert_eq!(check(&swapped, &buy("w.near"), &r), Err(Reject::OutOfOrder { at: 1 }));
    }

    #[test]
    fn broken_chain_and_wrong_start_and_wrong_end() {
        let r = Rule::new("c.near");
        let broken = vec![edge("a", "c.near", "x.near", 100, 100), edge("b", "z.near", "w.near", 100, 200)];
        assert_eq!(check(&broken, &buy("w.near"), &r), Err(Reject::Broken { at: 1 }));
        let other = vec![edge("a", "stranger.near", "w.near", 100, 100)];
        assert_eq!(check(&other, &buy("w.near"), &r), Err(Reject::FirstHopNotCreator));
        let ends = vec![edge("a", "c.near", "x.near", 100, 100)];
        assert_eq!(check(&ends, &buy("w.near"), &r), Err(Reject::EndsElsewhere));
        assert_eq!(check(&[], &buy("w.near"), &r), Err(Reject::Empty));
    }

    #[test]
    fn default_hop_limit_is_three() {
        let r = Rule::new("c.near");
        assert_eq!(r.max_hops, 3);
        let name = |i: i32| if i < 0 { "c.near".to_string() } else if i == 3 { "w.near".to_string() } else { format!("n{i}") };
        let four: Vec<Edge> = (0..4).map(|i| edge("t", &name(i - 1), &name(i), 100, 100 + i as u64)).collect();
        assert_eq!(check(&four, &buy("w.near"), &r), Err(Reject::TooLong));
    }

    #[test]
    fn the_hub_list_is_a_versioned_file_the_rule_reads() {
        let l = hub_list();
        assert!(l.version >= 1);
        assert!(l.hubs.iter().any(|h| h == "intents.near"));
        assert!(is_hub("wrap.near") && !is_hub("alice.near"));
        assert_eq!(l.sha256.len(), 64);
    }

    #[test]
    fn a_path_through_an_unlisted_busy_wallet_convicts_nothing() {
        // `cex-hot.near` is on no list. The caller measured it busy, so it is treated like a hub.
        let p = vec![
            edge("a", "creator.near", "cex-hot.near", 100, 100),
            edge("b", "cex-hot.near", "w.near", 100, 200),
        ];
        let mut r = Rule::new("creator.near");
        assert_eq!(check(&p, &buy("w.near"), &r), Ok(()), "unmeasured, the path looks clean");
        r.busy.push("cex-hot.near".to_string());
        assert_eq!(check(&p, &buy("w.near"), &r), Err(Reject::Busy { at: 0, who: "cex-hot.near".into() }));
    }

    #[test]
    fn the_creator_buying_directly_needs_no_path() {
        assert_eq!(check(&[], &buy("c.near"), &Rule::new("c.near")), Ok(()));
        let mut t = table(vec![]);
        assert_eq!(trace(&mut t, &buy("c.near"), 1, &Rule::new("c.near")), Trace::Direct);
    }

    #[test]
    fn intents_hop_names_the_owner_and_is_followed() {
        let mut w = edge("h", "owner.near", "w.near", 100, 300);
        w.kind = EdgeKind::IntentsWithdraw;
        let edges = vec![edge("a", "creator.near", "owner.near", 100, 100), w];
        let mut t = table(edges.clone());
        assert_eq!(trace(&mut t, &buy("w.near"), 1000, &Rule::new("creator.near")), Trace::Linked(edges));
    }
}
