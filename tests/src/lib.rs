//! Sandbox harness. Builds the real token wasm and the real checker wasm, deploys the token beside the
//! OutLayer contract code that runs on mainnet (`scripts/fetch-outlayer.sh`), and plays the one part a
//! sandbox cannot host: the TEE worker. The worker role does what the real worker does. It reads the
//! pending request from the OutLayer contract, runs the checker over the transactions it names, and
//! calls `resolve_execution` as the operator. The checker is the production code; only the enclave key
//! and the transaction source are the test's.
use anyhow::{anyhow, Context, Result};
use customs_checker::{ed25519_string, run as run_checker, Signer, TxSource};
use customs_walker::receipts::{parse_tx, Tx};
use ed25519_dalek::{Signer as _, SigningKey};
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::sync::OnceCell;

pub const UNIT: u128 = 1_000_000_000_000_000_000_000_000; // 1 token, 24 decimals
pub const NEAR_Y: u128 = 1_000_000_000_000_000_000_000_000;
pub const SUPPLY: u128 = 1_000_000_000 * UNIT;
pub const SEED: [u8; 32] = [7u8; 32];
pub const OTHER_SEED: [u8; 32] = [9u8; 32];

pub fn root_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn target_dir() -> PathBuf {
    std::env::var_os("CARGO_TARGET_DIR").map(PathBuf::from).unwrap_or_else(|| root_dir().join("target"))
}

fn newest(p: &std::path::Path) -> std::time::SystemTime {
    let mut t = std::fs::metadata(p).and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
    if p.is_dir() {
        for e in std::fs::read_dir(p).into_iter().flatten().flatten() {
            t = t.max(newest(&e.path()));
        }
    }
    t
}

fn fresh(wasm: &std::path::Path, sources: &[&str]) -> bool {
    let root = root_dir();
    let built = std::fs::metadata(wasm).and_then(|m| m.modified()).ok();
    let src = sources.iter().map(|s| newest(&root.join(s))).max().unwrap();
    built.map(|b| b >= src).unwrap_or(false)
}

/// Rebuilds only when a source file is newer than the wasm, so a mutated guard is always the code under test.
fn build_token() -> Result<Vec<u8>> {
    let out = target_dir().join("sandbox-wasm");
    std::fs::create_dir_all(&out)?;
    let wasm_path = out.join("customs_token.wasm");
    if fresh(&wasm_path, &["contracts/token/src", "contracts/token/Cargo.toml", "crates/common/src"]) {
        return std::fs::read(&wasm_path).context("read token wasm");
    }
    let status = std::process::Command::new("cargo")
        .args(["near", "build", "non-reproducible-wasm", "--no-abi", "--env", "RUSTFLAGS=--cfg near -C link-arg=-s", "--out-dir"])
        .arg(&out)
        .current_dir(root_dir().join("contracts/token"))
        .status()
        .context("run cargo near build")?;
    if !status.success() {
        return Err(anyhow!("cargo near build failed: {status}"));
    }
    std::fs::read(&wasm_path).context("read token wasm")
}

/// The WASI checker exactly as OutLayer would be handed it.
pub fn checker_wasm_path() -> PathBuf {
    target_dir().join("wasm32-wasip2/release/customs-checker.wasm")
}

fn build_checker() -> Result<Vec<u8>> {
    let path = checker_wasm_path();
    if !fresh(&path, &["crates/checker/src", "crates/checker/Cargo.toml", "crates/checker/manifest.json", "crates/checker/wit", "crates/walker/src", "crates/common/src"]) {
        let status = std::process::Command::new("cargo")
            .args(["build", "-p", "customs-checker", "--target", "wasm32-wasip2", "--release"])
            .current_dir(root_dir())
            .status()
            .context("build the checker")?;
        if !status.success() {
            return Err(anyhow!("checker build failed: {status}"));
        }
    }
    std::fs::read(&path).context("read checker wasm")
}

