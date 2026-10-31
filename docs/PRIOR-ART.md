# Customs: academic prior art

Date 2026-10-31. Product plan read: round2/customs/WEDGE-GTM.md (vest floor, challenge with printed receipt path, OutLayer evidence check, 20% seizure, 4 hop limit, Nov 2 spike).

Search log. `papers search` returned "no results" for 11 of 12 queries because the OpenAlex free daily budget for this IP was spent (direct curl to api.openalex.org returned "Insufficient budget") and Semantic Scholar returned 429. The one query that returned rows ("bundled wallets coordinated token launch manipulation", via s2) surfaced 2610.39458, 2609.10246 and 2602.13480. The rest came from the arXiv API directly (8 queries in the competitors' words: "pump.fun", memecoin sniper/insider/bundle, "rug pull" token, sybil airdrop, address clustering blockchain, bonding curve token, plus one empty compound query) and `papers abstract` / arxiv.org/abs citation metadata for every abstract below. Full PDFs opened with pdftotext: 2609.10246, 2610.39458, 2602.13480.

## Papers

All are arXiv preprints; no DOI was assigned in the metadata read. Venue for each is "arXiv preprint" unless stated.

1. **Early-Buyer Groups and Fast-Wallet Teams on a Bonding-Curve Launchpad: A Prospective Measurement Study of pump.fun on Solana.** arXiv 2610.39458, 2026. https://arxiv.org/abs/2610.39458
   Measured: 200,443 launches, 15.85M trades, 51.0M SOL transfers over 88.3 h yield 23,710 wallet groups; in the full text, funding is visible for at most about half of team wallets (35% of a 126-wallet team) and fewer than one in six receive it before their first early buy; a follower entering at the earliest group signal loses money in all 32 configurations.
   Implies: number to beat and claim to drop. A "funded by the creator before the buy" rule will convict only a minority of real insider wallets, so the Nov 2 spike metric (ii) is likely small and the 24 h vest floor must carry the product. Drop any line that implies Customs finds most insiders. Also adopt their evaluation hygiene: a placebo set and a hold-out, because they document errors that "turn the same data into apparent profit".

2. **Meme Coin Factories: Uncovering Large-Scale Manipulations on pump.fun.** arXiv 2609.10246, 2026. https://arxiv.org/abs/2609.10246
   Measured: 15M coins over two years; five manipulation classes (wash trading, creator address obfuscation, coordinated sell, copycats, social); a common-funder graph traced up to 3 hops puts over half of 5,826,346 creator addresses into multi-address clusters, the top 1% of clusters make 58.57% of coins, and false links grow with hop count when a third-party service goes unlabeled.
   Implies: mechanism to adopt and an attack to defend. Their hop depth saturates at 3 (little gain from 2 to 3), so cut the Customs limit from 4 hops to 3. Keep the listed-hub exclusion and publish the hub list, because their method is explicitly weakened by missed exchange and bridge labels. They also find automated low-latency "market manipulation as a service" tools that fresh-wallet around platform rules, which is the adversary against a funding path: plan the attack script to include fresh-wallet fan-out and a CEX hop.

3. **MELT: A Behavioral Trace Dataset for High-Risk Memecoin Launch Detection.** arXiv 2602.13480, 2026. https://arxiv.org/abs/2602.13480 (code https://github.com/git-disl/MELT)
   Measured: 41k+ Solana launches, 200M+ transactions; linking accounts by funding, shared signers and Jito bundle IDs shows 36.5% of supply on average sits with coordinated accounts that look independent.
   Implies: number to compare against. The Nov 2 replay table should report "share of opening supply bought with creator-traceable money" next to this 36.5% Solana figure, so a reader can see whether NEAR is better or worse. Note their strongest link is Jito bundle ID, which NEAR has no equivalent for; do not claim parity with a bundle detector.

4. **From Hype to Collapse: Investigating Rug Pull Scams on Solana.** arXiv 2603.24625, 2026. https://arxiv.org/abs/2603.24625
   Measured: 117 confirmed rug pulls give three on-chain patterns (freeze authority abuse, liquidity withdrawal, pump-and-dump); the pipeline flags 76,469 of 100,063 new Orca, Raydium and Meteora tokens, with a 0.26% labeling false-positive rate on a 382-sample audit, and extremely short lifecycles.
   Implies: scope the claim. The contract-only floor (LP held by a contract with no withdraw, no freeze key, no mint) removes two of three patterns by construction; the pump-and-dump pattern is what the vest and seizure address. State exactly those three patterns in the README as the threat model. Their base rate (about three quarters of new tokens rugged under their definition) is the number to cite for why an opening-window rule matters.

5. **Token Spammers, Rug Pulls, and SniperBots: An Analysis of the Ecosystem of Tokens in Ethereum and in the Binance Smart Chain (BNB).** arXiv 2206.08202, 2022. https://arxiv.org/abs/2206.08202
   Measured: about 60% of tokens are active under one day, 1% of addresses create 20 to 25% of tokens, 1-day rug pulls produced an estimated $240M, and sniper bots are detected inside those rug pulls.
   Implies: mechanism fit. A 24 h vest matches the observed token lifespan: a sniper who cannot exit inside the first day cannot complete the 1-day rug. Use "sniper bot" as defined here when writing the replay harness, and cite the 1% of addresses figure for why serial creators dominate. Predates 2023, kept because it is the only source that quantifies snipers as a separate actor.

6. **How Reliable Is the Multi-Input Heuristic for Bitcoin Address Clustering in Law Enforcement Contexts?** arXiv 2607.07414, 2026. https://arxiv.org/abs/2607.07414
   Measured: against legally reported ground truth, MIH recall is 0.71 on reported addresses but full-cluster precision and recall fall to 0.36 and 0.44, with near-complete failure for some entities.
   Implies: claim to keep and defend. This is direct evidence for the Codex objection and for the design decision: heuristic clusters overstate ownership, so Customs convicts only on a printed receipt path ("the creator's money paid for this buy"), never on a cluster or an ownership claim. Quote this when a judge asks why not run a clustering model. It is Bitcoin, not NEAR, so state it as an analogy.

7. **Detecting Sybil Addresses in Blockchain Airdrops: A Subgraph-based Feature Propagation and Fusion Approach.** arXiv 2505.09313, 2025. https://arxiv.org/abs/2505.09313
   Measured: LightGBM on two-layer transaction subgraphs over 193,701 addresses (23,240 sybil) exceeds 0.9 on precision, recall, F1 and AUC, using lifecycle timing features such as first gas acquisition.
   Implies: the number a probabilistic detector reaches, and the line Customs deliberately does not cross. Customs has no classifier and no score, so it cannot be false-positive-rated the same way; say so as a design choice. Adopt one feature for the hunters' open-source walker: time of first gas funding relative to the opening buy, as a ranking signal for which wallets to try a challenge on.

8. **Toward Resilient Airdrop Mechanisms: Empirical Measurement of Hunter Profits and Airdrop Game Theory Modeling.** arXiv 2503.14316, 2025. https://arxiv.org/abs/2503.14316
   Measured: hunter profit from Hop Protocol and LayerZero data, plus a game model of attackers, organizers and bounty hunters with incentive structures that raise detection at low organizer cost.
   Implies: mechanism adopted and a gap to close. Customs is a bounty-hunter design (20% of the unvested bag, bond burned on a rejected challenge). Use their three-role model to compute the minimum pool size where an expected 20% seizure beats the hunter's cost of tracing plus the bond, which the plan lists as unknown. Their finding that organizers need a cheap detection channel supports an open reference walker.

9. **Coordinated Sniper Cohorts on Pump.fun: Detection of 1,012 Persistent Wallet Rings and a Contamination-Adjusted Estimate of Coordination-Specific First-Hour Buyer-Flow Lift.** arXiv 2607.02795, 2026. https://arxiv.org/abs/2607.02795
   Measured: union-find on first-buyer co-occurrence found 1,012 persistent cohorts, but the abstract now carries a correction (Oct 2026): "buyer records include sells and miss many buys; all numerical results below are withdrawn".
   Implies: claim to drop. Cite no number from this paper. Keep only its method (cross-launch co-occurrence rings) as background, and note that the replay harness must filter sells from buys before counting openers, the exact error the authors withdrew for.

## DESIGN CHANGES

1. Hop limit 4 to 3 in `customs_params()` defaults and the evidence module (paper 2: coverage saturates at 3 hops, false links grow with depth).
2. Make the Nov 2 spike report, in one table: share of opening-bought tokens sold within 24 h; share bought with creator-traceable money at 1, 2 and 3 hops; share of visible funding that arrives before the first opening buy (paper 1 puts that under one in six on Solana); and the MELT 36.5% coordinated-supply figure as the comparison column. Kill rule stays; add a rule that a result under the paper 1 level means ship as vest-first coin with seizure as the ritual.
3. Publish the hub list (exchanges, bridges, routers, `intents.near` except through `native_withdraw` / `ft_withdraw` with owner) as a versioned file the evidence module reads, since every funder-graph method in papers 2 and 6 degrades when third-party services are unlabeled. Add a must-fail test: path through an unlisted CEX hot wallet convicts nothing.
4. Add a hunter economics note computed from the game model (paper 8): minimum seized value vs bond plus tracing cost, and set the default bond and seize share from that number, not by feel.
5. Replay harness: count only buys (not sells) when identifying opening buyers (paper 9 correction), report with a placebo wallet set and a held-out launch split (paper 1).
6. Threat model section lists exactly three rug patterns from paper 4 and which ones the contract removes (liquidity withdrawal, freeze or mint authority) and which the vest and seizure address (pump-and-dump).
7. Keep conviction on a printed receipt path only; no cluster score anywhere in the contract, UI or README (paper 6).
8. Hunter tool ranking feature: time from first gas funding to opening buy (paper 7), in the open reference walker only, never in the verdict.

## README SENTENCES

- Customs convicts only on a printed chain of receipts, because heuristic address clustering has been measured at 0.36 precision and 0.44 recall against ground truth for Bitcoin (https://arxiv.org/abs/2607.07414), so the contract never asks a model who owns a wallet.
- Funding search stops at 3 hops, the depth where a 5.8 million creator study of pump.fun found coverage saturating (https://arxiv.org/abs/2609.10246), and a published hub list keeps exchange and bridge wallets out of every path.
- The 24 hour opening vest targets the window where sniper bots operate: about 60% of Ethereum and BNB Chain tokens were active for under one day in a longitudinal study (https://arxiv.org/abs/2206.08202).

## BLIND SPOTS

- Search coverage: OpenAlex and Semantic Scholar were rate limited, so the sweep is arXiv only. Peer-reviewed venues (IEEE S&P, CCS, FC, IMC, WWW) and OpenAlex citation graphs were not searched; `papers cite` follow-ups were not run. Re-run `papers search` after midnight UTC.
- Every paper here is a 2022 to 2026 arXiv preprint, most from 2026; none was checked for peer review, and 2607.02795 carries a withdrawal of its numbers.
- Nearly all empirical work is Solana (pump.fun) or Bitcoin or Ethereum. No paper measures NEAR launches, NEP-141 tokens, Rhea DCL, or NEAR Intents. Every number is an analogy until the Nov 2 spike runs on NEAR.
- Paper 1's visible-funding fraction is bounded by an 88.3 h window and the authors say it cannot separate concealment from earlier ordinary funding; it is a ceiling on observability, not a measured insider rate.
- Full text was opened only for papers 1, 2 and 3. Papers 4 to 9 are cited on abstract and arXiv metadata alone.
- Not searched: academic work on vesting or lockup as a launch mechanism, on cross-chain intent-based funding obfuscation, or on bounty and challenge-bond games in optimistic systems (the challenge and bond design has a literature in optimistic rollups and TCR fraud proofs that this sweep did not cover).
