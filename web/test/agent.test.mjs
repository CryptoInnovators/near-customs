import assert from "node:assert/strict";
import { test } from "node:test";
import { agentBuy, huntInject, readOutcome, AMOUNT, GATE } from "../../agent.mjs";
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
  assert.deepEqual(await r.json(), { tx: "F1", signer: "filer.testnet", stamp: "customs28-stamp.testnet", status: "filed", challenge_id: 7 });
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

test("a stamp slot with no key on the host is refused and the named slot's own key signs", async () => {
  const calls = [];
  const send = async (c) => { calls.push(c); return { hash: "F3", outcome: filedOutcome }; };
  const env = { FILER_KEY: JSON.stringify([{ stamp: "customs28-stamp.testnet", account_id: "f28.testnet", secret_key: "ed25519:a" }, { stamp: "customs29-stamp.testnet", account_id: "f29.testnet", secret_key: "ed25519:b" }]) };
  const post = (b, now) => stampBreak(new Request("https://x/stamp/break", { method: "POST", body: JSON.stringify({ launch: "a.testnet", wallet: "b.testnet", path: [H, H], ...b }) }), env, send, () => now, view);
  assert.equal((await post({ stamp: "customs99-stamp.testnet" }, 200_000_000)).status, 400);
  assert.equal(calls.length, 0);
  const r = await post({ stamp: "customs29-stamp.testnet" }, 300_000_000);
  assert.equal((await r.json()).signer, "f29.testnet");
  assert.equal(calls[0].receiverId, "customs29-stamp.testnet");
});

test("a filing the chain does not confirm inside the deadline returns 504 with the tx hash and frees the key for a retry", async () => {
  let t = 400_000_000;
  const now = () => t;
  let seen;
  const send = async (c) => { seen = c; t += 41_000; throw Object.assign(new Error("not final"), { tx: "LATE1" }); };
  const post = () => stampBreak(new Request("https://x/stamp/break", { method: "POST", body: JSON.stringify({ launch: "a.testnet", wallet: "b.testnet", path: [H, H] }) }), fenv, send, now, view);
  const r = await post();
  assert.equal(r.status, 504);
  const body = await r.json();
  assert.match(body.error, /longer than 40 s/);
  assert.equal(body.tx, "LATE1");
  assert.equal(seen.deadline, 400_040_000);
  assert.notEqual((await post()).status, 429);
});

test("rpc stops at its deadline instead of retrying past it", async () => {
  const { rpc } = await import("../../near-tx.mjs");
  await assert.rejects(rpc("https://127.0.0.1:1", "block", {}, 0, () => 1), /deadline reached/);
});

test("the filing returns as soon as the challenge_filed event exists, without waiting for the enclave's yielded receipts", async () => {
  let seen;
  const send = async (c) => { seen = c; return { hash: "E1", outcome: { ...filedOutcome, status: { Started: {} } } }; };
  const r = await stampBreak(new Request("https://x/stamp/break", { method: "POST", body: JSON.stringify({ launch: "a.testnet", wallet: "b.testnet", path: [H, H] }) }), fenv, send, () => 500_000_000, view);
  assert.equal((await r.json()).status, "filed");
  assert.equal(seen.early(filedOutcome), true);
  assert.equal(seen.early({ receipts_outcome: [{ outcome: { logs: [] } }] }), false);
});

test("the injected hunter signs three forbidden actions and each refusal is the protocol's own words", async () => {
  const sent = [];
  const send = async (c) => { sent.push(c); throw Error('send_tx: {"TxExecutionError":{"InvalidTxError":{"InvalidAccessKeyError":{"MethodNameMismatch":{"method_name":"x"}}}}}'); };
  const r = await huntInject(new Request("https://x/hunt/inject", { method: "POST", body: "{}" }), fenv, send, () => 50_000_000);
  const body = await r.json();
  assert.deepEqual(body.attempts.map((a) => a.action), ["release_stamp", "withdraw_credit", "transfer"]);
  assert.ok(body.attempts.every((a) => a.status === "refused" && /MethodNameMismatch/.test(a.reason)));
  assert.ok(sent.every((c) => c.once === true), "one broadcast each");
});