fn outlayer_wasm() -> Result<Vec<u8>> {
    let status = std::process::Command::new(root_dir().join("scripts/fetch-outlayer.sh")).status().context("fetch outlayer")?;
    if !status.success() {
        return Err(anyhow!("fetch-outlayer.sh failed: {status}"));
    }
    std::fs::read(root_dir().join("target/sandbox-wasm/outlayer.wasm")).context("read outlayer wasm")
}

pub struct Wasm {
    pub token: Vec<u8>,
    pub outlayer: Vec<u8>,
    pub checker: Vec<u8>,
    pub checker_sha: String,
}

pub async fn wasm() -> &'static Wasm {
    static CELL: OnceCell<Wasm> = OnceCell::const_new();
    CELL.get_or_init(|| async {
        tokio::task::spawn_blocking(|| {
            let checker = build_checker().expect("checker builds");
            Wasm {
                token: build_token().expect("token builds"),
                outlayer: outlayer_wasm().expect("outlayer code"),
                checker_sha: hex(&Sha256::digest(&checker)),
                checker,
            }
        })
        .await
        .unwrap()
    })
    .await
}

pub fn near(n: f64) -> NearToken {
    NearToken::from_yoctonear((n * 1e24) as u128)
}

pub fn hex(b: &[u8]) -> String {
    customs_common::hex_lower(b)
}

/// A syntactically valid transaction hash for a path entry.
pub fn fake_tx(n: u8) -> String {
    bs58::encode(Sha256::digest([n])).into_string()
}

pub struct Knobs {
    pub window_s: u64,
    pub vest_s: u64,
    pub seize_bps: u16,
    pub lock_s: u64,
    pub min_bond: NearToken,
    pub exec_fee: NearToken,
    pub reclaim_blocks: u64,
    pub max_age_blocks: u64,
    pub max_hops: u8,
}

impl Default for Knobs {
    fn default() -> Self {
        Knobs {
            window_s: 600,
            vest_s: 86_400,
            seize_bps: 2000,
            lock_s: 2_592_000,
            min_bond: near(1.0),
            exec_fee: near(0.1),
            reclaim_blocks: 220,
            max_age_blocks: 50,
            max_hops: 3,
        }
    }
}

/// The enclave key. On mainnet OutLayer derives it inside the TEE; here the test owns it.
pub struct Enclave(pub [u8; 32]);

impl Enclave {
    pub fn key(&self) -> String {
        ed25519_string(&SigningKey::from_bytes(&self.0).verifying_key().to_bytes())
    }
}

impl Signer for Enclave {
    fn public_key(&self) -> Result<[u8; 32], String> {
        Ok(SigningKey::from_bytes(&self.0).verifying_key().to_bytes())
    }
    fn sign(&self, message: &[u8]) -> Result<[u8; 64], String> {
        Ok(SigningKey::from_bytes(&self.0).sign(message).to_bytes())
    }
}

/// FastNEAR-shaped transactions the checker can read. The test writes what the chain would hold.
#[derive(Default)]
pub struct Chain {
    txs: Mutex<Vec<Value>>,
    counts: Mutex<std::collections::HashMap<String, u64>>,
    unmeasurable: Mutex<Vec<String>>,
}

impl Chain {
    pub fn put(&self, raw: Value) {
        self.txs.lock().unwrap().push(raw);
    }

    /// The source errors when asked about `account`, as an unreachable API would.
    pub fn fail_tx_count(&self, account: &str) {
        self.unmeasurable.lock().unwrap().push(account.to_string());
    }

    /// How many transactions the chain says `account` has touched. Unset accounts have touched 3.
    pub fn set_tx_count(&self, account: &str, n: u64) {
        self.counts.lock().unwrap().insert(account.to_string(), n);
    }
}

