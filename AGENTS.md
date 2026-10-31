# Customs: commands

Rust workspace. Contract in `contracts/token`, evidence checker (OutLayer WASI) in `crates/checker`, funding-path rule and offline walker in `crates/walker`, wire format in `crates/common`, sandbox tests in `tests`.

- Everything: `scripts/check.sh` (tool check, token wasm, full test suite). Add `--mutate` to break each guard and expect red.
- Token wasm: `scripts/build-token.sh` (prints the sha256).
- Tests only: `cargo test --workspace` (sandbox tests download the near sandbox binary and read the deployed OutLayer code from mainnet once, read only).
- One mutation: `scripts/mutate.sh hold_balance_level`.
- Real-data replay: `cargo run --release -p customs-walker -- replay --token T.nearlytrade.near --creator C.near --placebo-creator X.near`.
- Positive control on real data: `cargo run --release -p customs-walker -- control --creator C.near`.
- Check one printed path: `cargo run --release -p customs-walker -- check-path --token T --creator C --wallet W --buy-tx H --path h1,h2`.

No secret is read or needed. The walker reads FastNEAR's public transaction API and caches responses under `.walker-cache`.
