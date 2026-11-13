# Evidence

Every figure in the README and `docs/SPIKE.md`, with the command that produces it and the source it reads. All reads are public and unsigned. Replay outputs are saved in `spikes/replay/` so each row can be checked without re-running the network calls.

| Figure | Value | Command | Source and block |
|---|---|---|---|
| Opening tokens sold within 24 h | 97.06% to 100.00% on each of 11 launches, 8 of 11 at 100.00% | `python3 spikes/table.py` | FastNEAR transaction API (`tx.main.fastnear.com`), replay head blocks 222392004 to 222393667, one per row of the table |
| Opening buyers replayed | 247 (12 to 32 per launch) | `python3 spikes/table.py` | same |
| Creator-linked share at 1, 2 and 3 hops | 0.00% on every launch | `python3 spikes/table.py` | same |
| Placebo creator linked | 0 of 226 wallets | `python3 spikes/table.py` | same |
| Opening wallets holding zero tokens | 244 of 247 | `python3 spikes/balances.py 222392783 spikes/replay/*.json` | `archival-rpc.mainnet.fastnear.com` `call_function` `ft_balance_of`, block 222392783 (`spikes/replay/balance-check.json`) |
| Wallets that bought 3 or more openings | 31 of 96 distinct opening buyers; 4 bought all 11 (`wrapz-z.near`, `tyty.sendler-b.near`, `976b2ad5...3fe8`, `b4adf54a...0486`), `alola.near` 10, `c8bde0e9...1899` 9 | `python3 spikes/serial.py` | the 11 replay files in `spikes/replay/`, head blocks 222392004 to 222393667 |
| Wallets that share a FullAccess key with their launch's creator | 0 of 235 readable buyer wallets (236 checked outside the creators, 1 answered HTTP 429) | `python3 spikes/keys.py 222392783 spikes/replay/*.json` | `archival-rpc.mainnet.fastnear.com` `view_access_key_list`, block 222392783 (`spikes/replay/key-check.json`) |
| Method the market uses to pay an opening buyer | `ft_transfer` in 238 of 238 first-buy transactions, `ft_transfer_call` in 0 | `python3 spikes/payout_method.py spikes/replay/*.json` | FastNEAR transaction API, read 2026-11-01 (`spikes/replay/payout-method.json`); the same parser sees `ft_transfer_call` in 226 buyers' own `wrap.near` calls |
| Intents withdrawal names the owner | 15 NEAR from `d9eade23...325a` to `c8bde0e9...1899` | `cargo test -p customs-walker --lib real_intents` | mainnet transaction Hx23FZyuBYeL7C2YuuSisSPBMdKkXdFu3BkhHZhNDUX6, block 219230633, saved unedited in `crates/walker/tests/fixtures/intents-withdraw-hx23fz.json` |
| OutLayer contract code under test | code hash `AsbxRWTQ2mQAazgz1bbAC72oZ1H8UKL33JKwZmG2pjn2`, sha256 `92afbf4687f12d419e8ba735edc6a68e3899722855dc556633f58fe3332591e3` | `scripts/fetch-outlayer.sh` | `archival-rpc.mainnet.fastnear.com` `view_code` for `outlayer.near`, block 224396427 |
| Demo page balance read | block printed on the page, 222,530,141 at the first read on 2026-11-01 | open `web/` and read the "How the check ran" panel | `rpc.mainnet.fastnear.com` `call_function` `ft_balance_of` at the final block it reports |
| Live testnet token code and keys | code hash sha256 `af6b07b5...e8d3` equals the built wasm and its FastFS copy; `view_access_key_list` returns no keys | `scripts/testnet-live.sh` (checks `code_hash`, `no_access_keys`) | `test.rpc.fastnear.com`, `view_account` and `view_access_key_list` for `customs26-token.testnet`, finality final |
| Live testnet verdicts | `customs_params`: `outlayer.testnet`, `dclv2.ref-dev.testnet`, `customs26-creator.testnet`, 86,400-second vest, 2,000 bps seizure; challenge 0 `Upheld` for `customs26-buyer1.testnet` with 994413985995229504683186338 seized and path `23atwS3gdX11c1r7o3UBZK1w7UAuskk7VofmoaZiP5HU` -> `75sREratSM2pa3iGJBx61hbwPSx3Wfa8bseN3g6CmR2T`; challenge 1 `Rejected` for `customs26-buyer2.testnet`; verdict key `ed25519:4hHQ...Ye8u1` | `scripts/testnet-live.sh` and `node bot/test/live-check.mjs` | final `customs_params`, `challenge_of` and `verdict_key` views; verified filing transactions `3Nr9SzTP8jBpZxTwV9W9hPfd2KMjfSsYqPBGyru3RuVN`, `FVbjGgwXwyGAVkqR8JMLXKLyvRuGgZ65QLTBp2vJ1ECq` |
| Live testnet seizure | 994413985995229504683186338 raw of 4972069929976147523415931693 unvested (20%), frozen 3977655943980918018732745355 | `scripts/testnet-live.sh` (check `seized_amount`) | recomputed from `opening_of`, `window`, `customs_params` and the timestamp (1793777885 s) of the block that carried the `wallet_seized` receipt |
| Checker module OutLayer runs on testnet | sha256 `fc72c7b662fc48ca497c9582a0b1aa8271e051d132283a9645cd5395b485f975`, equal to the CI artifact `customs-checker-wasm-testnet` | `scripts/testnet-live.sh` (check `judge_pinned`) | `curl` of the FastFS URL in `customs_params().module_url`; upload transaction `DbC5Gk49XJV3L4mvZnFC4xXRnb7ufLUWFk9Vouaxf5Q2` |

