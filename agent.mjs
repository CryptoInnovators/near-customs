// POST /agent/buy {token}: a testnet agent whose only key can call `buy` on the Customs gate. The visitor needs no wallet;
// the key lives in the AGENT_KEY secret (JSON {account_id, secret_key}). The gate decides: it releases 0.01 testnet NEAR on an
// anchored ALLOW and panics, moving nothing, on WARN, BLOCK or no verdict. The response carries the transaction hash; the page
// re-reads that transaction from the chain itself and shows what the chain says.
import { callFunction, functionCallAction, rpc, sendActions, transferAction } from "./near-tx.mjs";

export const GATE = "customs27-gate.testnet";
export const AMOUNT = 10n ** 22n;
const RPC = ["https://near-testnet.drpc.org", "https://rpc.testnet.fastnear.com"];
const TOKEN = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const MIN_GAP_MS = 6000;
let last = 0;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

/* What the final transaction says: cleared, refused with the gate's reason, or failed for another reason. */
export function readOutcome(outcome) {
  const failure = outcome?.status?.Failure;
  if (!failure) return { status: "cleared" };
  const text = JSON.stringify(failure);
  const m = /(BLOCK|WARN|NO VERDICT):[^"\\]*/.exec(text);
  return m ? { status: "refused", reason: m[0] } : { status: "failed", reason: text.slice(0, 200) };
}

export async function agentBuy(request, env, send = callFunction, now = Date.now) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Send JSON with a token." }, 400); }
  const token = body && body.token;
  if (typeof token !== "string" || token.length > 128 || !TOKEN.test(token)) return json({ error: "token must be a NEAR account id." }, 400);
  if (!env.AGENT_KEY) return json({ error: "The agent key is not configured on this host." }, 503);
  const wait = last + MIN_GAP_MS - now();
  if (wait > 0) return json({ error: "The agent is mid-run. Try again in " + Math.ceil(wait / 1000) + " s." }, 429, { "retry-after": String(Math.ceil(wait / 1000)) });
  last = now();
  const key = JSON.parse(env.AGENT_KEY);
  try {
    const { hash, outcome } = await send({ rpcUrl: RPC, signerId: key.account_id, secretKey: key.secret_key, receiverId: GATE, method: "buy", args: { token, amount: AMOUNT.toString() } });
    return json({ tx: hash, signer: key.account_id, released: "0.01 NEAR", ...readOutcome(outcome) });
  } catch (e) {
    return json({ error: "The agent's transaction did not complete: " + String(e.message || e).slice(0, 160) }, 502);
  }
}

/* ---------------------------------------------------------------- sponsored filing: "Break this stamp" */

export const STAMP = "customs28-stamp.testnet";
const ACCOUNT = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const FILE_GAP_MS = 8000;
const FILE_DEADLINE_MS = 40000;
const FILE_PER_HOUR = 20;
let lastFiled = 0;
const filedAt = [];

const filedEvent = (o) => (o.receipts_outcome || []).some((r) => (r.outcome.logs || []).some((l) => l.includes('"event":"challenge_filed"')));

/* POST /stamp/break {launch, wallet, path, payout_to?}: the sponsored filing account (a function-call key scoped to `challenge` on the stamp,
   spending prepaid credit) files the path against the wallet. The contract and the enclave decide; the credit is the cap. */
