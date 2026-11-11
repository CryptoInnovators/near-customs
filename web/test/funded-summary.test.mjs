import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { fundedSummary } = createRequire(import.meta.url)("../ui.js");

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
