// POST /agent/buy {token}: a testnet agent whose only key can call `buy` on the Customs gate. The visitor needs no wallet;
// the key lives in the AGENT_KEY secret (JSON {account_id, secret_key}). The gate decides: it releases 0.01 testnet NEAR on an
// anchored ALLOW and panics, moving nothing, on WARN, BLOCK or no verdict. The response carries the transaction hash; the page
// re-reads that transaction from the chain itself and shows what the chain says.
import { callFunction } from "./near-tx.mjs";

export const GATE = "customs27-gate.testnet";
export const AMOUNT = 10n ** 22n;
const RPC = ["https://rpc.testnet.fastnear.com"];
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