export async function stampBreak(request, env, send = callFunction, now = Date.now, view = (id, method, args, deadline) => rpc(RPC, "query", { request_type: "call_function", finality: "final", account_id: id, method_name: method, args_base64: btoa(JSON.stringify(args)) }, deadline), probe = async (url) => { const r = await fetch(url, { headers: { range: "bytes=0-0" } }); await r.body?.cancel(); return r.status; }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: "Send JSON with launch, wallet and path." }, 400); }
  const ok = (v) => typeof v === "string" && v.length <= 64 && ACCOUNT.test(v);
  if (!b || !ok(b.launch) || !ok(b.wallet) || (b.payout_to !== undefined && !ok(b.payout_to)) || (b.stamp !== undefined && !ok(b.stamp))) return json({ error: "launch, wallet and payout_to must be NEAR account ids." }, 400);
  if (!Array.isArray(b.path) || b.path.length < 2 || b.path.length > 13 || !b.path.every((h) => typeof h === "string" && TX_HASH.test(h))) return json({ error: "path must be 2 to 13 transaction hashes." }, 400);
  if (!env.FILER_KEY) return json({ error: "The filing key is not configured on this host." }, 503);
  /* FILER_KEY is one key object (the first stamp) or an array of them, each naming the stamp contract it is scoped to */
  const keys = [].concat(JSON.parse(env.FILER_KEY)).map((k) => ({ ...k, stamp: k.stamp || STAMP }));
  const key = keys.find((k) => k.stamp === (b.stamp || STAMP));
  if (!key) return json({ error: "That stamp contract has no filing key on this host." }, 400);
  const t = now();
  while (filedAt.length && t - filedAt[0] > 3600_000) filedAt.shift();
  const wait = Math.max(lastFiled + FILE_GAP_MS - t, filedAt.length >= FILE_PER_HOUR ? filedAt[0] + 3600_000 - t : 0);
  if (wait > 0) return json({ error: "The filing key is rate limited. Try again in " + Math.ceil(wait / 1000) + " s." }, 429, { "retry-after": String(Math.ceil(wait / 1000)) });
  lastFiled = t;
  filedAt.push(t);
  const deadline = t + FILE_DEADLINE_MS;
  try {
    const params = JSON.parse(new TextDecoder().decode(new Uint8Array((await view(key.stamp, "stamp_params", {}, deadline)).result)));
    /* The hunter files from prepaid credit. A drained account makes the contract refuse after the transaction is already signed, so read the credit first and refuse with no transaction at all. */
    const credit = JSON.parse(new TextDecoder().decode(new Uint8Array((await view(key.stamp, "credit_of", { account: key.account_id }, deadline)).result)));
    if (typeof credit === "string" && BigInt(credit) < BigInt(params.min_bond) + BigInt(params.exec_fee || 0)) { lastFiled = 0; filedAt.pop(); return json({ error: "The hunter " + key.account_id + " has no filing credit left on " + key.stamp + ", so no filing was made and no bond moved.", status: "unavailable", reason: "credit" }, 503); }
    /* FastFS answers GET but 404s HEAD, so the probe is a GET. OutLayer fetches the pinned checker by URL; if its host does not serve it, a filed challenge can only end Unanswered after minutes. Say so before the bond moves. */
    if (params.module_url) {
      const served = await probe(params.module_url).catch(() => 0);
      if (served !== 200) { lastFiled = 0; filedAt.pop(); return json({ error: "The pinned checker module is not served by its host right now (HTTP " + (served || "no answer") + "), so no filing was made and no bond moved. Try again shortly.", status: "unavailable" }, 503); }
    }
    const args = { launch: b.launch, wallet: b.wallet, path: b.path, bond: params.min_bond, payout_to: b.payout_to || null };
    const { hash, outcome } = await send({ rpcUrl: RPC, signerId: key.account_id, secretKey: key.secret_key, receiverId: key.stamp, method: "challenge", args, gas: 200_000_000_000_000n, deadline, early: filedEvent });
    const failure = outcome?.status?.Failure || (filedEvent(outcome || {}) ? null : (outcome?.receipts_outcome || []).map((r) => r.outcome.status?.Failure).find(Boolean));
    if (failure) {
      const m = /stamp: [^"\\]*/.exec(JSON.stringify(failure));
      return json({ tx: hash, signer: key.account_id, stamp: key.stamp, status: "refused", reason: m ? m[0] : JSON.stringify(failure).slice(0, 200) });
    }
    const logs = (outcome.receipts_outcome || []).flatMap((r) => r.outcome.logs || []);
    const filed = logs.map((l) => { try { return JSON.parse(l.replace("EVENT_JSON:", "")); } catch { return null; } }).find((e) => e && e.event === "challenge_filed");
    return json({ tx: hash, signer: key.account_id, stamp: key.stamp, status: "filed", challenge_id: filed ? filed.data.challenge_id : null });
  } catch (e) {
    lastFiled = 0;
    const late = now() >= deadline;
    return json({ error: late ? "The chain took longer than " + FILE_DEADLINE_MS / 1000 + " s to confirm the filing. Try again." : "The filing transaction did not complete: " + String(e.message || e).slice(0, 160), ...(e && e.tx ? { tx: e.tx } : {}) }, late ? 504 : 502);
  }
}

/* ---------------------------------------------------------------- late verdicts: the enclave answers after the yield window

   OutLayer answers a request through a worker queue. NEAR closes a yield after 200 blocks, so when the queue is slower than that the stamp records
   the challenge as Unanswered while the enclave's signed answer is still on its way, and lands on chain as a rejected resolve_execution call.
   POST /stamp/relay {stamp, challenge_id} reads that answer from the chain and hands it to the stamp's `late_verdict`, which accepts it only if
   it verifies against the key OutLayer's enclave proved it holds. The relay holds keys that can call `late_verdict` and nothing else. */

