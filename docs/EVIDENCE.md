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
| OutLayer contract code under test | code hash `5waWVnt6g3FZfjR6vfYXZzpAi3sZdFy8cK2sLz4EJQDt`, sha256 `4969ffe8a1d09f55183f94ca5e02c956e3374476699dbca251645dfa2aff403f` | `scripts/fetch-outlayer.sh` | `archival-rpc.mainnet.fastnear.com` `view_code` for `outlayer.near`, block 222386104 |
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
