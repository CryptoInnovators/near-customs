import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { edgesAll, parseTx } = require("../rule.js");

const raw = JSON.parse(readFileSync(new URL("../../crates/walker/tests/fixtures/intents-withdraw-hx23fz.json", import.meta.url), "utf8"));
const OWNER = "d9eade234d867aa002539c484ed0dc808bdc5a0ccea6756a1ebfec0c0df9325a";

test("the recorded Intents withdrawal names its owner", () => {
  const edges = edgesAll(parseTx(raw));
  const w = edges.filter((e) => e.kind === "IntentsWithdraw");
  assert.equal(w.length, 1);
  assert.equal(w[0].from, OWNER);
  assert.match(w[0].to, /^c8bde0e9.*1899$/);
  assert.equal(w[0].yocto, 15n * 10n ** 24n);
});

function moveEventTo(account) {
  const forged = structuredClone(raw);
  for (const r of forged.receipts) {
    const logs = r.execution_outcome.outcome.logs;
    if (logs.some((l) => l.includes("native_withdraw"))) r.receipt.receiver_id = account;
  }
  return forged;
}

test("the same log line printed by another contract is not a withdrawal", () => {
  const edges = edgesAll(parseTx(moveEventTo("attacker.near")));
  assert.equal(edges.filter((e) => e.kind === "IntentsWithdraw").length, 0);
});

test("a failed intents.near receipt is not a withdrawal", () => {
  const failed = structuredClone(raw);
  for (const r of failed.receipts) {
    if (r.execution_outcome.outcome.logs.some((l) => l.includes("native_withdraw"))) r.execution_outcome.outcome.status = { Failure: { ActionError: {} } };
  }
  assert.equal(edgesAll(parseTx(failed)).filter((e) => e.kind === "IntentsWithdraw").length, 0);
});
