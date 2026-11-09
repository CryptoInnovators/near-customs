# Inspector performance

Command: `node scripts/perf-inspect.mjs`. Cache is disabled because the Node harness does not define `localStorage`. The required ceilings remain `buyers_ms < 4000` and `traced_ms < 20000`.

Nearly's `GET https://nearly.trade/api/trades/<token>` returns per-trade `trader`, `side`, raw `near_amount` and `token_amount`, `block`, `ts_ms`, and `receipt`. The inspector uses the first 600 seconds of buy rows for the opening buyer list and leaves FastNEAR for funding-path reads. The board requests this endpoint when a row enters view, shows those buyers immediately, and caps concurrent inspections at three.

| Run | buyers_ms | traced_ms | Result |
|---|---:|---:|---|
| 1 | failed before timing | failed before timing | RED. Fast path exposed a BigInt/list-shape error; fixed before the next run. |
| 2 | not captured | not captured | Process had not returned after 30 seconds. No latency floor can be claimed. |

The required budgets remain `buyers_ms < 4000` and `traced_ms < 20000`. The first two runs are historical failures from before the completed adaptive-concurrency runs below.

## Adaptive trace runs

Trace wallets now start at concurrency 8, halve on each FastNEAR HTTP 429 down to 2, and recover by one after every 10 clean responses. FastNEAR retries remain enabled. The previous recorded buyer-read baseline was 437 ms and is retained here for comparison.

| Run | buyers_ms | traced_ms | buyers | Result |
|---|---:|---:|---:|---|
| 3 | 440 | 91667 | 24 | Completed. Buyer read stayed near the 437 ms baseline; trace exceeded the 20000 ms target. |
| 4 | 455 | 68546 | 24 | Completed. Trace improved by 23121 ms from run 3, but still exceeded the target. |

These are the only two post-change runs. Each started at 8 wallets; the measured result includes network variability and whether FastNEAR returned rate limits.

## Shared FastNEAR pacing

`web/net.js` now gates requests to `tx.main.fastnear.com` and `rpc.mainnet.fastnear.com` with one token bucket. Defaults are 5 requests/second and a burst of 5. Trace workers remain at 12, so the shared limiter controls request starts. HTTP 429 lowers the shared rate by 20% for a 10-second cooldown; after the cooldown, 10 clean responses restore the configured rate. A 429 retry does not add a per-request backoff; other retryable failures retain the existing backoff.

### Sustained-rate probe

Probe: 30 POSTs to `/v0/account` for `wrap.near` with `limit: 1` at each target rate. The first sequential probe immediately progressed between tiers. A second probe scheduled arrivals independently and inserted 12 seconds between tiers. Both were affected by a Cloudflare IP rate-limit response, so neither identifies a clean sustainable rate.

| Probe | Target req/s | 200 | 429 | Other errors | Elapsed | Interpretation |
|---|---:|---:|---:|---:|---:|---|
| Sequential | 3 | 28 | 2 | 0 | 11.9 s | Quota-contaminated |
| Sequential | 5 | 29 | 1 | 0 | 12.1 s | Quota-contaminated |
| Sequential | 8 | 0 | 30 | 0 | 3.6 s | Quota-contaminated |
| Spaced, independent starts | 3 | 0 | 30 | 0 | 9.7 s | IP remained rate-limited |
| Spaced, independent starts | 5 | 1 | 29 | 0 | 6.1 s | IP remained rate-limited |
| Spaced, independent starts | 8 | 0 | 30 | 0 | 3.6 s | IP remained rate-limited |

The final single-request check also returned HTTP 429 with `Retry-After: 0` and FastNEAR's `Rate limits exceeded` body. No tested tier had a valid zero-429 window. The implementation therefore uses the requested configurable 5 req/s default, not a claimed measured maximum. Re-run the probe from a quota-clean public IP before treating 5 req/s as a verified FastNEAR allowance.

### Current performance run

| Run | buyers_ms | traced_ms | buyers | trace_pages | trace_batches | Result |
|---|---:|---:|---:|---:|---:|---|
| 1 | 581 | 110870 | 24 | 26 | 46 | Failed traced budget. The run followed probe requests that observed HTTP 429. |
| 2 | 539 | 33550 | 24 | 26 | 52 | Failed traced budget. Faster than run 1, but still above 20000 ms. |

Both runs passed the `buyers_ms < 4000` budget and failed the `traced_ms < 20000` budget. The source IP had returned 429s during the immediately preceding probe, so neither run establishes clean-quota performance. Run 2 was more than 90 seconds after run 1.
