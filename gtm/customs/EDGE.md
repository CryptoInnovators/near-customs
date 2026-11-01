# Customs edge sweep

Sweep date: 2026-10-31. The relevant edge is contract-enforced sell delay plus bounded evidence handling. No contract or source file was changed in this validation pass.

## Adopted

### near-sdk-rs 5.30.0

- Source: https://github.com/near/near-sdk-rs/releases/tag/near-sdk-v5.30.0
- Fetched through Parallel web fetch on 2026-10-31.
- Release text: “Stable release for nearcore 2.14.” It adds canonical UAID validation, `ml_dsa_verify`, SHA3 hashes, universal state init, typed BLS12-381 bindings, and bounded vectors and strings behind `unstable`.
- Adoption decision: pin the planned Customs contract build to 5.30.0 and use bounded input types in the challenge-path design where the current code permits it. The source tree was intentionally not touched under the task boundary.

### Anti-sniper design reference

- Source: https://ethresear.ch/t/anti-sniper-defenses-token-launches-beyond/22882
- Fetched through Parallel web fetch on 2026-10-31. Published 2025-08-06.
- Relevant text: “Sniper’s require an ability to sell tokens between milliseconds and minutes after buying them.” The article discusses time-based selling rules and smart-contract-level protection.
- Spike result: Customs keeps the 24-hour contract vest floor as the primary mechanic. The evidence verifier is only a challenge dependency, so a timeout cannot release tokens. This matches the failure mode described by the paper while retaining the hackathon requirement that the mechanic live in contract state.

## Rejected or not yet usable

- `papers search "memecoin launch sniper bundle vesting"` returned no results on 2026-10-31 because the configured paper sources were unavailable or rate limited. Existing `docs/PRIOR-ART.md` remains the paper record.
- RivalSearch social search for `memecoin launchpad sniper bundles sell lock` returned ten irrelevant Product Hunt items and no Reddit, HN, or Product Hunt demand evidence. It is logged as a failed lane, not a positive signal.
- Exa search hit its free rate limit and fell back to Parallel. Exa fetch succeeded through the fallback for the X candidate pages.

