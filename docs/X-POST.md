# X demo post drafts

The human posts these; attach the 90-second video from docs/DEMO-SCRIPT.md. Character counts treat the repo link as 23 characters, because X wraps every link to that length. Each count was made with `len(re.sub(r"https?://\S+", "x"*23, text))`.

Posting order: A matches what the repo and `spikes/replay/` show now. B, C and the long form describe the mainnet coin and its upheld challenge, so post them once those tx hashes are in docs/EVIDENCE.md.

## A. The measured problem (274)

```
Buy a NEAR memecoin in minute one and you buy from wallets that dump within a day. 4 wallets bought all 11 openings we replayed.

Customs vests opening buys 24h by contract. How would you beat it?

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon https://github.com/kamalbuilds/near-customs
```

Numbers: `python3 spikes/table.py` over `spikes/replay/*.json`, eleven Nearly launches with openings 2026-10-24 to 2026-10-29. "Within a day" is the sold-within-24h column, 97.06% to 100%.

## B. The one moment (275)

```
NEAR snipers hide their funding behind intents.near.

I filed 2 tx hashes on one. An OutLayer enclave read the Intents withdraw, the token checked its signature: 20% of the bag is mine.

Your move?

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon https://github.com/kamalbuilds/near-customs
```

## C. The dare (274)

```
Dev-bundled launches dump on the first buyers, so we bundled our own NEAR memecoin.

Opening buys vest 24h by contract. Prove the creator paid for one and you take 20% of it. Which wallet is ours?

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon https://github.com/kamalbuilds/near-customs
```

## Long form (1522)

```
Buy a NEAR memecoin in its first minute and you are buying from wallets that sell to you within a day.

We replayed eleven Nearly launches from the last week of October. The same four wallets bought the opening of every one, and between 97 and 100 percent of the tokens bought in each opening were gone within 24 hours.

Customs is a memecoin with two rules, both in the token contract.

Every wallet that buys in the first ten minutes vests that buy over 24 hours. The NEP-141 transfer itself refuses an early sale and prints how much is locked and until when; no server is asked, and the token account holds no keys, so nobody can change the rule.

Anyone who can show the creator's money paid for an opening buy files a challenge with the transaction hashes. An OutLayer enclave reads those receipts, including a NEAR Intents withdraw, whose event names the real owner even when the wallet looks funded by intents.near. It signs a verdict; the token checks that signature against a key it pinned once and pays the challenger 20% of the wallet's unvested bag. A rejected challenge loses its bond. A silent enclave changes nothing.

In the video we bundle our own coin through a plain transfer and an Intents withdraw, then seize from it.

The rule convicts only on a printed money trail, so an insider funded from an exchange still vests 24 hours but keeps the bag. Which evasion would you try first? Repo and tests: https://github.com/kamalbuilds/near-customs

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon @NearBuilders @NearLegion
```
