// POST /agent/buy {token}: a testnet agent whose only key can call `buy` on the Customs gate. The visitor needs no wallet;
// the key lives in the AGENT_KEY secret (JSON {account_id, secret_key}). The gate decides: it releases 0.01 testnet NEAR on an
// anchored ALLOW and panics, moving nothing, on WARN, BLOCK or no verdict. The response carries the transaction hash; the page
// re-reads that transaction from the chain itself and shows what the chain says.
import { callFunction, rpc } from "./near-tx.mjs";

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
export async function stampBreak(request, env, send = callFunction, now = Date.now, view = (id, method, args, deadline) => rpc(RPC, "query", { request_type: "call_function", finality: "final", account_id: id, method_name: method, args_base64: btoa(JSON.stringify(args)) }, deadline)) {
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
