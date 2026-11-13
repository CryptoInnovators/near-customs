# Customs

Customs Hunt is an autonomous NEAR agent that hunts creator-funded opening buyers with only a function-call key. A proven receipt path pays the creator's bond to the agent; a false hunt forfeits its filing bond.

## Who uses it

Launch creators post a bond that none of their first buyers was their own money. Hunters, human or agent, collect that bond by filing a path the pinned checker proves. Traders read the funding path behind early buyers before they buy.

## How it works

A creator posts a NEAR bond on a stamp contract. The hunter, a testnet account whose only key is a function-call key limited to `challenge` on the stamp, reads the stamps, picks a buyer the creator funded, and files the exact path with a filing bond. A pinned OutLayer WASI checker in a TDX enclave replays the path and signs a verdict; the stamp contract verifies the signature, then pays the bond to the hunter (Upheld) or forfeits the filing bond (Rejected). The hunter's key cannot call `release_stamp` or `withdraw_credit` or transfer NEAR: the NEAR node refuses each before a block includes it, and the page shows those refusals live. The NEP-141 token contract locks the opening allocation for its vest period. A challenge submits a receipt path to a pinned OutLayer WASI checker, which verifies native NEAR, wrapped NEAR and NEAR Intents transfers before the buyer's purchase. The contract checks the signed verdict and applies the configured seizure and bond rules. A static page reads token state and public launch activity. The separate agent-buy gate consumes anchored verdicts before authorizing a purchase.

## Evidence

| Fact | Evidence |
|---|---|
| The hunter's page run ended Upheld and moved 1.1 NEAR to the hunter account. | Filing path through the live page, slot 29: [transaction](https://testnet.nearblocks.io/txns/FY68EWNPp3w9ggT62BURc36PvxHF4DPaLnYuESFZybCY); details in [docs/EVIDENCE.md](docs/EVIDENCE.md). |
| A false hunt against a clean buyer ended Rejected and forfeited the filing bond; the stamp stands. | [Transaction](https://testnet.nearblocks.io/txns/BDPr2cw4dX7pF11iEK3uLr9GjVchkUY85gE2gjeGHkF2). |
| The hunter's key is function-call only and scoped to `challenge`. | `near account list-keys customs30-hunter.testnet network-config testnet`; the page reads the same list from the chain. |
| A prompt-injected hunter signing `release_stamp`, `withdraw_credit` and a transfer is refused by the NEAR node. | `curl -s -X POST https://near-customs.earn-shield-alerts.workers.dev/hunt/inject -d '{}'` returns each refusal (`MethodNameMismatch`, `RequiresFullAccess`); no transaction is created. |
| The live testnet token's upheld challenge seized the configured share of a creator-funded buyer's unvested balance; a second challenge was rejected. | `scripts/testnet-live.sh`; filing transactions [upheld](https://testnet.nearblocks.io/txns/3Nr9SzTP8jBpZxTwV9W9hPfd2KMjfSsYqPBGyru3RuVN) and [rejected](https://testnet.nearblocks.io/txns/FVbjGgwXwyGAVkqR8JMLXKLyvRuGgZ65QLTBp2vJ1ECq), details in [docs/EVIDENCE.md](docs/EVIDENCE.md). |
| The OutLayer checker hash is pinned to the testnet token and matches the published module. | [`scripts/testnet-live.sh`](docs/EVIDENCE.md); checker upload [transaction](https://testnet.nearblocks.io/txns/DbC5Gk49XJV3L4mvZnFC4xXRnb7ufLUWFk9Vouaxf5Q2). |
| An agent-buy gate allowed an anchored ALLOW and refused a BLOCK and a missing verdict. | [ALLOW](https://testnet.nearblocks.io/txns/3o7YxL8qhHr2WyVAkRTRT8CtTaFfuyXSSXLyvu5MLNLh), [BLOCK refusal](https://testnet.nearblocks.io/txns/7incABozUXcN92RdSdKRMczvsMmAg38uCLDRmKFwAEfD), [missing-verdict refusal](https://testnet.nearblocks.io/txns/FuUPNefaNHbMfEPhDecBSdLz4D8YAmuN6HRUKnyRKXnr). |
| Git history records `kamalbuilds` as commit author from 2026-10-31 through 2026-11-13. | `git log --reverse --format='%ad %an' --date=short`; `git log -1 --format='%ad %an' --date=short`. |

## Try it in 60 seconds

Open [the Customs demo](https://near-customs.earn-shield-alerts.workers.dev) and click **Hunt this launch** on the Customs coin card: the filing transaction appears in about 5 s, then the enclave verdict. Click **Simulate a hijacked hunter** to watch the key's refusals.

## Why NEAR

The token's vest and challenge settlement run in a NEAR contract; OutLayer executes the receipt checker and returns a signed verdict that the contract verifies. NEAR Intents transfers are among the funding paths the checker reads. Sputnik DAO and NEAR AI Cloud are not part of this challenge flow.

## Team and build window

Git history records `kamalbuilds` as commit author from 2026-10-31 to 2026-11-13. The dates come from the first and latest commits; see the commands in the evidence table.