test("a key that is too wide is reported as executed, never as refused", async () => {
  const send = async () => ({ hash: "T9", outcome: { status: { SuccessValue: "" } } });
  const body = await (await huntInject(new Request("https://x/hunt/inject", { method: "POST", body: "{}" }), fenv, send, () => 60_000_000)).json();
  assert.ok(body.attempts.every((a) => a.status === "executed" && a.tx === "T9"));
});

test("a node that did not answer is reported as unanswered, not as a refusal", async () => {
  const send = async () => { throw Error("send_tx: deadline reached"); };
  const body = await (await huntInject(new Request("https://x/hunt/inject", { method: "POST", body: "{}" }), fenv, send, () => 70_000_000)).json();
  assert.ok(body.attempts.every((a) => a.status === "unanswered"));
});

test("filing is refused before any bond moves when the host does not serve the pinned checker module", async () => {
  const calls = [];
  const send = async (c) => { calls.push(c); return { hash: "F2", outcome: filedOutcome }; };
  const withUrl = async () => ({ result: Array.from(new TextEncoder().encode(JSON.stringify({ min_bond: "100000000000000000000000", module_url: "https://host.example/checker.wasm" }))) });
  let t = 700_000_000;
  const post = (probe) => stampBreak(new Request("https://x/stamp/break", { method: "POST", body: JSON.stringify({ launch: "a.testnet", wallet: "b.testnet", path: [H, H] }) }), fenv, send, () => t, withUrl, probe);
  const gone = await post(async () => 404);
  assert.equal(gone.status, 503);
  const body = await gone.json();
  assert.equal(body.status, "unavailable");
  assert.match(body.error, /HTTP 404/);
  assert.equal(calls.length, 0);
  assert.equal((await post(async () => { throw Error("network"); })).status, 503);
  assert.equal(calls.length, 0);
  const served = await post(async () => 200);
  assert.equal((await served.json()).status, "filed");
  assert.equal(calls.length, 1);
});

test("filing is refused before any transaction when the hunter's filing credit is below bond + exec_fee", async () => {
  const calls = [];
  const send = async (c) => { calls.push(c); return { hash: "F3", outcome: filedOutcome }; };
  const enc = (v) => ({ result: Array.from(new TextEncoder().encode(JSON.stringify(v))) });
  let credit = "100000000000000000000000";
  const creditView = async (_id, method) => enc(method === "credit_of" ? credit : { min_bond: "100000000000000000000000", exec_fee: "100000000000000000000000" });
  let t = 800_000_000;
  const post = () => stampBreak(new Request("https://x/stamp/break", { method: "POST", body: JSON.stringify({ launch: "a.testnet", wallet: "b.testnet", path: [H, H] }) }), fenv, send, () => (t += 10_000_000), creditView, async () => 200);
  const drained = await post();
  assert.equal(drained.status, 503);
  const body = await drained.json();
  assert.equal(body.status, "unavailable");
  assert.equal(body.reason, "credit");
  assert.equal(calls.length, 0);
  credit = "200000000000000000000000";
  assert.equal((await (await post()).json()).status, "filed");
  assert.equal(calls.length, 1);
});

/* ---------------------------------------------------------------- the late-verdict relay */
import { stampRelay, findAnswers } from "../../agent.mjs";

const relayEnv = { RELAY_KEY: JSON.stringify([{ stamp: "s1.testnet", account_id: "relay.testnet", secret_key: "ed25519:unused" }]) };
const relayReq = (b) => new Request("https://x/stamp/relay", { method: "POST", body: JSON.stringify(b) });
const chain = (state, created = 1000, head = 1400) => async () => ({ block_height: head, result: [...new TextEncoder().encode(JSON.stringify({ launch: "l.testnet", wallet: "w.testnet", path_hash: "ph", created_block: created, state }))] });
const answer = { op: "verify_funding_path", token: "l.testnet", wallet: "w.testnet", challenge_id: 3, path_hash: "ph", block: 1000, verdict: "upheld", sig: "S", reason: null, hub_list: { version: 1 } };

