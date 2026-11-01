# Submission draft

For the human to confirm field by field before anything is sent (HACKATHON.md, "What the human decides"). This file holds no personal data. Project name, lead name, email, team size, payout account, repo link and demo link are entered by the human at submit time, and the payload is printed for a yes before the POST.

## What did you build (`idea`, 1991 characters)

```
Customs is a NEAR memecoin whose contract holds opening buyers to a 24 hour vest and pays anyone who proves the creator's money funded one of them.

Problem: on NEAR launchpads the opening goes to wallets that sell to everyone after them. We replayed eleven Nearly launches with openings from 24 to 29 October 2026. The same four wallets bought every opening, and 97 to 100% of the tokens bought in each opening moved out within 24 hours. That funding often routes through intents.near, where explorers and label tools stop.

Product: a NEP-141 token with two rules in contract state. The creator announces the opening once with open_trading, and every wallet the pool pays during the 10 minute window that follows vests that buy linearly over 24 hours. ft_transfer and ft_transfer_call refuse any move into the locked amount and print the amount and the unlock time. There is no setter: parameters are fixed at init, and init accepts only the published OutLayer contract and checker module. Anyone can call challenge(wallet, path, bond) with the transaction hashes that carried the creator's money to the wallet before its buy. OutLayer runs a checker module, pinned by URL and sha256, in its enclave. The checker reads those receipts and applies a published rule: first hop from the creator, at most 3 hops (each hop may be split over a few transfers and is added up), each hop at least half the buy cost, all before the buy, no listed hub and no busy wallet in between. Native NEAR, wNEAR transfers, function call deposits and NEAR Intents withdrawals and transfers all count as funding. Then it signs a verdict. If upheld, the challenger gets 20% of the unvested bag, still vesting, and the rest freezes for 30 days. If rejected, the bond is forfeited. If the enclave never answers, nothing moves and the bond is reclaimable.

How NEAR fits: the token is its own contract, so it waits for evidence through OutLayer yield/resume. It verifies the enclave's ed25519 signature with env::ed25519_verify against a key it pinned once. NEAR Intents dip4 native_withdraw events name the owner behind an Intents payout, which makes a path through intents.near checkable. A near-workspaces suite runs the token beside the outlayer.near code read from mainnet; a mutation script breaks each guard and expects red.
```

Count: `python3 -c "import sys;print(len(sys.stdin.read().strip()))" < idea.txt` printed 1991. After the mainnet run, the last sentence can be swapped for the token account and one upheld challenge tx, as long as the total stays at or under 2000.

## Tracks

```json
["memecoins", "security"]
```

- `memecoins`: the mechanic is contract state, a 24 hour opening vest plus an on-chain challenge that seizes from a bag proven to be creator-funded. That is the track's "onchain rituals and challenges" on NEP-141, with the "mechanic in the contract, not in a backend" that its prompt asks for.
- `security`: scam detection whose verdict comes from an OutLayer enclave and is verified on chain against a pinned ed25519 key. That matches the track's "reputation and scam detection" and its TEE ATTESTATION hint.

`open` is left out. The project fits named tracks, and the brief asks for every track it fits, not every track it could argue for.

## Q-015 disclosure (README sentence)

```
The same team also entered Overdraft (https://github.com/kamalbuilds/near-overdraft), a NEAR vault that caps what an AI agent can spend, at NEAR HACKATHON; the two projects are independent and share no code.
```

Put this sentence in both READMEs and check it with `grep -n -i overdraft README.md`.
