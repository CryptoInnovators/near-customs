# REPORT

## Commits this session

- 63ede1c docs: TESTS with the full mutation run output
- f621c94 ci: install libudev for the cargo-near source build
- 464d555 docs: README with do-and-see steps, SPIKE with measured replay of 11 real launches
- 18fb54c test: size the balance-level hold margin to a tenth of the bag so block timing cannot flip it
- 321f924 wip: checkpoint of lane work in progress (15 files)
- 1c06cb1 ci: install cargo-near with cargo-binstall
- ea81be2 ci: fix workflow yaml (block scalars for run steps)
- 312a4a0 ci: build wasm and run sandbox tests on GitHub Actions

## Tests

- `cargo test --workspace`: 55 tests (35 sandbox in `tests/tests/token.rs`, 16 in `crates/walker`, 4 in `crates/common`). Full local run: 34 passed and 1 failed (`hold_is_balance_level_so_later_buys_stay_free`, a timing margin), fixed by sizing the refused amount to a tenth of the bag, then passed. Targeted re-runs of the walker, common and that test: green.
- `scripts/mutate.sh`: 44 guards broken one at a time, 44 `RED->GREEN`, `failures: 0`, working tree byte-identical afterwards. Output in `docs/TESTS.md`.

## Spike numbers

11 real Nearly openings, 247 buyers, mainnet reads at blocks 222392004 to 222393667: 97.06% to 100.00% of opening tokens sold within 24 h, 0.00% bought with creator-traceable money at 1, 2 and 3 hops, placebo creator linked 0 of 226, positive control finds 3 of 5 creators' paid wallets with printed paths. Detail in `docs/SPIKE.md`.

## OutLayer path

The token calls `request_execution` on `outlayer.near` through the real OutLayer contract code read from mainnet (block 222386104, sha256 checked by `scripts/fetch-outlayer.sh`). No stand-in remains in the code or docs.

## Review

`codex exec -s read-only` adversarial money-path review of the token, checker and path rule: no CRITICAL, HIGH or MEDIUM findings. Static review only.

## Demo

`scripts/check.sh --mutate`, then the walker commands in the README. A testnet or mainnet deployment id: none; mainnet deployment needs the user's sign-off and funds.

## Not done

- GitHub Actions on main had not reached green when this was written: the previous run failed building `cargo-near` from source (missing libudev), fixed in the last commit and pending its first run.
- Mainnet token deploy, factory and live challenge flow (user sign-off).

## Blind spot

The sandbox runs the real OutLayer contract code but a fake chain source feeds the checker, so the enclave's reads of live FastNEAR data and its TEE signature are exercised only by the walker replay, not by a live on-chain challenge.
