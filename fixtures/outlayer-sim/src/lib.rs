//! Sandbox stand-in for `outlayer.near`: same `request_execution` call shape, and it answers the
//! way the OutLayer worker does for a signing-key module, by returning the module's stdout JSON as the
//! call's result. It signs with a real ed25519 key so the token's `ed25519_verify` path runs for real.
//! The test chooses what the module would say; it never decides anything the token trusts.

use customs_common::{hex_lower, path_hash_input, verdict_message};
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Sim {
    seed: [u8; 32],
    verdict: String,
    block_delta: i64,
    behaviour: String,
    last_input: String,
    last_source: String,
    last_payer: Option<AccountId>,
    last_deposit: u128,
}

#[near]
impl Sim {
    #[init]
    pub fn new(seed_hex: String) -> Self {
        Self {
            seed: parse_seed(&seed_hex),
            verdict: "upheld".into(),
            block_delta: 0,
            behaviour: "answer".into(),
            last_input: String::new(),
            last_source: String::new(),
            last_payer: None,
            last_deposit: 0,
        }
    }

    /// verdict: upheld | rejected. behaviour: answer | silent (null output) | fail (the run errors) |
    /// wrong_hash | wrong_wallet | wrong_token (sign facts the request did not name).
    pub fn script(&mut self, verdict: String, behaviour: String, block_delta: i64) {
        self.verdict = verdict;
        self.behaviour = behaviour;
        self.block_delta = block_delta;
    }

    pub fn set_seed(&mut self, seed_hex: String) {
        self.seed = parse_seed(&seed_hex);
    }

    #[payable]
    pub fn request_execution(
        &mut self,
        source: Value,
        input_data: String,
        payer_account_id: Option<AccountId>,
    ) -> Value {
        self.last_input = input_data.clone();
        self.last_source = source.to_string();
        self.last_payer = payer_account_id;
        self.last_deposit = env::attached_deposit().as_yoctonear();
        match self.behaviour.as_str() {
            "fail" => env::panic_str("enclave run failed"),
            "silent" => return Value::Null,
            _ => {}
        }
        let req: Value = serde_json::from_str(&input_data).expect("input_data is json");
        let mut token = req["token"].as_str().unwrap().to_string();
        let mut wallet = req["wallet"].as_str().unwrap().to_string();
        let id = req["challenge_id"].as_u64().unwrap();
        let path: Vec<String> = req["path"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
        let mut path_hash = hex_lower(&env::sha256(&path_hash_input(&path)));
        require!(path_hash == req["path_hash"].as_str().unwrap(), "request path_hash does not match its path");
        match self.behaviour.as_str() {
            "wrong_hash" => path_hash = hex_lower(&env::sha256(b"another path")),
            "wrong_wallet" => wallet = "someone-else.near".into(),
            "wrong_token" => token = "other-token.near".into(),
            _ => {}
        }
        let block = (env::block_height() as i64 + self.block_delta) as u64;
        let msg = verdict_message(&token, &wallet, id, &path_hash, &self.verdict, block);
        let sig = SigningKey::from_bytes(&self.seed).sign(&msg).to_bytes();
        json!({
            "token": token, "wallet": wallet, "challenge_id": id, "path_hash": path_hash,
            "verdict": self.verdict, "block": block, "sig": near_sdk::bs58::encode(sig).into_string(),
        })
    }

    pub fn last_request(&self) -> Value {
        json!({
            "input": self.last_input, "source": self.last_source,
            "payer": self.last_payer, "deposit": self.last_deposit.to_string(),
        })
    }
}

fn parse_seed(hex: &str) -> [u8; 32] {
    require!(hex.len() == 64, "seed is 32 bytes of hex");
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).expect("hex");
    }
    out
}