test("the relay hands the enclave's late answer to late_verdict with only the verdict fields, and reports the transaction", async () => {
  const calls = [];
  const send = async (c) => { calls.push(c); return { hash: "R1", outcome: { status: { SuccessValue: "" }, receipts_outcome: [] } }; };
  const r = await (await stampRelay(relayReq({ stamp: "s1.testnet", challenge_id: 3 }), relayEnv, send, () => 5_000_000, chain("Unanswered"), async () => [answer])).json();
  assert.equal(r.status, "relayed");
  assert.equal(r.tx, "R1");
  assert.equal(calls[0].receiverId, "s1.testnet");
  assert.equal(calls[0].method, "late_verdict");
  assert.deepEqual(calls[0].args, { challenge_id: 3, verdict: { token: "l.testnet", wallet: "w.testnet", challenge_id: 3, path_hash: "ph", verdict: "upheld", block: 1000, sig: "S" } });
});

test("the relay sends nothing while the yield is open, once settled, with no answer on chain, or past the late window", async () => {
  const send = async () => { throw Error("must not send"); };
  const run = (state, find, head, n) => stampRelay(relayReq({ stamp: "s1.testnet", challenge_id: 3 }), relayEnv, send, () => n, chain(state, 1000, head), find).then((r) => r.json());
  assert.equal((await run("Pending", async () => [answer], 1100, 10_000_000)).status, "pending");
  assert.equal((await run({ Upheld: { paid: "1" } }, async () => [answer], 1400, 20_000_000)).status, "settled");
  assert.equal((await run("Unanswered", async () => [], 1400, 30_000_000)).status, "waiting");
  assert.equal((await run("Unanswered", async () => [answer], 2201, 40_000_000)).status, "closed");
});

test("the relay reports the contract's own words when it refuses the answer, and validates its input and key", async () => {
  const send = async () => ({ hash: "R2", outcome: { status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: stamp: verdict signature does not verify against the pinned key" } } } } } } });
  const r = await (await stampRelay(relayReq({ stamp: "s1.testnet", challenge_id: 3 }), relayEnv, send, () => 50_000_000, chain("Unanswered"), async () => [answer])).json();
  assert.equal(r.status, "refused");
  assert.equal(r.reason, "stamp: verdict signature does not verify against the pinned key");
  assert.equal((await stampRelay(relayReq({ stamp: "Bad!", challenge_id: 3 }), relayEnv, send)).status, 400);
  assert.equal((await stampRelay(relayReq({ stamp: "s1.testnet", challenge_id: -1 }), relayEnv, send)).status, 400);
  assert.equal((await stampRelay(relayReq({ stamp: "s1.testnet", challenge_id: 3 }), {}, send)).status, 503);
  assert.equal((await stampRelay(relayReq({ stamp: "other.testnet", challenge_id: 3 }), relayEnv, send)).status, 400);
});

test("findAnswers picks the worker's late answer for this challenge out of other requests' resolves", async () => {
  const resolve = (v) => ({ transaction: { actions: [{ FunctionCall: { method_name: "resolve_execution", args: btoa(JSON.stringify({ request_id: 1, response: { output: { Json: v } } })) } }] } });
  const other = resolve({ ...answer, wallet: "x.testnet" }), mine = resolve(answer), noise = { transaction: { actions: [{ FunctionCall: { method_name: "store_wallet_policy", args: "e30=" } }] } };
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push([url, body]);
    return new Response(JSON.stringify(url.endsWith("/v0/account") ? { account_txs: [{ transaction_hash: "a" }, { transaction_hash: "b" }, { transaction_hash: "c" }] } : { transactions: [other, noise, mine] }));
  };
  try {
    const found = await findAnswers({ launch: "l.testnet", wallet: "w.testnet", path_hash: "ph", created_block: 1000 }, 1400);
    assert.deepEqual(found.map((v) => v.sig), ["S"]);
    assert.equal(seen[0][1].from_tx_block_height, 1180);
    assert.equal(seen[0][1].account_id, "worker.outlayer.testnet");
  } finally { globalThis.fetch = realFetch; }
});