Access-key detail behind the key row: one wallet in the 11 launches holds any key that its creator also holds. `krhuize.tg` (buyer in `mob.nearlytrade.near`) and `tiadoyinnn.near` (creator) both list `ed25519:BS5tkyAHU6dyLHVYBGGxCKzqAa5jB1j1xyAMQ1Cwaqny` as a `FunctionCall` key limited to `aa-harvest-moon.near`, at block 221867528 (the buy block) and at block 222392783. The buy transaction 9Nu1ne79AHYEzip6LiSiZTodF9RQwnGAzDfSRtAyZf4Z was signed by `ed25519:H2aYmjWs22Y7ynqjBxArLqYcESE3MzSfEKp8X6x6122H`, a FullAccess key of `krhuize.tg` only. A limited key issued by one app carries no control of either account, so the contract convicts on printed receipts alone.

## Agent buy gate on testnet (`customs27-gate.testnet`)

An agent account holding only a function-call key scoped to `buy` on the gate asks it to spend. The gate holds a Customs verdict per launch (anchored by the oracle account) and releases funds only on ALLOW. Produced by `node scripts/gate-live.mjs`, each run polled to FINAL, each asserting the venue account's balance moved by exactly the amount or not at all.

| Run | Launch and anchored verdict | Result | FINAL transaction |
|---|---|---|---|
| Success | `batman-4.nearlytrade.near`, ALLOW | cleared, venue +0.01 NEAR | https://testnet.nearblocks.io/txns/3o7YxL8qhHr2WyVAkRTRT8CtTaFfuyXSSXLyvu5MLNLh |
| Must fail | `customs26-token.testnet`, BLOCK (creator paid 1 of 2 opening buyers) | refused with the gate's reason, venue +0 | https://testnet.nearblocks.io/txns/7incABozUXcN92RdSdKRMczvsMmAg38uCLDRmKFwAEfD |
| Must fail | `never-anchored-launch.nearlytrade.near`, no verdict | refused `NO VERDICT`, venue +0 | https://testnet.nearblocks.io/txns/FuUPNefaNHbMfEPhDecBSdLz4D8YAmuN6HRUKnyRKXnr |

Gate wasm sha256 `61926181abf26e6af4406315c6795c4a09db9aa16a8eb775d1b6f42fcb36beb6` (CI run 43419838536); the agent account's only key is the function-call key (full-access key deleted in `5TVs3wM4jK2ZqYzravgPQs9MvYaDaH7c37GZfb1RXJUR` and `8ahWMk5hqowuVzED9bft4ErFK6nzLyc75gKRBey5JYWN`).

## Stamp on testnet (`customs28-stamp.testnet`)

The creator of `customs26-token.testnet` posts a 1 NEAR bond. A sponsored filing account holding only a function-call key scoped to `challenge` spends prepaid credit to file a funding path. The pinned WASI checker runs in an OutLayer TDX enclave, answers through yield/resume, and the contract verifies the enclave's ed25519 signature before it moves money. Produced by `node scripts/stamp-live.mjs`, every run polls the challenge to a terminal state and asserts a balance change only completion can produce.

