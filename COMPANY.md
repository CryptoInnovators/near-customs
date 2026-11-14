# Customs

Customs Hunt is an autonomous NEAR agent that hunts creator-funded opening buyers with only a function-call key. A proven receipt path pays the creator's bond to the agent; a false hunt forfeits its filing bond.

## Who uses it

Launch creators post a bond that none of their first buyers was their own money. Hunters, human or agent, collect that bond by filing a path the pinned checker proves. Traders read the funding path behind early buyers before they buy.

## How it works

A creator posts a NEAR bond on a stamp contract. The hunter, a testnet account whose only key is a function-call key limited to `challenge` on the stamp, reads the stamps, picks a buyer the creator funded, and files the exact path with a filing bond. A pinned OutLayer WASI checker in a TDX enclave replays the path and signs a verdict; the stamp contract verifies the signature, then pays the bond to the hunter (Upheld) or forfeits the filing bond (Rejected). The hunter's key cannot call `release_stamp` or `withdraw_credit` or transfer NEAR: the NEAR node refuses each before a block includes it, and the page shows those refusals live. The NEP-141 token contract locks the opening allocation for its vest period. A challenge submits a receipt path to a pinned OutLayer WASI checker, which verifies native NEAR, wrapped NEAR and NEAR Intents transfers before the buyer's purchase. The contract checks the signed verdict and applies the configured seizure and bond rules. A static page reads token state and public launch activity. The separate agent-buy gate consumes anchored verdicts before authorizing a purchase.

## Evidence

| Fact | Evidence |
|---|---|
| The hunter's page run ended Upheld and moved 1.1 NEAR to the hunter account. | Filing path through the live page, slot 33, cold run: filing transaction [5T5v5cJc...](https://testnet.nearblocks.io/txns/5T5v5cJc7Zghs6mw3Pb9MB9ewKidEKJNNgv4q8fsMpaD), `challenge_of(1)` is `Upheld` with `paid` 1.1 NEAR to `customs33-hunter.testnet`; an earlier run on slot 29: [transaction](https://testnet.nearblocks.io/txns/FY68EWNPp3w9ggT62BURc36PvxHF4DPaLnYuESFZybCY); details in [docs/EVIDENCE.md](docs/EVIDENCE.md). |
| A bond is always standing: the worker posts the next creator bond when the last one is hunted, on a 3 minute schedule and from the card's button. | `curl -s -X POST https://near-customs.nearlive.workers.dev/stamp/arm` returns the standing stamp; bonds [slot 37](https://testnet.nearblocks.io/txns/3b2Ju6iyk58TuqohaSRz4mQTXJEA5A9VKFb2MRC7z5fC) and [slot 38](https://testnet.nearblocks.io/txns/FsnVn2bmnF9FHJQ5Zn5VhMPtX31vGCZEABCyqZsySztX); cold run on slot 37: filed in 6 s ([tx](https://testnet.nearblocks.io/txns/4eKWMonMTH7kHnPnRV8aL1cstKpJ6JGXnexarhM9ZGDm)), checker verified ([tx](https://testnet.nearblocks.io/txns/4nSXJK4ZXBTGuFVjDKjEydMLt7oofHTS22GMn9vThdL4)), +1.10 NEAR to the hunter. |
| A false hunt against a clean buyer ended Rejected and forfeited the filing bond; the stamp stands. | [Transaction](https://testnet.nearblocks.io/txns/BDPr2cw4dX7pF11iEK3uLr9GjVchkUY85gE2gjeGHkF2). |
| The hunter's key is function-call only and scoped to `challenge`. | `near account list-keys customs34-hunter.testnet network-config testnet`; the page reads the same list from the chain. |
| A prompt-injected hunter signing `release_stamp`, `withdraw_credit` and a transfer is refused by the NEAR node. | `curl -s -X POST https://near-customs.nearlive.workers.dev/hunt/inject -d '{}'` returns each refusal (`MethodNameMismatch`, `RequiresFullAccess`); no transaction is created. |
| The live testnet token's upheld challenge seized the configured share of a creator-funded buyer's unvested balance; a second challenge was rejected. | `scripts/testnet-live.sh`; filing transactions [upheld](https://testnet.nearblocks.io/txns/3Nr9SzTP8jBpZxTwV9W9hPfd2KMjfSsYqPBGyru3RuVN) and [rejected](https://testnet.nearblocks.io/txns/FVbjGgwXwyGAVkqR8JMLXKLyvRuGgZ65QLTBp2vJ1ECq), details in [docs/EVIDENCE.md](docs/EVIDENCE.md). |
| The OutLayer checker hash is pinned to the testnet token and matches the published module. | [`scripts/testnet-live.sh`](docs/EVIDENCE.md); checker upload [transaction](https://testnet.nearblocks.io/txns/DbC5Gk49XJV3L4mvZnFC4xXRnb7ufLUWFk9Vouaxf5Q2). |
| An agent-buy gate allowed an anchored ALLOW and refused a BLOCK and a missing verdict. | [ALLOW](https://testnet.nearblocks.io/txns/3o7YxL8qhHr2WyVAkRTRT8CtTaFfuyXSSXLyvu5MLNLh), [BLOCK refusal](https://testnet.nearblocks.io/txns/7incABozUXcN92RdSdKRMczvsMmAg38uCLDRmKFwAEfD), [missing-verdict refusal](https://testnet.nearblocks.io/txns/FuUPNefaNHbMfEPhDecBSdLz4D8YAmuN6HRUKnyRKXnr). |
| Git history records `kamalbuilds` as commit author from 2026-10-31 through 2026-11-13. | `git log --reverse --format='%ad %an' --date=short`; `git log -1 --format='%ad %an' --date=short`. |
| The feed is real meme.cooking launches with live Rhea pool liquidity | `api.meme.cooking/meme` (2,321 launches) and `get_pool(8918)` on `v2.ref-finance.near` at block 224413028: 63.8791 NEAR | `curl -s https://api.meme.cooking/trades?meme_id=2203` |

## Try it in 60 seconds

Open [the Customs demo](https://near-customs.nearlive.workers.dev) and click **Hunt for 1.10 NEAR** on the Customs coin card: the challenge is filed and the bond locked in about 6 s (transaction link on the card); the enclave verdict is a second timer on the same card, 82 s median over seven recorded cold hunts. Click **Hunt a clean buyer instead** to watch the checker reject a false path and the filing bond forfeit.

## Why NEAR

The token's vest and challenge settlement run in a NEAR contract; OutLayer executes the receipt checker and returns a signed verdict that the contract verifies. NEAR Intents transfers are among the funding paths the checker reads. Sputnik DAO and NEAR AI Cloud are not part of this challenge flow.

## Team and build window

Git history records `kamalbuilds` as commit author from 2026-10-31 to 2026-11-13. The dates come from the first and latest commits; see the commands in the evidence table.
