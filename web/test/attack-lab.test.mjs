import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { traceFixture, challengeVerdict } = require("../rule.js");
const fixtures = require("./fixtures/attack-lab.js");

function trace(fixture) {
  return traceFixture({ ...fixture, wallet: fixture.buyer, creator: fixtures.creator, buyTs: fixtures.buyTs, buyCost: fixtures.buyCost });
}

test("offline fixtures produce the three funding and vesting findings", () => {
  assert.equal(trace(fixtures.exchange).verdict, "unlinked");

  const direct = trace(fixtures.direct);
  assert.equal(direct.verdict, "linked");
  assert.deepEqual(direct.path.map((edge) => edge.tx), ["DIRECT-01"]);

  const twoHop = trace(fixtures.twoHop);
  assert.equal(twoHop.verdict, "linked");
  assert.deepEqual(twoHop.path.map((edge) => edge.tx), ["HOP-01", "HOP-02"]);

  assert.equal(challengeVerdict(fixtures.vesting.transfer.ts, fixtures.vesting.vestEndTs), "not-challengeable");
});

test("relabeling the exchange transfer as creator-funded flips the computed verdict", () => {
  const mutated = structuredClone(fixtures.exchange);
  for (const tx of mutated.txs) {
    for (const receipt of tx.receipts) receipt.receipt.predecessor_id = fixtures.creator;
  }
  assert.equal(trace(fixtures.exchange).verdict, "unlinked");
  assert.equal(trace(mutated).verdict, "linked");
  assert.deepEqual(trace(mutated).path.map((edge) => edge.tx), ["EXCHANGE-01"]);
});
