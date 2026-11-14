import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const L = createRequire(import.meta.url)("../lp-lib.js");
const N = (n) => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
const dep = (account, n, ts) => ({ account, amount: N(n), ts, receipt: "r" + ts });

test("creator's own account among the first openers is named with its net and share of the raise", () => {
  const t = { deposits: [dep("creator.near", 99.5, 1), dep("b.near", 20, 2), dep("c.near", 11.5, 3)], withdrawals: [] };
  const f = L.insiderFact("creator.near", t);
  assert.equal(f.text, "Creator's own account is opener 1, 99.50 N, 76% of the raise");
});

test("withdrawals are netted off before the share is computed", () => {
  const t = { deposits: [dep("a.near", 10, 1), dep("creator.near", 10, 2)], withdrawals: [{ account: "creator.near", amount: N(4), ts: 3, receipt: "w" }] };
  assert.match(L.insiderFact("creator.near", t).text, /opener 2, 6.00 N, 38% of the raise/);
});

test("a creator deposit after the sixth opener reads as a plain own deposit", () => {
  const ds = ["a", "b", "c", "d", "e", "f"].map((x, i) => dep(x + ".near", 1, i + 1));
  const f = L.insiderFact("creator.near", { deposits: [...ds, dep("creator.near", 2, 9)], withdrawals: [] });
  assert.equal(f.text, "Creator deposited 2.00 N into its own raise");
});

test("with no creator deposit a large top wallet is named, otherwise the first depositor", () => {
  const big = L.insiderFact("c.near", { deposits: [dep("a.near", 1, 1), dep("whale.near", 9, 2)], withdrawals: [] });
  assert.equal(big.acct, "whale.near");
  assert.match(big.text, /^Top wallet \{acct\} holds 90% of the raise$/);
  const flat = L.insiderFact("c.near", { deposits: ["a", "b", "x", "d", "e", "f", "g", "h"].map((x, i) => dep(x + ".near", 1, i + 1)), withdrawals: [] });
  assert.equal(flat.acct, "a.near");
  assert.match(flat.text, /^First in: \{acct\}, 1\.00 N$/);
});

test("openers skip the creator and repeat depositors and stop at the limit", () => {
  const t = { deposits: [dep("c.near", 1, 1), dep("a.near", 1, 2), dep("a.near", 1, 3), dep("b.near", 1, 4), dep("d.near", 1, 5)] };
  assert.deepEqual(L.openers("c.near", t, 2).map((d) => d.account), ["a.near", "b.near"]);
});

test("the raise series is cumulative and goes down on a withdrawal", () => {
  const s = L.raiseSeries({ deposits: [dep("a.near", 5, 1), dep("b.near", 3, 3)], withdrawals: [{ account: "a.near", amount: N(2), ts: 2, receipt: "w" }] });
  assert.deepEqual(s.map((p) => p.y), [5, 3, 6]);
  assert.deepEqual(s.map((p) => p.deposit), [true, false, true]);
});

test("Rhea price scales both sides and refuses a pool without wNEAR", () => {
  const pool = { token_account_ids: ["tok.meme-cooking.near", "wrap.near"], amounts: [String(10n ** 18n * 1000n), String(50n * 10n ** 24n)] };
  const p = L.rheaPrice(pool, "wrap.near", 18);
  assert.equal(p.price, 0.05);
  assert.equal(p.wnear, 50);
  assert.equal(L.rheaPrice({ token_account_ids: ["a", "b"], amounts: ["1", "1"] }, "wrap.near", 18), null);
});

test("status follows the pool and the end time; the meter never exceeds 20 cells", () => {
  assert.equal(L.status({ pool_id: 5 }, 10), "cooked");
  assert.equal(L.status({ pool_id: null, end_ms: 20 }, 10), "cooking");
  assert.equal(L.status({ pool_id: null, end_ms: 5 }, 10), "spoiled");
  assert.equal(L.meterCells(900, 500), 20);
  assert.equal(L.meterCells(0, 500), 0);
  assert.equal(L.meterCells(1, 500), 1);
});