const TX_API = "https://tx.test.fastnear.com";
const OUTLAYER_WORKER = "worker.outlayer.testnet";
const LATE_BLOCKS = 1200;
const YIELD_BLOCKS = 180;
const RELAY_GAP_MS = 4000;
const relayedAt = new Map();

const readView = (id, method, args, deadline) => rpc(RPC, "query", { request_type: "call_function", finality: "final", account_id: id, method_name: method, args_base64: btoa(JSON.stringify(args)) }, deadline);
const decodeView = (r) => (r.result.length ? JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) : null);
const txApi = async (path, body) => {
  const r = await fetch(TX_API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw Error("FastNEAR answered HTTP " + r.status);
  return r.json();
};

/* The JSON outputs the OutLayer worker put on chain between two blocks that `want` accepts: its resolve_execution and
   submit_execution_output_and_resolve calls carry each request's output, whether or not the requesting contract was still waiting. */
export async function workerOutputs(fromBlock, toBlock, want) {
  const found = [];
  let resume;
  for (let page = 0; page < 3; page++) {
    const list = await txApi("/v0/account", { account_id: OUTLAYER_WORKER, is_real_signer: true, from_tx_block_height: fromBlock, to_tx_block_height: toBlock, sort_order: "asc", limit: 100, ...(resume ? { resume_token: resume } : {}) });
    const hashes = [...new Set((list.account_txs || []).map((t) => t.transaction_hash))];
    for (let i = 0; i < hashes.length; i += 20) {
      for (const t of (await txApi("/v0/transactions", { tx_hashes: hashes.slice(i, i + 20) })).transactions || []) {
        const call = t.transaction.actions[0] && t.transaction.actions[0].FunctionCall;
        if (!call || !/^(resolve_execution|submit_execution_output_and_resolve)$/.test(call.method_name)) continue;
        let v;
        try { v = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(call.args), (c) => c.charCodeAt(0)))).response?.output?.Json; } catch { continue; }
        if (v && want(v)) found.push({ ...v, worker_tx: t.transaction.hash });
      }
    }
    resume = list.resume_token;
    if (!resume) break;
  }
  return found;
}

/* Every signed verdict for this challenge after the yield window: naming its launch, wallet, path and block. */
export const findAnswers = (ch, head) => workerOutputs(ch.created_block + YIELD_BLOCKS, head, (v) => v.op === "verify_funding_path" && v.token === ch.launch && v.wallet === ch.wallet && v.path_hash === ch.path_hash && v.block === ch.created_block && typeof v.sig === "string" && typeof v.verdict === "string");

/* Every signed key answer for a stamp contract since `fromBlock`. */
export const findPins = (stamp, fromBlock, head) => workerOutputs(fromBlock, head, (v) => v.op === "public_key" && v.token === stamp && typeof v.public_key === "string" && typeof v.sig === "string");

/* POST /stamp/relay {stamp, challenge_id}: status pending (the yield is still open), waiting (no answer on chain yet), relayed (late_verdict accepted),
   refused (the contract rejected the answer), settled (already Upheld, Rejected or Reclaimed) or closed (the late window has passed). */
