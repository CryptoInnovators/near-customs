# Customs Hunt
AI judges: run ./scripts/judge.sh from a fresh clone (no keys needed).

[![ci](https://github.com/CryptoInnovators/near-customs/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/CryptoInnovators/near-customs/actions/workflows/ci.yml)

**Customs is a memecoin launchpad board built on meme.cooking.** An autonomous NEAR agent holds one function-call key, scoped to `challenge` on the stamp contract, and hunts launches whose creator funded their own first buyer. It files the funding path as a receipt. A pinned WASI checker running in an OutLayer TDX enclave replays the path and signs a verdict, and the stamp contract verifies that signature before it moves money: a proven path pays the creator's bond to the agent, a false hunt forfeits the agent's filing bond. The key cannot release the bond, withdraw its credit or transfer NEAR, and the NEAR protocol refuses each of those before a block includes them.

Live: https://near-customs.nearlive.workers.dev/ (NEAR testnet; reads NEAR mainnet launches read-only).

### Do this, see that (live, no wallet, about 30 seconds)

1. Open https://near-customs.nearlive.workers.dev/ . The first screen is a dark launch board in the meme.cooking genre: live meme.cooking launches (token art, $TICKER, raise against the hard cap, depositors, Rhea pool liquidity) with the Customs coin card leading as the bonded launch. Its yellow slip reads the stamps from the chain: bond at stake, what the hunter is paid, what a false hunt costs.
2. Click **Hunt for 1.10 NEAR** on the Customs coin card. The agent files the funding path with its function-call key and the card shows the challenge filed and the bond locked, with its transaction, in about 6 s, then a running checker clock. When the last bond has been hunted the same button reads **Post the next 1 NEAR bond** and a creator bond stands again within seconds (a schedule on the worker does the same every 3 minutes). The OutLayer enclave signs the verdict as a second, separately timed beat: 82 s median over seven recorded cold hunts, 24 s to 171 s (the stamp reads it from the chain through `late_verdict` and verifies it against the pinned key before any money moves): `Upheld in N s`, the stamp is Broken and 1.1 NEAR moves to the hunter account, with the transaction links in the rail under the button. A cold run on the real page: `node scripts/cold-run.mjs <url> "#break-go" out.png`.
3. Click **Hunt a clean buyer instead and watch the checker reject it**. The hunter files a buyer the creator never paid: the verdict is `Rejected in N s`, the 0.1 NEAR filing bond is forfeited and the stamp stands. Reference run: https://testnet.nearblocks.io/txns/4cYWnGFvTifba7ppwddVAUVYQZ3rTPnm9MxjLTDpsM7M .
4. Click **Open the token** on the card (or any launch card's **Open**). The token view shows the insider path (creator, wallet the creator paid, the opening buy), the opening buyers table with receipt links and a `Creator-funded` or `clean` result per buyer, the hunt log and the other stamps. Every meme.cooking card traces its first openers the same way and says whether the creator's own money reached one of them.
5. Type a $TICKER, name or creator into the board search to find any launch on the board, and use the **Bonded** and **Cooked** filters to split the Customs coin from the meme.cooking launches.

Every transaction above is recorded with its checks in `docs/EVIDENCE.md` (`node scripts/stamp-live.mjs` reproduces them; `node scripts/cold-run.mjs <url> "#break-go" out.png` drives the real page to the contract's verdict).

The Customs token below is the same bond logic built into a NEP-141 memecoin: its contract holds every opening buyer to a 24 hour vest and pays anyone who proves the creator's money funded one of them. A static page (`web/`) reads any Nearly launch live from mainnet and shows which opening buyers the creator's money reached.

Built for NEAR HACKATHON in the memecoins and security tracks. The build window opened 2026-10-19 (Q-001); the first commit in this repository is dated 2026-10-31 and every commit is inside the window.

## The problem

On NEAR launchpads the opening goes to wallets that sell to everyone after them. Across 11 real Nearly openings (24 to 29 October 2026, 247 buyers) 97.06% to 100.00% of opening tokens had left the buyers within 24 hours (`docs/SPIKE.md`, every figure with its block). Funding for those wallets is often routed through `intents.near`, where explorers stop.

## What the contract does

- Opening window: every wallet the market pays during the window gets a bag. `ft_transfer` and `ft_transfer_call` refuse any move into the locked part, and the refusal prints the amount and the unlock time. The hold is on the balance, so later buys stay free.
- The market pays opening buyers with `ft_transfer`: 238 of 238 first-buy transactions across the 11 replayed launches were paid that way by `dclv2.ref-labs.near` (`spikes/replay/payout-method.json`).
- No setter. Parameters are fixed in `new`, and `new` accepts only the published judge: the OutLayer contract id and the checker module sha256 are constants in the contract, so the token's code hash attests to who judges. The creator is the account that holds the supply (`creator_id == owner_id`), and the token account initializes itself in the transaction that deploys it.
- `open_trading(start_s)`: the creator announces the opening once, at least `notice_s` ahead and only once the market already holds `min_pool_bps` of the supply. The window and the vest are measured from that announced start, the market cannot pay anyone before it, and until the window closes the creator can move tokens only to the market. A quiet first sale in an empty pool starts nothing, and a pool funded after the window cannot have been the announced one.
- `challenge(wallet, path, bond)`: anyone files the transaction hashes through which the creator's money reached the wallet before its buy. The token calls `request_execution` on `outlayer.near` with a checker module pinned by URL and sha256, and waits on yield/resume.
- The checker (`crates/checker`, OutLayer WASI) reads those receipts and applies a published rule: first hop from the creator, at most 3 hops, each hop at least half the buy cost, all before the buy, no listed hub, no busy wallet (over 3000 transactions) in between. It signs a verdict. A hop is native NEAR (a `Transfer` action or a `FunctionCall` deposit), wNEAR moved by `wrap.near` `ft_transfer`, an Intents `dip4 native_withdraw` (which names the owner behind an Intents payout) or an Intents `dip4 transfer` of wNEAR. Funding split over up to four transactions per hop is added up into one hop, so cutting a payment into thirds does not hide it.
- `on_verdict` checks the ed25519 signature with `env::ed25519_verify` against a key the module proved it holds (`pin_verdict_key`), and checks token, wallet, challenge id, path hash and block age.
- Upheld: the challenger gets 20% of the unvested bag, which keeps vesting in their hands, and the rest freezes. Rejected: the bond is forfeited. No usable answer (the enclave stays silent, the checker cannot read a transaction, a signature or a block does not match, the challenger left the token): the callback never panics on the content of an answer, the challenge closes as `Unanswered`, the wallet can be challenged again in the same block, and the bond is reclaimable by the challenger. A pending challenge older than `reclaim_blocks` is cleared by anyone with `clear_stale`.
- Conviction needs a printed chain of receipts and nothing else. Heuristic address clustering has been measured at 0.36 precision and 0.44 recall against ground truth for Bitcoin (https://arxiv.org/abs/2607.07414), so the contract never asks a model who owns a wallet. Sharing one access key is not used either: the one shared key found in the 11 launches is a `FunctionCall` key limited to `aa-harvest-moon.near` on both accounts, which proves no control (`spikes/replay/key-check.json`).
- Funding search stops at 3 hops, the depth where a study of 5.8 million pump.fun creators found coverage saturating (https://arxiv.org/abs/2609.10246). The hub list is a versioned file, `crates/walker/hubs.json`, and the checker reports its version with every verdict.
- The 24 hour vest targets the window where sniper bots work: about 60% of Ethereum and BNB Chain tokens were active for under one day (https://arxiv.org/abs/2206.08202).

Threat model, from a study of 117 confirmed rug pulls on Solana (https://arxiv.org/abs/2603.24625): mint and freeze authority are removed by the token's construction (no mint, no freeze, no setter). The pump-and-dump pattern is what the vest and the seizure address.

## Do this, see that

Prerequisites for a clean clone: Rust stable via `rustup` (the repo's `rust-toolchain.toml` adds `wasm32-unknown-unknown` and `wasm32-wasip2`), `cargo-near` 0.16.0, `curl`, `jq`, `shasum`, `python3`, `node` 18 or newer (page tests). No secret is read or needed.

1. Open the demo page. `python3 -m http.server 8080 --directory web`, then browse to port 8080 on your machine. You see "Who paid for the first buyers?", then a "This is a Customs coin" panel for `customs26-token.testnet` with four `pass` checks (judge `outlayer.testnet`, checker sha256 re-hashed in your browser, verdict key pinned, 0 access keys), two opening bags (`seized, remainder frozen` and `vested`) and an `Upheld` and a `Rejected` challenge with their transaction links, then within about 30 seconds a verdict band reading `8.2%` for `phire.nearlytrade.near`: 1 of 24 opening buyers received creator money (the creator's own wallet, `provenhire.near`), 23 wallets with no creator link, 0 not checked, and a ledger of the 24 buyers with a balance read at a final block that the page prints. Details in "The demo page" below.
2. `python3 spikes/table.py`: prints the replay table for all 11 launches. You see a row per launch, for example `phire.nearlytrade.near | 10-29 13:20 | 24 | 100.00% | 8.18% | 0.00% / 0.00% / 0.00% | 0 | 0 of 23 | 222392004`, and `buyers 247, placebo wallets tested 226` at the end.
3. `scripts/check.sh`: builds the token wasm and prints its sha256, rebuilds the checker module (on x86_64 Linux, as CI does) and fails unless its sha256 equals the one compiled into the contract, reads the deployed OutLayer contract code from mainnet once (read only) and checks its code hash, then runs `cargo test --workspace`. You see `test result: ok. 47 passed` for the sandbox suite, 11 passed for the token unit tests, 27 passed for the rule and receipt tests, and `all checks passed`. GitHub Actions runs the same command on every push to `main` (badge above).
4. `scripts/check.sh --mutate`: breaks each guard in the contract, the path rule and the checker, one at a time. You see `RED->GREEN <guard>` per line and `failures: 0` at the end. `scripts/mutate.sh intents_owner_decode` runs one.
5. `cargo run --release -p customs-walker -- replay --token phire.nearlytrade.near --creator provenhire.near --placebo-creator justai.near`: replays a real opening from FastNEAR's public transaction API. You see the buyers, their class, the share sold inside 24 hours and the placebo result.
6. `cargo run --release -p customs-walker -- control --creator justai.near`: walks forward from a creator that paid a wallet. You see the printed path, hop by hop, with transaction hashes.
7. `cargo run --release -p customs-walker -- check-path --token T --creator C --wallet W --buy-tx H --path h1,h2`: applies the published rule to a path you supply and prints the verdict.
8. `python3 spikes/serial.py`: lists every wallet that bought 3 or more of the 11 openings. You see `wrapz-z.near`, `tyty.sendler-b.near` and two implicit accounts at `11 of 11`, `alola.near` at `10 of 11`, and `31 of 96 distinct opening buyers bought 3 or more of the 11 openings` at the end.
9. `python3 spikes/payout_method.py spikes/replay/phire.json`: reads the 23 first-buy transactions from FastNEAR and counts the method the market called on the token. You see `phire.nearlytrade.near 23 {'ft_transfer': 23} control 23`; the control counts buys whose own call was `ft_transfer_call`, which proves the parser tells the two apart.
10. `scripts/testnet-live.sh`: reads the live testnet token over `https://test.rpc.fastnear.com`. You see five `PASS` lines (code hash equals the built wasm, no access keys, verdict stored, seized amount recomputed to the yoctoNEAR, judge pinned) and `testnet-live: 5 passed, 0 failed`. Any wrong value, for example `SEIZE_BPS=1000 scripts/testnet-live.sh`, prints `FAIL` and exits 1.

Test list with the guard and the mutation for each method: `docs/TESTS.md`. Every replayed figure with its RPC and block: `docs/EVIDENCE.md` and `docs/SPIKE.md`. Demo script: `docs/DEMO-SCRIPT.md`.

## Add the bot

Install and launch the Telegram bot from the repository root:

```sh
cd bot
npm install
export TELEGRAM_BOT_TOKEN="your-token-from-BotFather"
npm start
```

If `TELEGRAM_BOT_TOKEN` is unset or empty, the bot prints `TELEGRAM_BOT_TOKEN is required.` and exits with status 1. Once it is running, send `/start` to the bot for its command guide. Use `/check <token.near>` to inspect a Nearly launch, for example `/check phire.nearlytrade.near`. The live testnet Customs token is `customs26-token.testnet`; it is documented below and can also be queried with `/check customs26-token.testnet`.

## Live on NEAR testnet

`customs26-token.testnet` is the Customs contract running against Rhea's DCL pool and the live OutLayer testnet worker. A stranger checks it with one command, `scripts/testnet-live.sh`, which holds the ids in `scripts/testnet-live.env`.

| Piece | Value |
|---|---|
| Token | `customs26-token.testnet`, code hash sha256 `af6b07b5aeab7370c58ee27eff0a9f592944d1a8a4025a09542efd639234e8d3`, no access keys (key deleted in `2ng9Ap3hzzvLFvF2eAP6pUoE47zhmdovehtsWNQCnVeu`), public copy of the wasm on FastFS |
| Judge | `outlayer.testnet` runs the checker module from FastFS: `https://customs26-creator.testnet.fastfs.io/outlayer.testnet/fc72c7b662fc48ca497c9582a0b1aa8271e051d132283a9645cd5395b485f975.wasm`, the sha256 that CI builds and the contract pins. Verdict key `ed25519:4hHQEcVQRrSHEECe2YJTqj6sCZbT6tCf4UxyuZ4Ye8u1`, pinned in `CjjFRY83Dy1gQNSDzV5VdoaA1EnbrU8iRL9SveTT8aL2` |
| Market | `dclv2.ref-dev.testnet`, pool `customs26-token.testnet\|wrap.testnet\|2000` seeded by the creator with half the supply (`J5whpdMYhZufbCC6B5C87uVTVLwYEH1UyMT157C4QRZz`, `4SZst6skBFChBb6rRR4se1PfEeiiT3iHAfYrZVHSQUhX`); trading announced with `38xS6MT4mexj9BoUGu8bSVs28mye3z1aiiF3fUhxPSjJ` |
| Opening | `customs26-buyer1.testnet` (the creator sent it 1 NEAR in `23atwS3gdX11c1r7o3UBZK1w7UAuskk7VofmoaZiP5HU`) and `customs26-buyer2.testnet` (no creator money) each swap 0.5 wNEAR for 4976.04 tokens through the pool: `75sREratSM2pa3iGJBx61hbwPSx3Wfa8bseN3g6CmR2T`, `GuTXDmdNSsSosDHgjHJLLxgQH1VwXR1Z5jSfxy1TThV5` |
| Challenge 0, upheld | `customs26-hunter.testnet` files `3Nr9SzTP8jBpZxTwV9W9hPfd2KMjfSsYqPBGyru3RuVN` against buyer1. OutLayer yields, the enclave signs, `on_verdict` seizes 994.41 tokens (20% of the 4972.07 unvested) and freezes the other 3977.66 for 30 days. `challenge_of(0)` reads `Upheld`, `opening_of(buyer1)` reads `seized_frozen` |
| Challenge 1, rejected | `FVbjGgwXwyGAVkqR8JMLXKLyvRuGgZ65QLTBp2vJ1ECq` against buyer2: a path whose creator hop reaches another wallet. `challenge_of(1)` reads `Rejected`, the 0.5 NEAR bond is forfeited |

## The demo page

`web/` is a static page: `index.html`, `app.js`, `style.css`, no build step and no package. It reads NEAR from the browser at page load (the testnet coin panel and mainnet launches) and stores nothing on a server (receipts are cached in the browser's `localStorage` for 30 minutes).

Open it with `python3 -m http.server 8080 --directory web` and browse to port 8080. Pick another launch with `?token=<token account>&creator=<account>` in the address, or use the two fields on the page. The defaults are `phire.nearlytrade.near` and `provenhire.near`. Point the Customs panel at another coin with `?coin=<account>` (add `&network=mainnet` for a mainnet one); an account without `customs_params` is shown as not a Customs token, with nothing green.

| Panel | What it shows | Endpoint it reads |
|---|---|---|
| Masthead and rule line | The question, the form, and the published rule in one sentence | none |
| This is a Customs coin | Four checks of a deployed Customs token against the values published in its source (judge contract, checker module sha256 hashed in the browser from the token's module URL, pinned verdict key, access keys on the account), the window, the opening bags from `opening_of` and every challenge from `challenge_of` with the filing and verdict transactions | `call_function` views and `view_access_key_list` on `https://test.rpc.fastnear.com`, `POST https://tx.test.fastnear.com/v0/account` and `/v0/transactions`, the module URL on FastFS |
| Verdict | Share of opening tokens bought by wallets the creator's money reached, the count of linked, unlinked and unchecked wallets | `POST https://tx.main.fastnear.com/v0/account` and `/v0/transactions` for the token's first day |
| The opening buyers | One row per wallet the market paid inside the first 600 s: tokens received, balance now, wNEAR paid, share sold within 24 hours, first buy block, the funding path with a nearblocks link per hop | `POST https://tx.main.fastnear.com/v0/transactions` for receipts and wrap.near transfer logs, `POST https://rpc.mainnet.fastnear.com` with `query` `call_function` for `ft_metadata` and `ft_balance_of` at the final block it prints |
| How the check ran | Market, window, first-sale block, receipt count, request budget, the block the balances were read at | the same two hosts |

The page traces up to 32 priced buyers per launch within 300 account pages and 150 receipt batches, and retries a refused, rate-limited or 5xx call up to three times before it reports the endpoint's error. When a call fails the page prints the endpoint's own error text and the next step; an unknown token says so instead of drawing an empty ledger. Every account and hash links to nearblocks.io.

## Where NEAR is used

| NEAR piece | Role | Network | Where |
|---|---|---|---|
| NEP-141 contract (near-sdk 5.30, near-contract-standards) | Holds the vest. `on_outbound` runs before every `ft_transfer` and `ft_transfer_call` | sandbox in tests, mainnet reads in replay | `contracts/token/src/lib.rs:642` |
| OutLayer (`outlayer.near`) with yield/resume | `challenge` calls `request_execution` with the checker wasm URL and sha256; the challenge waits until the enclave answers | contract code read from mainnet at block 222386104 and run in the sandbox | `contracts/token/src/lib.rs:256`, `:537` |
| `env::ed25519_verify` | `pin_verdict_key` pins a key the module proved it holds; `on_verdict` accepts only that key | sandbox | `lib.rs:401`, `:611` |
| NEAR Intents `dip4 native_withdraw` | Read as evidence: names the owner account behind an Intents payout | mainnet transaction fixture `crates/walker/tests/fixtures/intents-withdraw-hx23fz.json` | `crates/walker/src/receipts.rs:141` |
| Ref Finance DCL pool (`dclv2.ref-labs.near`) | The market whose payouts open a bag | mainnet reads | `lib.rs:642`, `spikes/replay/payout-method.json` |
| FastNEAR transaction API and RPC | Receipts, balances and access keys for the walker, the checker and the demo page | mainnet | `crates/walker`, `crates/checker/src/main.rs`, `web/app.js` |
| OutLayer testnet (`outlayer.testnet`) with FastFS | Runs the checker module for the live testnet token; the module is fetched by URL and sha256 from FastFS | testnet, `customs26-token.testnet` challenges 0 and 1 | `scripts/testnet-live.sh`, `scripts/testnet-live.env` |
| Rhea DCL pool (`dclv2.ref-dev.testnet`) | The market for the testnet token; its swap pays buyers with `ft_transfer` | testnet | `scripts/testnet-live.env` |
| WASI checker on OutLayer | Applies the path rule inside the enclave; manifest allows only `tx.main.fastnear.com` | built for `wasm32-wasip2` | `crates/checker`, `crates/checker/manifest.json` |

## Libraries and baseline

Everything in this repository was written during the window. Third-party code: `near-sdk` 5.30.0, `near-contract-standards` 5.30.0, `near-workspaces` 0.24.0 (sandbox tests), `tokio`, `serde`, `serde_json`, `sha2`, `bs58`, `ed25519-dalek` 2, `wit-bindgen` 0.36 and `wasi-http-client` 0.2 (checker), `cargo-near` 0.16.0 (token build). The `outlayer.near` contract code is not ours: `scripts/fetch-outlayer.sh` reads it from mainnet at block 222386104 and checks its code hash (`5waWVnt6g3FZfjR6vfYXZzpAi3sZdFy8cK2sLz4EJQDt`) and sha256 before the sandbox uses it.

Test fixtures: the sandbox harness in `tests/` plays only the enclave worker, with a fixed ed25519 seed, against the real `outlayer.near` contract code; its `module_url` is a test value. `crates/walker/tests/fixtures/` holds an unedited mainnet transaction. Replay outputs in `spikes/` are saved mainnet reads.

## Layout

| Path | Contents |
|---|---|
| `contracts/token` | the NEP-141 contract |
| `crates/checker` | the evidence checker that OutLayer runs |
| `crates/walker` | the funding-path rule, hub list and offline walker |
| `crates/common` | the signed verdict wire format |
| `tests` | near-workspaces sandbox suite beside the real OutLayer contract code |
| `web` | the live-data demo page |
| `spikes` | replay and control outputs from mainnet reads, with the scripts that produced them |
| `gtm/customs` | named users, demand and edge sources; outreach drafts in `docs/OUTREACH.md` |

The same team also entered Overdraft (https://github.com/kamalbuilds/near-overdraft), a NEAR vault that caps what an AI agent can spend, at NEAR HACKATHON; the two projects are independent and share no code.
