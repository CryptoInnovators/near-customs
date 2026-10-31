# WIN-CONDITIONS: Customs (track: memecoins)

Gate summary, one line per key, detail below.

Scoreboard: no NEAR winner list yet; comparable winners Vertigo, Zaunchpad, Fraudsworth, Trenches.top, MoonBags (SC).
Bar to beat: a mechanic that is contract state, a must-fail test per guard, a measured replay of real launches.
Asset we will own: the token code hash, the OutLayer path checker with its pinned key, the replay dataset, the versioned hub list.
Off-platform buyer: JustHoot (@justhootfun) and Nearly (nearlytrade.near); a target, no contact made yet.
Single entry: no, second of two beside Overdraft under Q-015; the user picks the final pair.
Verb the brief names: "onchain rituals and challenges", "treasuries with rules".
Our product performs that verb: yes, `challenge` seizes from an opening buyer's vesting bag in contracts/token/src/lib.rs.
Metric plan: 20 outside on-chain accounts, 5 of them filing challenges, read from chain on 2026-11-14.
Live by: 2026-11-07 for the mainnet token and challenge flow, after user sign-off on funded steps.
Deviation from research: W over V, plus four paper-driven changes (3 hops, hub list file, busy rule, vesting bounty).
Ask it answers: the track prompt's "mechanic in the contract, not in a backend"; no outside ask for a funding verdict exists.
Users who want it: none contacted; nearest are @0xfortizo, @sonofsun1984, @kvikash007, @waxnear with their status URLs below.

Written 2026-10-31, revised 2026-10-31 after the paper pass (docs/PRIOR-ART.md). Sources: tracks/memecoins/VERDICT.md (V), round2/customs/WEDGE-GTM.md (W), round2/customs/DEMAND.md (D), ground/SCOREBOARD-CROSS.md (SC), ground/GRAPH.md (G), all under /Users/kamal/Desktop/near/docs/research/. MISSING marks a line the research could not fill, with how to obtain it.

Scoreboard: Memecoins With Mechanics has no NEAR winner list yet. Comparable-event winners (SC, "Memecoin mechanics"): Vertigo (Solana Breakout infra second, sniper-proof launch DEX), Zaunchpad (Zypherpunk NEAR cross-chain-privacy award, Intents launchpad, team states its first architecture "didn't work well for users"), Fraudsworth (Frontier top 25), Trenches.top (Radar consumer second), MoonBags (Sui Overflow 2025 memecoin first, lead only). Track field size on NEAR: MISSING, obtain from the Devpost or nearhackathon.com submissions list on 2026-11-13. Same-track rivals: Devpost search returns 12 anti-rug entries (V section 6).

Bar to beat: SC states it as "the mechanic must be a function of onchain behavior (anti-sniper, reputation, closed loop), judged apart from the chart", and the track text says "Judged on the mechanic, not the chart". The prompt (tracks/11-memecoins.md) adds "the mechanic in the contract, not in a backend somebody could switch off". Concrete bar for us: a token whose refusal and seizure are contract state, with a must-fail test for every guard (docs/TESTS.md) and a measured replay of real launches (docs/SPIKE.md). Graph signal for the track is ZERO (G section 5: no judge, host or outsider ask for memecoins), so the score comes from mechanic depth, not from a stated wish.

Asset we will own:
- The Customs token code hash, published as one NEP-591 global contract any launchpad can link.
- The path-checker module (OutLayer WASI, wasm URL plus sha256) and its pinned signing key. It is the only on-chain-consumable checker that follows an Intents `dip4 native_withdraw` owner to its source (V section 8; Squint stops at `funded_via: intents.near`).
- A replay dataset of real NEAR openings with the calls and blocks behind each number (spikes/replay, five Nearly launches so far).
- A versioned public hub list (crates/walker/hubs.json) that the checker reports with every verdict.
- Not owned: the funding-graph indexer (Squint and FastNEAR serve it).

