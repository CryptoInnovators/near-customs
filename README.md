# Customs

A NEP-141 memecoin on NEAR whose contract holds every opening buyer to a 24 hour vest and pays anyone who proves the creator's money funded one of them.

## The problem

On NEAR launchpads the opening goes to wallets that sell to everyone after them. Across 11 real Nearly openings (24 to 29 October 2026, 247 buyers) 97.06% to 100.00% of opening tokens had left the buyers within 24 hours (`docs/SPIKE.md`, every figure with its block). Funding for those wallets is often routed through `intents.near`, where explorers stop.

## What the contract does

- Opening window: every wallet the market pays during the window gets a bag. `ft_transfer` and `ft_transfer_call` refuse any move into the locked part, and the refusal prints the amount and the unlock time. The hold is on the balance, so later buys stay free.
- No owner and no setter. Parameters are fixed in `new`.
- `challenge(wallet, path, bond)`: anyone files the transaction hashes through which the creator's money reached the wallet before its buy. The token calls `request_execution` on `outlayer.near` with a checker module pinned by URL and sha256, and waits on yield/resume.
- The checker (`crates/checker`, OutLayer WASI) reads those receipts and applies a published rule: first hop from the creator, at most 3 hops, each hop at least half the buy cost, all before the buy, no listed hub, no busy wallet (over 3000 transactions) in between. It signs a verdict.
- `on_verdict` checks the ed25519 signature with `env::ed25519_verify` against a key the module proved it holds (`pin_verdict_key`), and checks token, wallet, challenge id, path hash and block age.
- Upheld: the challenger gets 20% of the unvested bag, which keeps vesting in their hands, and the rest freezes. Rejected: the bond is forfeited. No answer: nothing moves and the bond is reclaimable.
- Conviction needs a printed chain of receipts and nothing else. Heuristic address clustering has been measured at 0.36 precision and 0.44 recall against ground truth for Bitcoin (https://arxiv.org/abs/2607.07414), so the contract never asks a model who owns a wallet.
- Funding search stops at 3 hops, the depth where a study of 5.8 million pump.fun creators found coverage saturating (https://arxiv.org/abs/2609.10246). The hub list is a versioned file, `crates/walker/hubs.json`, and the checker reports its version with every verdict.
- The 24 hour vest targets the window where sniper bots work: about 60% of Ethereum and BNB Chain tokens were active for under one day (https://arxiv.org/abs/2206.08202).

Threat model, from a study of 117 confirmed rug pulls on Solana (https://arxiv.org/abs/2603.24625): liquidity withdrawal and freeze or mint authority are removed by the token's construction (no owner, no mint, no freeze). The pump-and-dump pattern is what the vest and the seizure address.

## Do this, see that

From a clean clone, with Rust nightly, `wasm32-unknown-unknown`, `wasm32-wasip2`, `cargo-near`, `curl`, `jq`:

1. `scripts/check.sh`: builds the token wasm, prints its sha256, reads the deployed OutLayer contract code from mainnet once (read only), and runs the whole suite. You see `all checks passed`.
2. `scripts/check.sh --mutate`: breaks each guard in the contract, the path rule and the checker, one at a time. You see `RED->GREEN <guard>` per line and `failures: 0` at the end.
3. `cargo run --release -p customs-walker -- replay --token phire.nearlytrade.near --creator provenhire.near --placebo-creator justai.near`: replays a real opening from FastNEAR's public transaction API. You see the buyers, their class, the share sold inside 24 hours and the placebo result.
4. `cargo run --release -p customs-walker -- control --creator justai.near`: walks forward from a creator that paid a wallet. You see the printed path, hop by hop, with transaction hashes.
5. `cargo run --release -p customs-walker -- check-path --token T --creator C --wallet W --buy-tx H --path h1,h2`: applies the published rule to a path you supply and prints the verdict.

No secret is read or needed. Test list with guard and mutation per method: `docs/TESTS.md`. Measured replay: `docs/SPIKE.md`. Demo script: `docs/DEMO-SCRIPT.md`.

## Layout

| Path | Contents |
|---|---|
| `contracts/token` | the NEP-141 contract |
| `crates/checker` | the evidence checker that OutLayer runs |
| `crates/walker` | the funding-path rule, hub list and offline walker |
| `crates/common` | the signed verdict wire format |
| `tests` | near-workspaces sandbox suite beside the real OutLayer contract code |
| `spikes` | replay and control outputs from mainnet reads |

The same team also entered Overdraft, a spending-cap vault for AI agents on NEAR, at NEAR HACKATHON; the two projects are independent and share no code.