impl TxSource for Chain {
    fn txs(&self, hashes: &[String]) -> Result<Vec<Tx>, String> {
        Ok(self
            .txs
            .lock()
            .unwrap()
            .iter()
            .filter(|r| hashes.iter().any(|h| r["transaction"]["hash"] == json!(h)))
            .map(parse_tx)
            .collect())
    }

    fn tx_count(&self, account: &str) -> Result<u64, String> {
        if self.unmeasurable.lock().unwrap().iter().any(|a| a == account) {
            return Err(format!("cannot count transactions of {account}"));
        }
        Ok(self.counts.lock().unwrap().get(account).copied().unwrap_or(3))
    }
}

fn receipt(pred: &str, recv: &str, ts_ns: u64, transfers: &[u128], logs: Vec<String>) -> Value {
    json!({
        "execution_outcome": {"outcome": {"logs": logs, "status": {"SuccessValue": ""}}},
        "receipt": {"predecessor_id": pred, "receiver_id": recv, "block_timestamp": ts_ns, "block_height": ts_ns / 1_000_000_000,
            "receipt": {"Action": {"actions": transfers.iter().map(|d| json!({"Transfer": {"deposit": d.to_string()}})).collect::<Vec<_>>()}}}
    })
}

/// A plain NEAR transfer `from` to `to`.
pub fn transfer_tx(hash: &str, from: &str, to: &str, yocto: u128, ts_ns: u64) -> Value {
    json!({"transaction": {"hash": hash, "signer_id": from}, "receipts": [receipt(from, to, ts_ns, &[yocto], vec![])]})
}

/// A buy on the DEX: `wallet` pays `cost` wNEAR into `market`, and the market pays `tokens` to `wallet`.
pub fn buy_tx(hash: &str, token: &str, market: &str, wallet: &str, tokens: u128, cost: u128, ts_ns: u64) -> Value {
    let pay = format!("Transfer {cost} from {wallet} to {market}");
    let ev = format!(
        r#"EVENT_JSON:{{"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{{"old_owner_id":"{market}","new_owner_id":"{wallet}","amount":"{tokens}"}}]}}"#
    );
    json!({"transaction": {"hash": hash, "signer_id": wallet},
        "receipts": [receipt(wallet, "wrap.near", ts_ns - 1, &[], vec![pay]), receipt(market, token, ts_ns, &[], vec![ev])]})
}

