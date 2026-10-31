//! OutLayer WASI entry: JSON request on stdin, JSON answer on stdout. The key never leaves the host.

#[cfg(target_arch = "wasm32")]
mod host {
    wit_bindgen::generate!({ world: "signing-keys-host", path: "wit" });
}

/// Embedded as the `outlayer.manifest` custom section, so the declared key is covered by the module's sha256.
#[cfg(target_arch = "wasm32")]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest.json").len()] = *include_bytes!("../manifest.json");

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::host::outlayer::signing_keys::api as keys;
    use customs_checker::{run, Signer, TxSource};
    use customs_walker::receipts::{parse_tx, Tx};
    use serde_json::json;
    use std::io::Read;
    use std::time::Duration;

    const KEY_PATH: &str = "verdict";
    const TX_API: &str = "https://tx.main.fastnear.com/v0/transactions";
    const ACCOUNT_API: &str = "https://tx.main.fastnear.com/v0/account";

    struct HostSigner;
    impl Signer for HostSigner {
        fn public_key(&self) -> Result<[u8; 32], String> {
            keys::public_key(KEY_PATH, None)?.try_into().map_err(|_| "host key is not 32 bytes".to_string())
        }
        fn sign(&self, message: &[u8]) -> Result<[u8; 64], String> {
            keys::sign(KEY_PATH, None, message)?.try_into().map_err(|_| "host signature is not 64 bytes".to_string())
        }
    }

    struct FastNear;
    impl TxSource for FastNear {
        fn txs(&self, hashes: &[String]) -> Result<Vec<Tx>, String> {
            let body = json!({ "tx_hashes": hashes }).to_string();
            let resp = wasi_http_client::Client::new()
                .post(TX_API)
                .header("Content-Type", "application/json")
                .connect_timeout(Duration::from_secs(15))
                .body(body.as_bytes())
                .send()
                .map_err(|e| format!("tx api: {e}"))?;
            if resp.status() != 200 {
                return Err(format!("tx api status {}", resp.status()));
            }
            let v: serde_json::Value = serde_json::from_slice(&resp.body().map_err(|e| format!("tx api body: {e}"))?)
                .map_err(|e| format!("tx api json: {e}"))?;
            Ok(v["transactions"].as_array().map(|a| a.iter().map(parse_tx).collect()).unwrap_or_default())
        }

        fn tx_count(&self, account: &str) -> Result<u64, String> {
            let body = json!({ "account_id": account, "limit": 1 }).to_string();
            let resp = wasi_http_client::Client::new()
                .post(ACCOUNT_API)
                .header("Content-Type", "application/json")
                .connect_timeout(Duration::from_secs(15))
                .body(body.as_bytes())
                .send()
                .map_err(|e| format!("account api: {e}"))?;
            if resp.status() != 200 {
                return Err(format!("account api status {}", resp.status()));
            }
            let v: serde_json::Value = serde_json::from_slice(&resp.body().map_err(|e| format!("account api body: {e}"))?)
                .map_err(|e| format!("account api json: {e}"))?;
            v["txs_count"].as_u64().ok_or_else(|| "account api returned no txs_count".to_string())
        }
    }

    pub fn main() {
        let mut input = String::new();
        if std::io::stdin().read_to_string(&mut input).is_err() {
            std::process::exit(2);
        }
        match run(&input, &FastNear, &HostSigner) {
            Ok(v) => println!("{v}"),
            Err(e) => {
                eprintln!("customs-checker: {e}");
                std::process::exit(1);
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
fn main() {
    wasm::main()
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    eprintln!("customs-checker runs inside OutLayer: cargo build -p customs-checker --target wasm32-wasip2 --release");
    std::process::exit(2);
}
