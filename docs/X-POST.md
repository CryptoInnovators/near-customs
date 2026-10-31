# X demo post drafts

The human posts; attach the 90-second video from docs/DEMO-SCRIPT.md. `REPO_URL` is the public repo link, counted as 23 characters (X wraps every link to that length). Character counts below include it.

Variant B describes the mainnet challenge, so post it only after its tx hash is in docs/EVIDENCE.md. Variants A and C hold today.

## A. The measured problem (278)

```
The same 4 wallets bought the opening of all 7 NEAR memecoins we replayed. 97 to 100% of opening tokens sold within a day.

Customs vests opening buys 24h in the NEP-141 contract. Where does it break?

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon REPO_URL
```

Source for the numbers: `spikes/replay/*.json` and `*.log`, seven Nearly launches with openings 2026-10-24 to 2026-10-29.

## B. The one moment (274)

```
Bundled wallets hide their funding behind intents.near.

I filed 2 tx hashes on one. An OutLayer enclave read the Intents withdraw, the token checked its signature, and 20% of the bag moved to me.

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon REPO_URL
```

## C. The dare (260)

```
Dev-bundled launches dump on whoever buys first, so we bundled our own NEAR memecoin.

Opening buys vest 24h by contract. Prove the creator paid for one and you take 20% of that bag.

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon REPO_URL
```

## Long form

```
Buy the first minute of a NEAR memecoin and you are buying from wallets that sell to you within a day.

We replayed seven Nearly launches from the last week of October. The same four wallets bought the opening of every one. Between 97 and 100 percent of the tokens bought in each opening were gone within 24 hours.

Customs is a memecoin with two rules, both in the token contract:

Every wallet that buys in the first ten minutes vests that buy over 24 hours. The NEP-141 transfer itself refuses an early sale and prints how much is locked and until when. No server is asked.

Anyone who can show the creator's money paid for an opening buy files a challenge with the transaction hashes. An OutLayer enclave reads those receipts, including a NEAR Intents withdraw, whose event names the real owner even when the wallet looks funded by intents.near. It signs a verdict; the token checks that signature against a key it pinned once, and pays the challenger 20% of the wallet's unvested bag. A rejected challenge loses its bond. A silent enclave changes nothing.

In the video we bundle our own coin through a plain transfer and an Intents withdraw, then seize from it.

The rule only convicts on a printed money trail, so an insider funded from an exchange still vests but can't be seized from. Where else does it break? Repo and tests: REPO_URL

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon @NearBuilders @NearLegion
```

Post the long form only after the mainnet run; its fifth paragraph describes it.