/// What the worker role does with a request.
#[derive(Clone, Debug)]
pub enum Mode {
    /// Run the checker over the named transactions and sign what it decides.
    Honest,
    /// Never answer; the yield times out.
    Silent,
    /// Report a failed run.
    Fail,
    /// The checker's answer, signed by a key the token did not pin.
    OtherKey,
    /// Sign a verdict value of the test's choosing for the request's own facts, as a buggy or hostile enclave would.
    Force(&'static str),
    /// Sign the request's facts with the block shifted.
    BlockDelta(i64),
    /// Sign facts the request did not name: "wallet", "token" or "path".
    OtherFacts(&'static str),
}

pub struct World {
    pub worker: Worker<Sandbox>,
    pub root: Account,
    pub token: Contract,
    pub outlayer: Contract,
    pub operator: Account,
    pub owner: Account,
    pub market: Account,
    pub creator: Account,
    pub insider: Account,
    pub outsider: Account,
    pub hunter: Account,
    pub knobs: Knobs,
    pub enclave: Enclave,
    pub chain: Chain,
    pub checker_sha: String,
}

impl World {
    pub async fn new() -> Result<World> {
        Self::with(Knobs::default()).await
    }

    /// A world whose verdict key is pinned through the real pin flow.
    pub async fn with(knobs: Knobs) -> Result<World> {
        let w = Self::unpinned(knobs).await?;
        w.pin(&Mode::Honest).await?.into_result()?;
        Ok(w)
    }

    pub async fn unpinned(knobs: Knobs) -> Result<World> {
        let wasm = wasm().await;
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;
        let mk = |n: &'static str, bal: f64| {
            let root = root.clone();
            async move {
                Ok::<_, anyhow::Error>(root.create_subaccount(n).initial_balance(near(bal)).transact().await?.into_result()?)
            }
        };
        let owner = mk("owner", 20.0).await?;
        let market = mk("market", 20.0).await?;
        let creator = mk("creator", 20.0).await?;
        let insider = mk("insider", 20.0).await?;
        let outsider = mk("outsider", 20.0).await?;
        let hunter = mk("hunter", 50.0).await?;
        let operator = mk("operator", 10.0).await?;

        let ol_acc = mk("outlayer", 30.0).await?;
        let outlayer = ol_acc.deploy(&wasm.outlayer).await?.into_result()?;
        outlayer
            .call("new")
            .args_json(json!({"owner_id": owner.id(), "operator_id": operator.id(), "event_standard": null, "event_version": null}))
            .transact()
            .await?
            .into_result()?;

        let tok_acc = mk("customs", 30.0).await?;
        let token = tok_acc.deploy(&wasm.token).await?.into_result()?;
        token
            .call("new")
            .args_json(json!({
                "owner_id": owner.id(),
                "total_supply": SUPPLY.to_string(),
                "metadata": {"spec":"ft-1.0.0","name":"Customs Paper","symbol":"PAPERS","icon":null,
                             "reference":null,"reference_hash":null,"decimals":24},
                "params": {
                    "market_id": market.id(),
                    "creator_id": creator.id(),
                    "outlayer_id": outlayer.id(),
                    "module_url": "https://example.invalid/customs-checker.wasm",
                    "module_sha256": wasm.checker_sha,
                    "window_s": knobs.window_s,
                    "vest_s": knobs.vest_s,
                    "seize_bps": knobs.seize_bps,
                    "lock_s": knobs.lock_s,
                    "min_bond": knobs.min_bond.as_yoctonear().to_string(),
                    "exec_fee": knobs.exec_fee.as_yoctonear().to_string(),
                    "reclaim_blocks": knobs.reclaim_blocks,
                    "max_age_blocks": knobs.max_age_blocks,
                    "max_hops": knobs.max_hops,
                }
            }))
            .transact()
            .await?
            .into_result()?;

        let world = World {
            worker, root, token, outlayer, operator, owner, market, creator, insider, outsider, hunter, knobs,
            enclave: Enclave(SEED), chain: Chain::default(), checker_sha: wasm.checker_sha.clone(),
        };
        // everyone who will hold tokens registers, then the owner funds the market (the LP)
        for a in [&world.market, &world.creator, &world.insider, &world.outsider, &world.hunter] {
            world.register(a).await?;
        }
        world
            .owner
            .call(world.token.id(), "ft_transfer")
            .args_json(json!({"receiver_id": world.market.id(), "amount": (SUPPLY / 2).to_string()}))
            .deposit(NearToken::from_yoctonear(1))
            .transact()
            .await?
            .into_result()?;
        Ok(world)
    }

    pub async fn register(&self, who: &Account) -> Result<()> {
        who.call(self.token.id(), "storage_deposit")
            .args_json(json!({"account_id": who.id(), "registration_only": true}))
            .deposit(near(0.01))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    /// The market sells `amount` tokens to `to`, as the DEX does: a plain ft_transfer.
    pub async fn market_pays(&self, to: &Account, amount: u128) -> Result<ExecutionFinalResult> {
        Ok(self
            .market
            .call(self.token.id(), "ft_transfer")
            .args_json(json!({"receiver_id": to.id(), "amount": amount.to_string()}))
            .deposit(NearToken::from_yoctonear(1))
            .transact()
            .await?)
    }

    pub async fn transfer(&self, from: &Account, to: &Account, amount: u128) -> Result<ExecutionFinalResult> {
        Ok(from
            .call(self.token.id(), "ft_transfer")
            .args_json(json!({"receiver_id": to.id(), "amount": amount.to_string()}))
            .deposit(NearToken::from_yoctonear(1))
            .transact()
            .await?)
    }

    pub async fn balance(&self, who: &Account) -> Result<u128> {
        let v: String = self.token.view("ft_balance_of").args_json(json!({"account_id": who.id()})).await?.json()?;
        Ok(v.parse()?)
    }

    pub async fn bag(&self, who: &Account) -> Result<Value> {
        Ok(self.token.view("opening_of").args_json(json!({"account_id": who.id()})).await?.json()?)
    }

    pub async fn native(&self, who: &Account) -> Result<u128> {
        Ok(who.view_account().await?.balance.as_yoctonear())
    }

    pub async fn challenge_state(&self, id: u64) -> Result<Value> {
        let v: Value = self.token.view("challenge_of").args_json(json!({"challenge_id": id})).await?.json()?;
        Ok(v["state"].clone())
    }

    pub async fn pinned_key(&self) -> Result<Value> {
        Ok(self.token.view("verdict_key").await?.json()?)
    }

    /// The window the token opened, in nanoseconds, as the checker is told it.
    pub async fn window_ns(&self) -> Result<(u64, u64)> {
        let v: Value = self.token.view("window").await?.json()?;
        Ok((v["start_s"].as_u64().context("window not open")? * 1_000_000_000, v["opening_ends_s"].as_u64().unwrap() * 1_000_000_000))
    }

    // ----- the chain the checker reads -----

    /// Writes the transactions of a creator-funded path into the chain the checker reads, and returns the
    /// path a challenger would file: hop transactions in order, then the buy. `hop_yocto` is what each
    /// hop moves, `hops_before_buy` says whether they land before the buy.
    pub async fn plant_path(&self, wallet: &Account, via: &[&Account], hop_yocto: u128, hops_before_buy: bool, tag: u8) -> Result<Vec<String>> {
        let (start, _) = self.window_ns().await?;
        let buy_ts = start + 5_000_000_000;
        let cost = 10 * NEAR_Y;
        let mut chain = vec![self.creator.id().to_string()];
        chain.extend(via.iter().map(|a| a.id().to_string()));
        chain.push(wallet.id().to_string());
        let mut path = Vec::new();
        for (i, pair) in chain.windows(2).enumerate() {
            let h = fake_tx(tag.wrapping_add(i as u8));
            let ts = if hops_before_buy { buy_ts - 20_000_000_000 + (i as u64) * 1_000_000_000 } else { buy_ts + 1_000_000_000 + (i as u64) * 1_000_000_000 };
            self.chain.put(transfer_tx(&h, &pair[0], &pair[1], hop_yocto, ts));
            path.push(h);
        }
        let buy_hash = fake_tx(tag.wrapping_add(100));
        self.chain.put(buy_tx(&buy_hash, self.token.id().as_str(), self.market.id().as_str(), wallet.id().as_str(), 1_000_000 * UNIT, cost, buy_ts));
        path.push(buy_hash);
        Ok(path)
    }

    /// A creator-funded path of one hop that satisfies the rule for `wallet`.
    pub async fn honest_path(&self, wallet: &Account) -> Result<Vec<String>> {
        self.plant_path(wallet, &[], 10 * NEAR_Y, true, 1).await
    }

    // ----- the worker role -----

    async fn pending_request(&self) -> Result<(u64, Value)> {
        for _ in 0..200 {
            let ids: Vec<u64> = self.outlayer.view("get_pending_request_ids").args_json(json!({"from_index": null, "limit": null})).await?.json()?;
            if let Some(id) = ids.iter().max() {
                let req: Value = self.outlayer.view("get_request").args_json(json!({"request_id": id})).await?.json()?;
                return Ok((*id, req));
            }
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
        Err(anyhow!("no request reached the OutLayer contract"))
    }

    /// The request OutLayer is holding, as the worker would read it.
    pub async fn held_request(&self) -> Result<Value> {
        Ok(self.pending_request().await?.1)
    }

    fn answer(&self, input: &str, mode: &Mode) -> Result<Option<Value>> {
        let honest = |signer: &Enclave| run_checker(input, &self.chain, signer).map_err(|e| anyhow!("checker: {e}"));
        let req: Value = serde_json::from_str(input)?;
        let sign_facts = |signer: &Enclave, token: &str, wallet: &str, path_hash: &str, verdict: &str, block: u64| -> Value {
            let msg = customs_common::verdict_message(token, wallet, req["challenge_id"].as_u64().unwrap_or(0), path_hash, verdict, block);
            let sig = signer.sign(&msg).unwrap();
            json!({"token": token, "wallet": wallet, "challenge_id": req["challenge_id"], "path_hash": path_hash,
                   "verdict": verdict, "block": block, "sig": bs58::encode(sig).into_string()})
        };
        let s = |k: &str| req[k].as_str().unwrap_or_default().to_string();
        Ok(match mode {
            Mode::Silent => None,
            Mode::Fail => None,
            Mode::Honest => Some(honest(&self.enclave)?),
            Mode::OtherKey => Some(honest(&Enclave(OTHER_SEED))?),
            Mode::Force(v) => Some(sign_facts(&self.enclave, &s("token"), &s("wallet"), &s("path_hash"), v, req["block"].as_u64().unwrap())),
            Mode::BlockDelta(d) => {
                let b = (req["block"].as_u64().unwrap() as i64 + d) as u64;
                Some(sign_facts(&self.enclave, &s("token"), &s("wallet"), &s("path_hash"), "upheld", b))
            }
            Mode::OtherFacts(which) => {
                let (mut token, mut wallet, mut ph) = (s("token"), s("wallet"), s("path_hash"));
                match *which {
                    "wallet" => wallet = "someone-else.near".into(),
                    "token" => token = "other-token.near".into(),
                    _ => ph = hex(&Sha256::digest(b"another path")),
                }
                Some(sign_facts(&self.enclave, &token, &wallet, &ph, "upheld", req["block"].as_u64().unwrap()))
            }
        })
    }

    async fn resolve(&self, id: u64, output: Option<Value>) -> Result<()> {
        let response = match output {
            Some(o) => json!({"success": true, "output": {"Json": o}, "error": null,
                "resources_used": {"instructions": 1_000_000u64, "time_ms": 900u64, "compile_time_ms": null},
                "compilation_note": null, "refund_usd": null}),
            None => json!({"success": false, "output": null, "error": "run failed",
                "resources_used": {"instructions": 0u64, "time_ms": 10u64, "compile_time_ms": null},
                "compilation_note": null, "refund_usd": null}),
        };
        self.operator
            .call(self.outlayer.id(), "resolve_execution")
            .args_json(json!({"request_id": id, "response": response}))
            .gas(Gas::from_tgas(100))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    /// The worker role takes the request OutLayer is holding and answers it as `mode` says.
    pub async fn serve(&self, mode: &Mode) -> Result<()> {
        let (id, req) = self.pending_request().await?;
        match mode {
            Mode::Silent => Ok(()),
            _ => {
                let input = req["input_data"].as_str().context("request has no input_data")?.to_string();
                let out = self.answer(&input, mode)?;
                self.resolve(id, out).await
            }
        }
    }

    /// Moves the chain clock forward by at least `secs` seconds.
    pub async fn advance_s(&self, secs: u64) -> Result<()> {
        let target = self.worker.view_block().await?.timestamp() / 1_000_000_000 + secs;
        while self.worker.view_block().await?.timestamp() / 1_000_000_000 < target {
            self.worker.fast_forward(50).await?;
        }
        Ok(())
    }

    async fn finish(&self, tx: near_workspaces::operations::TransactionStatus, mode: &Mode) -> Result<ExecutionFinalResult> {
        if matches!(mode, Mode::Silent) {
            // nobody answers: the yield times out after 200 blocks and the callback runs with no result
            self.worker.fast_forward(215).await?;
        }
        let r = tx.await?;
        // refunds and the bond payout are receipts that land a block or two after the callback
        self.worker.fast_forward(4).await?;
        Ok(r)
    }

    /// Ask the token for its verdict key and have the worker role answer.
    pub async fn pin(&self, mode: &Mode) -> Result<ExecutionFinalResult> {
        let tx = self
            .hunter
            .call(self.token.id(), "pin_verdict_key")
            .deposit(self.knobs.exec_fee)
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        self.serve_pin(mode).await?;
        self.finish(tx, mode).await
    }

    async fn serve_pin(&self, mode: &Mode) -> Result<()> {
        let (id, req) = self.pending_request().await?;
        match mode {
            Mode::Silent => Ok(()),
            Mode::Fail => self.resolve(id, None).await,
            Mode::OtherKey => {
                let input = req["input_data"].as_str().context("input")?;
                // the key the module reports is another key than the one that signs the proof
                let mut out = run_checker(input, &self.chain, &Enclave(OTHER_SEED)).map_err(|e| anyhow!(e))?;
                out["public_key"] = json!(self.enclave.key());
                self.resolve(id, Some(out)).await
            }
            _ => {
                let input = req["input_data"].as_str().context("input")?;
                let out = run_checker(input, &self.chain, &self.enclave).map_err(|e| anyhow!(e))?;
                self.resolve(id, Some(out)).await
            }
        }
    }

    pub async fn challenge(&self, by: &Account, wallet: &Account, path: Vec<String>) -> Result<ExecutionFinalResult> {
        self.challenge_with(by, wallet, path, &Mode::Honest).await
    }

    pub async fn challenge_with(&self, by: &Account, wallet: &Account, path: Vec<String>, mode: &Mode) -> Result<ExecutionFinalResult> {
        let bond = self.knobs.min_bond;
        let deposit = NearToken::from_yoctonear(bond.as_yoctonear() + self.knobs.exec_fee.as_yoctonear());
        let tx = by
            .call(self.token.id(), "challenge")
            .args_json(json!({"wallet": wallet.id(), "path": path, "bond": bond.as_yoctonear().to_string()}))
            .deposit(deposit)
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        self.serve(mode).await?;
        self.finish(tx, mode).await
    }

    /// File a challenge and leave the request held, so a test can read it before anyone answers.
    pub async fn challenge_held(&self, by: &Account, wallet: &Account, path: Vec<String>) -> Result<near_workspaces::operations::TransactionStatus> {
        let bond = self.knobs.min_bond;
        let deposit = NearToken::from_yoctonear(bond.as_yoctonear() + self.knobs.exec_fee.as_yoctonear());
        Ok(by
            .call(self.token.id(), "challenge")
            .args_json(json!({"wallet": wallet.id(), "path": path, "bond": bond.as_yoctonear().to_string()}))
            .deposit(deposit)
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?)
    }

    pub async fn answer_held(&self, tx: near_workspaces::operations::TransactionStatus, mode: &Mode) -> Result<ExecutionFinalResult> {
        self.serve(mode).await?;
        self.finish(tx, mode).await
    }
}

pub fn failure_text(r: &ExecutionFinalResult) -> String {
    let mut s = String::new();
    for f in r.receipt_failures() {
        s.push_str(&format!("{:?}\n", f));
    }
    for o in r.outcomes() {
        if let Err(e) = o.clone().into_result() {
            s.push_str(&format!("{e:?}\n"));
        }
    }
    s
}

pub fn event_data(r: &ExecutionFinalResult, name: &str) -> Option<Value> {
    for l in r.logs() {
        if let Some(rest) = l.strip_prefix("EVENT_JSON:") {
            let v: Value = serde_json::from_str(rest).ok()?;
            if v["standard"] == "customs" && v["event"] == name {
                return Some(v["data"].clone());
            }
        }
    }
    None
}
