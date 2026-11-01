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

Access-key detail behind the key row: one wallet in the 11 launches holds any key that its creator also holds. `krhuize.tg` (buyer in `mob.nearlytrade.near`) and `tiadoyinnn.near` (creator) both list `ed25519:BS5tkyAHU6dyLHVYBGGxCKzqAa5jB1j1xyAMQ1Cwaqny` as a `FunctionCall` key limited to `aa-harvest-moon.near`, at block 221867528 (the buy block) and at block 222392783. The buy transaction 9Nu1ne79AHYEzip6LiSiZTodF9RQwnGAzDfSRtAyZf4Z was signed by `ed25519:H2aYmjWs22Y7ynqjBxArLqYcESE3MzSfEKp8X6x6122H`, a FullAccess key of `krhuize.tg` only. A limited key issued by one app carries no control of either account, so the contract convicts on printed receipts alone.
