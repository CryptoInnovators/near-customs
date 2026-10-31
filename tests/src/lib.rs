//! Sandbox harness. Builds the real token wasm and the OutLayer stand-in, deploys them, and
//! gives tests a market, an insider, an outsider and a hunter. Every build is of the current
//! source, so a mutated guard is always the code under test.
use anyhow::{anyhow, Context, Result};
use ed25519_dalek::SigningKey;
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tokio::sync::OnceCell;

pub const UNIT: u128 = 1_000_000_000_000_000_000_000_000; // 1 token, 24 decimals
pub const SUPPLY: u128 = 1_000_000_000 * UNIT;
pub const SEED: [u8; 32] = [7u8; 32];
pub const OTHER_SEED: [u8; 32] = [9u8; 32];
pub const MODULE_SHA: &str = "6e41e0a8f1c3d6a51c2bb6c0b6fa5c8e1b2a1f3d4c5b6a79881726354433221f";

pub fn root_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
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

/// Rebuilds only when a source file is newer than the wasm, so a mutated guard is always the code under test.
fn build(dir: &str, file: &str) -> Result<Vec<u8>> {
    let root = root_dir();
    let out = root.join("target").join("sandbox-wasm");
    std::fs::create_dir_all(&out)?;
    let wasm_path = out.join(file);
    let built = std::fs::metadata(&wasm_path).and_then(|m| m.modified()).ok();
    let src = newest(&root.join(dir).join("src")).max(newest(&root.join(dir).join("Cargo.toml"))).max(newest(&root.join("crates/common/src")));
    if built.map(|b| b >= src).unwrap_or(false) {
        return std::fs::read(&wasm_path).with_context(|| format!("read {file}"));
    }

    let status = std::process::Command::new("cargo")
        .args(["near", "build", "non-reproducible-wasm", "--no-abi", "--out-dir"])
        .arg(&out)
        .current_dir(root.join(dir))
        .status()
        .with_context(|| format!("run cargo near build in {dir}"))?;
    if !status.success() {
        return Err(anyhow!("cargo near build failed in {dir}: {status}"));
    }
    std::fs::read(out.join(file)).with_context(|| format!("read {file}"))
}

pub struct Wasm {
    pub token: Vec<u8>,
    pub sim: Vec<u8>,
}

pub async fn wasm() -> &'static Wasm {
    static CELL: OnceCell<Wasm> = OnceCell::const_new();
    CELL.get_or_init(|| async {
        tokio::task::spawn_blocking(|| Wasm {
            token: build("contracts/token", "customs_token.wasm").expect("token builds"),
            sim: build("fixtures/outlayer-sim", "outlayer_sim.wasm").expect("sim builds"),
        })
        .await
        .unwrap()
    })
    .await
}

pub fn near(n: f64) -> NearToken {
    NearToken::from_yoctonear((n * 1e24) as u128)
}

pub fn verdict_pubkey(seed: &[u8; 32]) -> String {
    let vk = SigningKey::from_bytes(seed).verifying_key();
    format!("ed25519:{}", bs58::encode(vk.to_bytes()).into_string())
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
            max_hops: 4,
        }
    }
}

pub struct World {
    pub worker: Worker<Sandbox>,
    pub root: Account,
    pub token: Contract,
    pub sim: Contract,
    pub owner: Account,
    pub market: Account,
    pub creator: Account,
    pub insider: Account,
    pub outsider: Account,
    pub hunter: Account,
    pub knobs: Knobs,
}

impl World {
    pub async fn new() -> Result<World> {
        Self::with(Knobs::default()).await
    }

    pub async fn with(knobs: Knobs) -> Result<World> {
        let w = wasm().await;
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

        let sim_acc = mk("outlayer", 10.0).await?;
        let sim = sim_acc.deploy(&w.sim).await?.into_result()?;
        sim.call("new").args_json(json!({"seed_hex": hex(&SEED)})).transact().await?.into_result()?;

        let tok_acc = mk("customs", 30.0).await?;
        let token = tok_acc.deploy(&w.token).await?.into_result()?;
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
                    "outlayer_id": sim.id(),
                    "verdict_key": verdict_pubkey(&SEED),
                    "module_url": "https://example.invalid/customs-path-checker.wasm",
                    "module_sha256": MODULE_SHA,
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

        let world = World { worker, root, token, sim, owner, market, creator, insider, outsider, hunter, knobs };
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

    pub async fn script(&self, verdict: &str, behaviour: &str, block_delta: i64) -> Result<()> {
        self.sim
            .call("script")
            .args_json(json!({"verdict": verdict, "behaviour": behaviour, "block_delta": block_delta}))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn challenge(&self, by: &Account, wallet: &Account, path: Vec<String>) -> Result<ExecutionFinalResult> {
        let bond = self.knobs.min_bond;
        let deposit = NearToken::from_yoctonear(bond.as_yoctonear() + self.knobs.exec_fee.as_yoctonear());
        Ok(by
            .call(self.token.id(), "challenge")
            .args_json(json!({"wallet": wallet.id(), "path": path, "bond": bond.as_yoctonear().to_string()}))
            .deposit(deposit)
            .gas(Gas::from_tgas(300))
            .transact()
            .await?)
    }

    pub async fn challenge_state(&self, id: u64) -> Result<Value> {
        let v: Value = self.token.view("challenge_of").args_json(json!({"challenge_id": id})).await?.json()?;
        Ok(v["state"].clone())
    }

    pub async fn native(&self, who: &Account) -> Result<u128> {
        Ok(who.view_account().await?.balance.as_yoctonear())
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
