# Submission draft

For the human to confirm field by field before anything is sent (HACKATHON.md, "What the human decides"). This file holds no personal data; name, email, team size, payout account and links are entered by the human at submit time.

## What did you build (`idea`, 1971 characters)

```
Customs is a NEAR memecoin whose contract holds opening buyers to a 24 hour vest and pays anyone who proves the creator funded one of them.

Problem: on NEAR launchpads the opening goes to wallets that sell to everyone after them. We replayed seven Nearly launches with openings on 24 to 29 October 2026: the same four wallets bought every opening, and 97 to 100% of opening tokens moved out within 24 hours. Funding is often routed through intents.near, where explorers and label tools stop.

Product: a NEP-141 token with two rules in contract state. Every wallet the pool pays during the opening window vests that buy linearly over 24 hours; ft_transfer and ft_transfer_call refuse any move into the locked amount and print the amount and unlock time. There is no owner and no setter; parameters are fixed at init. Anyone can call challenge(wallet, path, bond) with the transaction hashes through which the creator's money reached the wallet before its buy. The token asks OutLayer to run a checker module pinned by URL and sha256 in its enclave. The checker reads those receipts, applies a published rule (first hop from the creator, at most 3 hops, each hop at least half the buy cost, all before the buy, no listed hub and no busy wallet with over 3000 transactions in between) and signs a verdict. Upheld: the challenger gets 20% of the unvested bag, which keeps vesting in their hands, and the rest freezes. Rejected: the bond is forfeited. No answer: nothing moves and the bond is reclaimable.

How NEAR fits: the token is its own contract, so it waits for evidence through OutLayer yield/resume and checks the enclave's ed25519 signature with env::ed25519_verify against a key it pinned once. NEAR Intents dip4 native_withdraw events name the owner behind a payout, so a path through intents.near is checkable. A near-workspaces suite runs the token beside the outlayer.near code read from mainnet, and a mutation script breaks each guard and expects a failure.
```

Recount before sending: `python3 -c "import sys;print(len(sys.stdin.read().strip()))" < idea.txt`. After the mainnet run, the last sentence can name the token account and one upheld challenge tx if the total stays at or under 2000.

## Tracks

```json
["memecoins", "security"]
```

- `memecoins`: the mechanic is contract state, a 24 hour opening vest plus an on-chain challenge that seizes from a proven creator-funded bag, which is the track's "onchain rituals and challenges" built on NEP-141.
- `security`: scam detection whose verdict comes from an OutLayer enclave and is verified on chain against a pinned ed25519 key, matching the track's "reputation and scam detection" and its TEE ATTESTATION hint.

`open` is left out: the project fits a named track, and the brief asks for every track the project fits, not every track it could argue for.

## Q-015 disclosure (README sentence)

```
The same team also entered Overdraft, a spending-cap vault for AI agents on NEAR, at NEAR HACKATHON; the two projects are independent and share no code.
```

Before submitting, check that the final pair is still Customs and Overdraft (WIN-CONDITIONS.md marks it the user's call), add Overdraft's public repo link to that sentence, and confirm with `grep -n -i overdraft README.md`.
