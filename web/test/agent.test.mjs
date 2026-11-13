import assert from "node:assert/strict";
import { test } from "node:test";
import { agentBuy, readOutcome, AMOUNT, GATE } from "../../agent.mjs";
import { b58decode, b58encode, encodeTx, functionCallAction } from "../../near-tx.mjs";

const req = (body) => new Request("https://x/agent/buy", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const env = { AGENT_KEY: JSON.stringify({ account_id: "agent.testnet", secret_key: "ed25519:unused" }) };
const refused = { status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: BLOCK: Creator money paid 1 of 2 opening buyers. The gate releases nothing." } } } } } };

test("a BLOCK panic reads as refused with the gate's reason, a clean outcome as cleared", () => {
  assert.deepEqual(readOutcome(refused), { status: "refused", reason: "BLOCK: Creator money paid 1 of 2 opening buyers. The gate releases nothing." });
  assert.equal(readOutcome({ status: { SuccessValue: "" } }).status, "cleared");
  assert.equal(readOutcome({ status: { Failure: { ActionError: { kind: "LackBalanceForState" } } } }).status, "failed");
});

test("the agent endpoint rejects a bad token, calls the gate's buy with the fixed amount, and rate limits a burst", async () => {
  const calls = [];
  const send = async (c) => { calls.push(c); return { hash: "H1", outcome: refused }; };
  let t = 1_000_000;
  const now = () => t;
  assert.equal((await agentBuy(req({ token: "Bad Token!" }), env, send, now)).status, 400);
  assert.equal((await agentBuy(req("not json"), env, send, now)).status, 400);
  assert.equal((await agentBuy(req({ token: "a.near" }), {}, send, now)).status, 503);
  assert.equal(calls.length, 0);
  t += 10_000;
  const ok = await agentBuy(req({ token: "customs26-token.testnet" }), env, send, now);
  const body = await ok.json();
  assert.equal(ok.status, 200);
  assert.equal(body.status, "refused");
  assert.equal(body.tx, "H1");
  assert.equal(calls[0].receiverId, GATE);
  assert.equal(calls[0].method, "buy");
  assert.deepEqual(calls[0].args, { token: "customs26-token.testnet", amount: AMOUNT.toString() });
  assert.equal((await agentBuy(req({ token: "customs26-token.testnet" }), env, send, now)).status, 429);
  assert.equal(calls.length, 1);
});

test("transaction encoding: base58 round-trips and a function call lays out tag, method, args, gas, deposit", () => {
  const raw = Uint8Array.from({ length: 33 }, (_, i) => (i * 37) % 256);
  assert.deepEqual(b58decode(b58encode(raw)), raw);
  const a = functionCallAction("buy", { token: "t" }, 30_000_000_000_000n, 0n);
  assert.equal(a[0], 2);
  assert.equal(a.length, 1 + 4 + 3 + 4 + '{"token":"t"}'.length + 8 + 16);
  const tx = encodeTx({ signerId: "a.testnet", publicKey: new Uint8Array(32), nonce: 5n, receiverId: "g.testnet", blockHash: new Uint8Array(32), actions: [a] });
  assert.equal(tx.length, 4 + 9 + 33 + 8 + 4 + 9 + 32 + 4 + a.length);
});