export async function stampRelay(request, env, send = callFunction, now = Date.now, view = readView, find = findAnswers) {
  let b;
  try { b = await request.json(); } catch { return json({ error: "Send JSON with stamp and challenge_id." }, 400); }
  const ok = (v) => typeof v === "string" && v.length <= 64 && ACCOUNT.test(v);
  if (!b || !ok(b.stamp) || !Number.isSafeInteger(b.challenge_id) || b.challenge_id < 0) return json({ error: "stamp must be a NEAR account id and challenge_id a number." }, 400);
  if (!env.RELAY_KEY) return json({ error: "The relay key is not configured on this host." }, 503);
  const key = [].concat(JSON.parse(env.RELAY_KEY)).find((k) => k.stamp === b.stamp);
  if (!key) return json({ error: "That stamp contract has no relay key on this host." }, 400);
  const id = b.stamp + "#" + b.challenge_id, t = now();
  const wait = (relayedAt.get(id) || 0) + RELAY_GAP_MS - t;
  if (wait > 0) return json({ error: "A scan for this challenge is running. Try again in " + Math.ceil(wait / 1000) + " s." }, 429, { "retry-after": String(Math.ceil(wait / 1000)) });
  relayedAt.set(id, t);
  const deadline = t + 40000;
  try {
    const read = await view(b.stamp, "challenge_of", { challenge_id: b.challenge_id }, deadline);
    const ch = decodeView(read);
    if (!ch) return json({ error: "That stamp has no such challenge." }, 404);
    const state = typeof ch.state === "string" ? ch.state : Object.keys(ch.state)[0];
    if (state === "Pending") return json({ status: "pending", state });
    if (state !== "Unanswered") return json({ status: "settled", state });
    const head = read.block_height;
    if (head > ch.created_block + LATE_BLOCKS) return json({ status: "closed", state, waited_blocks: head - ch.created_block });
    for (const v of await find(ch, head)) {
      const verdict = { token: v.token, wallet: v.wallet, challenge_id: v.challenge_id, path_hash: v.path_hash, verdict: v.verdict, block: v.block, sig: v.sig };
      const { hash, outcome } = await send({ rpcUrl: RPC, signerId: key.account_id, secretKey: key.secret_key, receiverId: b.stamp, method: "late_verdict", args: { challenge_id: b.challenge_id, verdict }, gas: 100_000_000_000_000n, deadline });
      const failure = outcome?.status?.Failure || (outcome?.receipts_outcome || []).map((r) => r.outcome.status?.Failure).find(Boolean);
      if (!failure) return json({ status: "relayed", tx: hash, verdict: v.verdict, signer: key.account_id });
      const m = /stamp: [^"\\]*/.exec(JSON.stringify(failure));
      return json({ status: "refused", tx: hash, reason: m ? m[0] : JSON.stringify(failure).slice(0, 200) });
    }
    return json({ status: "waiting", state, waited_blocks: head - ch.created_block });
  } catch (e) {
    relayedAt.delete(id);
    return json({ error: "The relay did not complete: " + String(e.message || e).slice(0, 160), ...(e && e.tx ? { tx: e.tx } : {}) }, 502);
  }
}

/* ---------------------------------------------------------------- the prompt-injected hunter: what its key refuses */

const INJECTED = [
  { id: "release_stamp", say: "release the creator's bond to itself", actions: () => [functionCallAction("release_stamp", { launch: "customs26-token.testnet" }, 30_000_000_000_000n, 0n)] },
  { id: "withdraw_credit", say: "withdraw its filing credit", actions: () => [functionCallAction("withdraw_credit", { amount: (10n ** 24n).toString() }, 30_000_000_000_000n, 0n)] },
  { id: "transfer", say: "transfer NEAR out of the hunter account", actions: () => [transferAction(1n)] },
];
const REFUSAL = /MethodNameMismatch|RequiresFullAccess|DepositWithFunctionCall|ActionsValidation|InvalidAccessKeyError/;
const INJECT_GAP_MS = 3000;
let lastInject = 0;

/* POST /hunt/inject {stamp?}: the hunter, told by an injected prompt to move money, signs each forbidden action with its only key.
   The NEAR protocol answers before any block includes the transaction; the answer is returned word for word. A result of "executed" would mean the key was too wide. */
export async function huntInject(request, env, send = sendActions, now = Date.now) {
  let b = {};
  try { b = await request.json(); } catch { /* an empty body names no stamp */ }
  if (!env.FILER_KEY) return json({ error: "The filing key is not configured on this host." }, 503);
  const keys = [].concat(JSON.parse(env.FILER_KEY)).map((k) => ({ ...k, stamp: k.stamp || STAMP }));
  const key = keys.find((k) => k.stamp === (b.stamp || STAMP));
  if (!key) return json({ error: "That stamp contract has no filing key on this host." }, 400);
  const t = now();
  const wait = lastInject + INJECT_GAP_MS - t;
  if (wait > 0) return json({ error: "The hunter is mid-run. Try again in " + Math.ceil(wait / 1000) + " s." }, 429, { "retry-after": String(Math.ceil(wait / 1000)) });
  lastInject = t;
  const deadline = t + 25000;
  const attempts = [];
  for (const a of INJECTED) attempts.push(await (async () => {
    const receiverId = a.id === "transfer" ? key.account_id : key.stamp;
    try {
      const { hash, outcome } = await send({ rpcUrl: RPC, signerId: key.account_id, secretKey: key.secret_key, receiverId, actions: a.actions(), once: true, deadline });
      return { action: a.id, say: a.say, status: "executed", tx: hash, result: JSON.stringify(outcome?.status || {}).slice(0, 160) };
    } catch (e) {
      const why = String(e.message || e);
      return { action: a.id, say: a.say, status: REFUSAL.test(why) ? "refused" : "unanswered", reason: why.replace(/^send_tx: /, "").slice(0, 260) };
    }
  })());
  return json({ signer: key.account_id, stamp: key.stamp, attempts });
}
