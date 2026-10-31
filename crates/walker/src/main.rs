use customs_walker::chain::{cost_into, ft_moves, path_edges, Client};
use customs_walker::pathrule::{check, Buy, Rule};
use customs_walker::replay::{run, Config};
use serde_json::{json, Value};

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn need(args: &[String], name: &str) -> String {
    arg(args, name).unwrap_or_else(|| {
        eprintln!("missing {name}");
        std::process::exit(2)
    })
}

fn head_block() -> Value {
    let r: Value = ureq::post("https://archival-rpc.mainnet.fastnear.com")
        .send_json(json!({"jsonrpc":"2.0","id":1,"method":"block","params":{"finality":"final"}}))
        .expect("rpc")
        .into_json()
        .expect("json");
    json!({"rpc": "archival-rpc.mainnet.fastnear.com block final", "height": r["result"]["header"]["height"], "hash": r["result"]["header"]["hash"]})
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cache = arg(&args, "--cache").unwrap_or_else(|| ".walker-cache".into());
    let gap: u64 = arg(&args, "--gap-ms").and_then(|g| g.parse().ok()).unwrap_or(150);
    match args.first().map(|s| s.as_str()) {
        Some("replay") => {
            let mut c = Client::new(&cache, gap);
            let cfg = Config {
                token: need(&args, "--token"),
                creator: need(&args, "--creator"),
                market: arg(&args, "--market").unwrap_or_else(|| "dclv2.ref-labs.near".into()),
                window_s: arg(&args, "--window-s").and_then(|v| v.parse().ok()).unwrap_or(600),
                vest_s: arg(&args, "--vest-s").and_then(|v| v.parse().ok()).unwrap_or(86_400),
                max_buyers: arg(&args, "--max-buyers").and_then(|v| v.parse().ok()).unwrap_or(60),
            };
            let mut report = run(&mut c, &cfg);
            report["head"] = head_block();
            println!("{}", serde_json::to_string_pretty(&report).unwrap());
        }
        // customs-walker check-path --token T --creator C --wallet W --buy-tx H --path h1,h2,h3
        Some("check-path") => {
            let c = Client::new(&cache, gap);
            let market = arg(&args, "--market").unwrap_or_else(|| "dclv2.ref-labs.near".into());
            let (token, creator, wallet) = (need(&args, "--token"), need(&args, "--creator"), need(&args, "--wallet"));
            let buy_tx = c.txs(&[need(&args, "--buy-tx")]).remove(0);
            let bm = ft_moves(&buy_tx, &token).into_iter().find(|m| m.to == wallet && m.from == market).expect("buy tx does not pay the wallet");
            let buy = Buy { wallet: wallet.clone(), cost_yocto: cost_into(&buy_tx, &market), ts_ns: bm.ts_ns };
            let hashes: Vec<String> = need(&args, "--path").split(',').filter(|s| !s.is_empty()).map(String::from).collect();
            let edges = path_edges(&creator, &c.txs(&hashes));
            let rule = Rule::new(&creator);
            let (verdict, reason) = match check(&edges, &buy, &rule) {
                Ok(()) => ("upheld", Value::Null),
                Err(r) => ("rejected", json!(format!("{r:?}"))),
            };
            println!("{}", json!({"verdict": verdict, "reason": reason, "buy_cost_yocto": buy.cost_yocto.to_string(),
                "edges": edges.iter().map(|e| json!({"tx": e.tx, "from": e.from, "to": e.to, "yocto": e.yocto.to_string(), "ts_ns": e.ts_ns})).collect::<Vec<_>>()}));
        }
        _ => {
            eprintln!("usage: customs-walker replay --token T --creator C [--market M] [--window-s 600] [--vest-s 86400] [--cache DIR]\n       customs-walker check-path --token T --creator C --wallet W --buy-tx H --path h1,h2");
            std::process::exit(2);
        }
    }
}