Off-platform buyer: JustHoot (@justhootfun, Meteor Wallet team, https://x.com/justhootfun/status/2105300319936946484, 28,524 views). It named its flagship "HOOT Test 4 (DO NOT SNIPE)", then burned the 11.53% snipers took, and is the only third party on Rhea's DCL tax-pool whitelist (V section 3). Second: Nearly (nearlytrade.near, 1,803 creators, https://nearly.trade/api/launches?limit=1). Status: no contact made and no statement of interest from either (D, W blind spots). To obtain: send the W section 4 operator DM on 2026-11-08 with the code hash and replay table; a reply or a launched token linking the hash is the evidence. Until then this line is a target, not a buyer.

Single entry: NO. Customs is the second entry of two. W ranks it last of the finalists: keep only as second entry, only if Overdraft is not that entry, only if the 2026-11-02 spike passes. The user instruction is to maximise product count, and Q-015 allows at most 2 independent disclosed projects per person, so Customs is built as entry 2 beside /Volumes/PortableSSD/near/overdraft. Which two of the lanes (cachet, customs, longcon, overdraft, receipts, sworn, taster, voucher) are the final two: MISSING, the user decides; obtain by asking the user before the 2026-11-12 submission prep. If Customs is not chosen, it is dropped, not submitted second-rate.

Verb the brief names: "Build memecoins where the meme does something: supply that reacts to the community, treasuries with rules, onchain rituals and challenges." Hints: MEMECOINS, TOKEN MECHANICS, NEP-141.

Our product performs that verb: yes, in the "onchain rituals and challenges" and "treasuries with rules" sense. Every opening buyer's tokens vest over 24h by contract; `challenge(wallet, path, bond)` seizes 20% of an insider's unvested bag for whoever proves the creator's money paid for the buy, including through NEAR Intents. Code path: `ft_transfer` from the market during the window records the bag in `on_outbound`, the same hook holds every outbound move, `challenge` calls `request_execution` on OutLayer, `on_verdict` checks the ed25519 signature against the pinned key and pays from the insider's bag (contracts/token/src/lib.rs). Not claimed: a supply that reacts to price, or an agent economy.

Metric plan (on-chain only, read from chain on 2026-11-14, script output pasted into docs/EVIDENCE.md):
- Outside accounts: distinct accounts not linked to any team account within 3 hops (the check is published) that (a) file a `challenge` on a Customs coin, upheld or rejected, (b) buy in an opening window and sell after vest or hold past it, or (c) deploy a coin through the factory. Likes, follows and DMs count zero.
- Target 20 accounts, at least 5 under (a), at least 1 under (c). Kill line: fewer than 3 outside accounts under (a) after the 2026-11-10 launch, then the pitch drops user counts and leads with the replay table.
- Mechanism numbers: share of opening-bought tokens sold within 24h; share bought with creator-traceable money at 1, 2 and 3 hops; false-positive count against a placebo creator; Intents owner resolved share (target at least 50% to an owner account, at least 30% to an origin).
- Spike kill rule (2026-11-02): kill if share sold within 24h is under 20% AND creator-traceable share is under 2%. If only the second is low, ship as a vest-first coin and pitch the seizure as the ritual (a creator-traceable share under the one in six that paper 1 reports for Solana gets the same treatment).
- Every number carries its call and block.

Live by: mainnet token, factory and challenge flow live by 2026-11-07 (W day plan has the challenge flow on a dry-run coin 2026-11-06 and the factory 2026-11-05). Public $PAPERS launch 2026-11-10 15:00 UTC. Submit by 2026-11-14 12:00 UTC. Hosted demo kept up to 2026-11-25 (Q-012). Funded mainnet steps (LP of 10 to 20 NEAR, about 10 NEAR across insider wallets, bonds) need user sign-off first; the agent does not sign or fund.

Deviation from research: V (round 1) specified an enclave verdict on every first sell with CLEARED, HELD and IMPOUNDED classes. W (round 2, which supersedes it) removed all three classes and the per-sell enclave call, because the prompt requires the mechanic in the contract and Codex judged "no link found" forgeable as a CLEARED stamp. We follow W: contract-only 24h vest floor, enclave used only inside `challenge`, silence never releases tokens. We also adopt W's narrower claim, "the creator's money paid for this opening buy", not "the creator owns this wallet". D's finding of 0 EXACT asks is carried into the pitch: no claim of outside demand for a funding verdict. Paper pass (docs/PRIOR-ART.md) changes W in four places: hop limit 4 to 3, a published versioned hub list, a busy-wallet rule for unlisted exchange hot wallets, and seized tokens that vest with the hunter (a creator challenging their own insider wallet from a second account would otherwise unlock 20% of the bag).

Ask it answers:
- Prompt: "mechanic in the contract, not in a backend"; "No admin key"; "sybil resistance with limits written plainly" (README states who escapes: CEX-funded or unrelated aged-account insiders still vest 24h but cannot be convicted); "Judged on the mechanic, not the chart".
- Public pain (not an ask for this mechanism): @LauraHarpercoll "the mass deployer with 40 wallets just routes around it on day one"; @NgocNguyen21127 https://x.com/NgocNguyen21127/status/2115365414511538674 "is there any launchpad right now that actually blocks sell bundles?"; @DjediMindTrick https://x.com/DjediMindTrick/status/2114120022209794394 "Somebody needs to create a launchpad that stops it somehow." These are under 100 views combined (D).

Users who want it: 0 outside people asked for a funding verdict (D, 0 EXACT). Nearest, none contacted:
- @0xfortizo, https://x.com/0xfortizo/status/2104516437268160797, rugged on NEAR, built NEAR Rug Check (read-only), 47,876 followers.
- @sonofsun1984, https://x.com/sonofsun1984/status/2105303148612993187, "Bundled shit. Everyday a new shitty bundled launchpad comes in near."
- @kvikash007, https://x.com/kvikash007/status/2106313383301820679, "allowed snipers to get majority of tokens which was dumped quickly."
- @waxnear, https://x.com/waxnear/status/2106667765914390902, "i'd like to see more transparency around it."
- Sleuths who trace "funded by" unpaid: Squint (@squintnear), @tryneartrade, @HoodlCTO, u/paulf280, u/No_Gas2380.
To obtain real users: run the W section 4 outreach (rows 1 to 5 by 2026-11-05) and count only on-chain accounts per the metric plan.

Q-015: README names the team's other project, Overdraft (/Volumes/PortableSSD/near/overdraft), with one line that the two are independent and share no crates. The final pair is MISSING until the user confirms (see Single entry); if Overdraft is replaced, the README names the replacement. Verify with `grep -n -i overdraft README.md` before submission.