| Run | Path filed | Result | FINAL transaction |
|---|---|---|---|
| Success | creator to `customs26-buyer1`, then its opening buy | Upheld: stamp reads Broken, prover `customs26-hunter.testnet` gained the 1 NEAR bond plus its 0.1 NEAR filing bond (1.1 NEAR) | https://testnet.nearblocks.io/txns/Ex66obG5KReivgotwKPQNrS5VAKUdix2NHiL2AFPcqHT |
| Must fail | a real receipt that does not pay the clean buyer `customs26-buyer2` | Rejected: the 0.1 NEAR filing bond is forfeited, the stamp stands | https://testnet.nearblocks.io/txns/12rqdqCenMvUSda35KuHd9B1ZQvfHs1SHWjwWL7pqsgw |
| Must fail | a hop that is not a real transaction | Unanswered: the checker refuses, no verdict applied | https://testnet.nearblocks.io/txns/CPyH9SjWPfwZLpGdjXEsYNxYSQYMeUiMMRFkR9cQHvjq |
| Must fail | a bond above the sponsored credit | the call fails on chain, nothing filed | https://testnet.nearblocks.io/txns/7D5mHWdoSRDWxMhWfkPhUEddSdQrTGJYKsKCob27PggG |

Pinned verdict key `ed25519:Akwz7rSe9k1uWuPBHesPfxeYMGJksCQmHLd2ABETTsgw` (pin tx `BcG2RpoKVbsketB5Fb76aAKEr5i6qzeppE9HpqDtoAyV`); wasm sha256 `a93c9bb0ac81a82760fd9bc18b3a6631a45a204dd4eb4c504b5ef0daacb418d2` (CI run 43425059150); the filing account's full-access key is deleted (`BGZRYWAnuvoii6UzRDiwXm5c3GGXZk2D7RWFPk5QT5qW`).

## Customs Hunt (slot 31, `max_age_blocks` 400), 2026-11-13

| Check | Result | Evidence |
|---|---|---|
| Hunt through the real page, cold | `Let Customs Hunt` ends Upheld, 1.1 NEAR to `customs31-hunter.testnet`, 14 s from page load, filing on chain in 4 s | filing tx https://testnet.nearblocks.io/txns/2jhSwrQDdfmvugPUeCnQvuUQAv473znWfXtiBJa5F7r2 ; `node scripts/cold-run.mjs <url> "#break-go" out.png` |
| Prompt-injected hunter, cold | files the clean buyer, verdict Rejected in 22 s, 0.1 NEAR filing bond forfeited, stamp stands | https://testnet.nearblocks.io/txns/AwRXPGzKVow1F3MdEBNMiSGsxUCt8Z2bCpnQZzZE3SYv ; `node scripts/cold-run.mjs <url> "#break-clean" out.png` |
| The hunter key refuses to move money | `release_stamp` and `withdraw_credit` return `MethodNameMismatch`, a transfer returns `RequiresFullAccess`; no transaction is created | `curl -s -X POST https://near-customs.earn-shield-alerts.workers.dev/hunt/inject -d '{"stamp":"customs31-stamp.testnet"}'`; `web/test/agent.test.mjs` fails when the refusal check is loosened |
| Hunter key scope | one function-call key, receiver `customs31-stamp.testnet`, methods `challenge`, no full-access key | `near account list-keys customs31-hunter.testnet network-config testnet` |

## meme.cooking and Rhea integration (read-only mainnet), 2026-11-14
| Fact | Evidence | Command |
|---|---|---|
| The feed lists real meme.cooking launches | `GET https://api.meme.cooking/meme` returns 2,321 launches; the page shows the newest finalized ones that opened a pool (NCN, SOONER, BATMAN, PT, DOGHOT, NRVNA) | `curl -s https://api.meme.cooking/meme \| jq length`, or `curl -s https://customs.../mc/launches` |
| Each card's opening depositors are real deposits | `GET /trades?meme_id=2203` returns 55 trades; first deposit by `airclouddrop.tg`, receipt `EDDEied4wb2Pym7L1cNsgTSyj9CsKkjDRtw9ZBKRjM4R` | `curl -s 'https://api.meme.cooking/trades?meme_id=2203'` |
| The creator-funded check runs on those deposits | for each of the first 6 distinct depositors, the first 3 transactions on NEAR mainnet are read from `tx.main.fastnear.com`; a creator-signed one marks the card Creator-funded | open a card's funding graph on the live page |
| The Rhea pool is read from the pool contract | `get_pool(8918)` on `v2.ref-finance.near` at mainnet block 224413028: `ncn-2203.meme-cooking.near` + `wrap.near`, 63.8791 NEAR of wNEAR liquidity, linked to `https://dex.rhea.finance/pool/8918` | `near contract call-function as-read-only v2.ref-finance.near get_pool json-args '{"pool_id":8918}' network-config mainnet now` |
| Slot 32 stamp is standing | `customs32-stamp.testnet` bond 1 NEAR posted by `customs26-creator.testnet`, tx 9on8XamCoXvRc1o4haTpuewWuWVR5kHzx7xdk5ftcRCN; hunter key is `challenge` only (full-access key deleted) | `near contract call-function as-read-only customs32-stamp.testnet stamp_of json-args '{"launch":"customs26-token.testnet"}' network-config testnet now` |
