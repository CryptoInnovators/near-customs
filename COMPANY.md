# Customs

Customs is a NEAR token and verifier that vests launch buyers' opening allocations and pays a challenger when receipt evidence proves the creator funded a buyer.

## Who uses it

Launchpad traders use Customs to inspect the funding path behind early buyers; challengers submit transaction paths when they can show creator-funded purchases.

## How it works

The NEP-141 token contract locks the opening allocation for its vest period. A challenge submits a receipt path to a pinned OutLayer WASI checker, which verifies native NEAR, wrapped NEAR and NEAR Intents transfers before the buyer's purchase. The contract checks the signed verdict and applies the configured seizure and bond rules. A static page reads token state and public launch activity. The separate agent-buy gate consumes anchored verdicts before authorizing a purchase.

## Evidence

| Fact | Evidence |
|---|---|
| The live testnet token's upheld challenge seized the configured share of a creator-funded buyer's unvested balance; a second challenge was rejected. | `scripts/testnet-live.sh`; filing transactions [upheld](https://testnet.nearblocks.io/txns/3Nr9SzTP8jBpZxTwV9W9hPfd2KMjfSsYqPBGyru3RuVN) and [rejected](https://testnet.nearblocks.io/txns/FVbjGgwXwyGAVkqR8JMLXKLyvRuGgZ65QLTBp2vJ1ECq), details in [docs/EVIDENCE.md](docs/EVIDENCE.md). |
| The OutLayer checker hash is pinned to the testnet token and matches the published module. | [`scripts/testnet-live.sh`](docs/EVIDENCE.md); checker upload [transaction](https://testnet.nearblocks.io/txns/DbC5Gk49XJV3L4mvZnFC4xXRnb7ufLUWFk9Vouaxf5Q2). |
| An agent-buy gate allowed an anchored ALLOW and refused a BLOCK and a missing verdict. | [ALLOW](https://testnet.nearblocks.io/txns/3o7YxL8qhHr2WyVAkRTRT8CtTaFfuyXSSXLyvu5MLNLh), [BLOCK refusal](https://testnet.nearblocks.io/txns/7incABozUXcN92RdSdKRMczvsMmAg38uCLDRmKFwAEfD), [missing-verdict refusal](https://testnet.nearblocks.io/txns/FuUPNefaNHbMfEPhDecBSdLz4D8YAmuN6HRUKnyRKXnr). |
| Git history records `kamalbuilds` as commit author from 2026-10-31 through 2026-11-13. | `git log --reverse --format='%ad %an' --date=short`; `git log -1 --format='%ad %an' --date=short`. |

## Try it in 60 seconds

Open [the Customs demo](https://near-customs.earn-shield-alerts.workers.dev) and inspect the testnet token panel. It reads the pinned checker, verdict key, access-key list, opening bags, and challenge outcomes from NEAR testnet.

## Why NEAR

The token's vest and challenge settlement run in a NEAR contract; OutLayer executes the receipt checker and returns a signed verdict that the contract verifies. NEAR Intents transfers are among the funding paths the checker reads. Sputnik DAO and NEAR AI Cloud are not part of this challenge flow.

## Team and build window

Git history records `kamalbuilds` as commit author from 2026-10-31 to 2026-11-13. The dates come from the first and latest commits; see the commands in the evidence table.
