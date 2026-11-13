import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { fundedSummary, traceVerdict } = createRequire(import.meta.url)("../ui.js");

const traceStatus = (b) => {
  const s = b.trace?.status || "pending";
  return s === "not_traced" ? "pending" : s;
};

const Y = 10n ** 24n;

test("creator-only: the creator's own buy is not counted as hidden funding", () => {
  const buyers = [
    { wallet: "creator.near", cost: 350n * Y, trace: { status: "creator" } },
    { wallet: "a.near", cost: 2n * Y, trace: { status: "unlinked" } },
    { wallet: "b.near", cost: 7n * Y, trace: { status: "unlinked" } },
  ];
  const s = fundedSummary(buyers, traceStatus);
  assert.equal(s.funded.length, 0);
  assert.equal(s.devBuys.length, 1);
  assert.equal(s.devBuyCost, 350n * Y);
  assert.equal(s.totalCost, 359n * Y);
});

test("linked: only the linked buyer counts as funded", () => {
  const buyers = [
    { wallet: "a.near", cost: 5n * Y, trace: { status: "linked" } },
    { wallet: "creator.near", cost: 1n * Y, trace: { status: "creator" } },
  ];
  const s = fundedSummary(buyers, traceStatus);
  assert.equal(s.funded.length, 1);
  assert.equal(s.fundedCost, 5n * Y);
  assert.equal(s.devBuys.length, 1);
  assert.equal(s.devBuyCost, 1n * Y);
});

test("none: all unlinked reports zero funded and zero dev buys, totalCost is the sum", () => {
  const buyers = [
    { wallet: "a.near", cost: 3n * Y, trace: { status: "unlinked" } },
    { wallet: "b.near", trace: { status: "unlinked" } },
    { wallet: "c.near", cost: 4n * Y, trace: { status: "unlinked" } },
  ];
  const s = fundedSummary(buyers, traceStatus);
  assert.equal(s.funded.length, 0);
  assert.equal(s.devBuys.length, 0);
  assert.equal(s.totalCost, 7n * Y);
});

test("partial trace: no verdict figure while any opening buyer is untraced", () => {
  const buyers = [
    { wallet: "creator.near", cost: 23n * Y, trace: { status: "creator" } },
    { wallet: "a.near", cost: 2n * Y, trace: { status: "unlinked" } },
    { wallet: "b.near", cost: 7n * Y, trace: { status: "not_traced" } },
    { wallet: "c.near", cost: 1n * Y },
  ];
  const v = traceVerdict(buyers);
  assert.equal(v.complete, false);
  assert.equal(v.figures, null);
  assert.equal(v.done, 2);
  assert.equal(v.total, 4);
  assert.equal(traceVerdict([]).complete, false);
  buyers[2].trace = { status: "unlinked" };
  buyers[3].trace = { status: "linked" };
  const done = traceVerdict(buyers);
  assert.equal(done.complete, true);
  assert.equal(done.figures.funded.length, 1);
  assert.equal(done.figures.devBuys.length, 1);
  assert.equal(done.figures.totalCost, 33n * Y);
});
