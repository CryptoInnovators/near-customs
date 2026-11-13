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

import { stampBreak } from "../../agent.mjs";

const H = "23atwS3gdX11c1r7o3UBZK1w7UAuskk7VofmoaZiP5HU";
const fenv = { FILER_KEY: JSON.stringify({ account_id: "filer.testnet", secret_key: "ed25519:unused" }) };
const view = async () => ({ result: Array.from(new TextEncoder().encode(JSON.stringify({ min_bond: "100000000000000000000000" }))) });
const filedOutcome = { receipts_outcome: [{ outcome: { logs: ['EVENT_JSON:{"standard":"customs_stamp","event":"challenge_filed","data":{"challenge_id":7}}'] } }] };

test("sponsored filing validates the path, files the bond from the contract's own min_bond, and reports the challenge id", async () => {
  const calls = [];
  const send = async (c) => { calls.push(c); return { hash: "F1", outcome: filedOutcome }; };
  let t = 5_000_000;
  const now = () => t;
  const post = (b) => stampBreak(new Request("https://x/stamp/break", { method: "POST", body: JSON.stringify(b) }), fenv, send, now, view);
  assert.equal((await post({ launch: "a.testnet", wallet: "b.testnet", path: ["short", H] })).status, 400);
  assert.equal((await post({ launch: "A B", wallet: "b.testnet", path: [H, H] })).status, 400);
  assert.equal(calls.length, 0);
  const r = await post({ launch: "a.testnet", wallet: "b.testnet", path: [H, H], payout_to: "judge.testnet" });
  assert.deepEqual(await r.json(), { tx: "F1", signer: "filer.testnet", status: "filed", challenge_id: 7 });
  assert.equal(calls[0].method, "challenge");
  assert.equal(calls[0].args.bond, "100000000000000000000000");
  assert.equal(calls[0].args.payout_to, "judge.testnet");
  assert.equal((await post({ launch: "a.testnet", wallet: "b.testnet", path: [H, H] })).status, 429);
});

test("a challenge the contract refuses is reported as refused with the contract's words", async () => {
  const send = async () => ({ hash: "F2", outcome: { status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: stamp: the filing credit is below bond + exec_fee" } } } } } } });
  const r = await stampBreak(new Request("https://x/stamp/break", { method: "POST", body: JSON.stringify({ launch: "a.testnet", wallet: "b.testnet", path: [H, H] }) }), fenv, send, () => 99_000_000, view);
  const body = await r.json();
  assert.equal(body.status, "refused");
  assert.match(body.reason, /^stamp: the filing credit is below bond \+ exec_fee/);
});
