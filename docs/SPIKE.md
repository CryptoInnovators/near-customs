# SPIKE: what the chain says about real NEAR openings

The claim the product rests on, as a number: opening buyers sell almost everything inside 24 hours, and the walker can follow the creator's money to a buyer when a path exists. Both are measured below on mainnet data, read only, with the call and block behind each figure.

## Method

- Launches: 11 Nearly launches that opened between 24 and 29 October 2026 (token `<name>.nearlytrade.near`, market `dclv2.ref-labs.near`), 247 opening buyers in total. Buyers are wallets the market paid tokens to inside the 600 second opening window. Sells are excluded when identifying buyers, so only buys count.
- Source: FastNEAR public transaction API for the walk, `archival-rpc.mainnet.fastnear.com` `block` for the head, with the head height printed in each row. Nothing is signed or funded.
- Command per launch: `cargo run --release -p customs-walker -- replay --token T.nearlytrade.near --creator C.near --placebo-creator X.near`. Raw output with every wallet, class, receipt path and call counts is in `spikes/replay/<name>.json`, logs beside it.
- Placebo: for each launch the same walk runs with an unrelated creator account. It must find nothing, and it found nothing for 226 of 226 tested wallets.
- Independent sold-share check: `spikes/balances.py` reads `ft_balance_of` for every buyer at block 222392783 over node RPC, a different surface from the walker's transaction API (`spikes/replay/balance-check.json`).
- Key check: `spikes/replay/key-check.json` compares every buyer's access keys with the creator's at the same block.

## Result table

| Launch | Opening (UTC) | Buyers | Opening tokens sold within 24h | Creator's own wallet | Creator-linked at 1 / 2 / 3 hops | Wallets the creator paid | Placebo creator linked | Replay head block |
|---|---|---|---|---|---|---|---|---|
| phire.nearlytrade.near | 10-29 13:20 | 24 | 100.00% | 8.18% | 0.00% / 0.00% / 0.00% | 0 | 0 of 23 | 222392004 |
| clearline.nearlytrade.near | 10-28 15:54 | 24 | 100.00% | 8.23% | 0.00% / 0.00% / 0.00% | 0 | 0 of 23 | 222393083 |
| justai.nearlytrade.near | 10-28 14:55 | 12 | 97.22% | 2.69% | 0.00% / 0.00% / 0.00% | 0 | 0 of 11 | 222392008 |
| wmark.nearlytrade.near | 10-28 13:30 | 31 | 100.00% | 7.76% | 0.00% / 0.00% / 0.00% | 0 | 0 of 30 | 222393235 |
| mob.nearlytrade.near | 10-27 19:02 | 16 | 100.00% | 1.78% | 0.00% / 0.00% / 0.00% | 0 | 0 of 12 | 222393319 |
| drita.nearlytrade.near | 10-27 13:19 | 31 | 100.00% | 6.02% | 0.00% / 0.00% / 0.00% | 0 | 0 of 30 | 222393458 |
| nearvember.nearlytrade.near | 10-26 17:14 | 19 | 99.61% | 0.00% | 0.00% / 0.00% / 0.00% | 0 | 0 of 18 | 222392014 |
| celadon.nearlytrade.near | 10-26 13:41 | 32 | 100.00% | 4.27% | 0.00% / 0.00% / 0.00% | 0 | 0 of 31 | 222392012 |
| doljabi.nearlytrade.near | 10-26 08:17 | 19 | 100.00% | 0.00% | 0.00% / 0.00% / 0.00% | 0 | 0 of 18 | 222393592 |
| ss.nearlytrade.near | 10-25 03:28 | 12 | 100.00% | 0.74% | 0.00% / 0.00% / 0.00% | 0 | 0 of 11 | 222393667 |
| grlant.nearlytrade.near | 10-24 07:32 | 27 | 97.06% | 0.27% | 0.00% / 0.00% / 0.00% | 0 | 0 of 19 | 222392017 |

buyers 247, placebo wallets tested 226

Positive control (the walker finds a link when one exists): `walker control --creator C.near` walks forward from five creators. Three have wallets the creator paid directly or through a relay: `greenlanternillia.near` (1 hop), `justai.near` (1 hop, 11 NEAR to wallet `8a5e6467...`, tx `24s4cWRUS7215q3Zmn12s4BMvUtx8PzY6G3CgKztX16t`), `jakeronthia.near` (2 hops). The backward search from each of those wallets returns the printed path, and the same wallet checked against an unrelated creator is unlinked (`same_wallet_other_creator_unlinked: true` in all five files, `spikes/control/`). That path is the one the sandbox test `the_positive_control_is_upheld` feeds to the enclave module.

## Reading the numbers

| Question | Measured | Read at |
|---|---|---|
| Share of opening tokens sold within 24 h | 97.06% to 100.00% on every launch | head blocks 222392004 to 222393667 |
| Share bought with creator-traceable money, 1, 2 and 3 hops | 0.00% on all 11 launches | same |
| Creator's own wallet in the opening | 0.00% to 8.23% of opening tokens | same |
| Buyer wallets sharing an access key with the creator | 1 of 247 (`krhuize.tg` on `mob.nearlytrade.near`) | block 222392783 |
| Placebo creator linked | 0 of 226 wallets | same |
| Opening tokens still held by opening buyers | 0.00% on 9 of 11 launches, 0.98% on `grlant`, 2.77% on `justai` | block 222392783, `ft_balance_of` over node RPC |

Kill rule from WIN-CONDITIONS.md: kill if the share sold within 24 h is under 20% AND the creator-traceable share is under 2%. The sold share is above 97%, so the vest has a measured target and the product stands. The creator-traceable share is below one in six, the level a Solana measurement reports for visible funding before a first early buy (arXiv 2610.39458), so Customs ships as a vest-first coin: the 24 hour vest carries the mechanism, and `challenge` is the ritual that pays whoever finds the path.

For comparison, MELT reports 36.5% of supply on average held by coordinated accounts on 41,000 Solana launches (arXiv 2602.13480). Customs measures a different thing, supply bought with the creator's own traceable money, so the two figures are shown side by side and are not the same metric.

What the opening looks like without the vest: the same wallets buy every opening and leave inside the day, and the contract makes that exit impossible for the first 24 hours.
