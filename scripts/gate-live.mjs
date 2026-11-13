// Live proof on NEAR testnet, no mocks. The agent (customs27-agent.testnet, a function-call key limited to `buy` on the gate) buys:
//   1. an ALLOW launch      -> the transaction is final, succeeded, and the venue's balance rose by exactly the amount
//   2. a BLOCK launch       -> the transaction is final, FAILED with the gate's BLOCK reason, and the venue's balance did not move
//   3. a launch with no verdict -> final, failed with NO VERDICT, balance unchanged
// Each run polls to FINAL and asserts a post-condition only completion can produce. Exits 1 if any assertion fails.
// node scripts/gate-live.mjs [allowToken] [blockToken]   (agent key: ~/.config/customs/agent-key.json)
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { callFunction } from "../near-tx.mjs";
import { AMOUNT, GATE, readOutcome } from "../agent.mjs";

const RPC = ["https://rpc.testnet.fastnear.com"], VENUE = "customs27-venue.testnet";
const [allow = "batman-4.nearlytrade.near", block = "customs26-token.testnet"] = process.argv.slice(2);
const key = JSON.parse(await readFile(`${homedir()}/.config/customs/agent-key.json`, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(RPC[0], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = await r.json();
    if (!j.error) return j.result;
    if (!/rate|limit/i.test(JSON.stringify(j.error))) throw Error(method + ": " + JSON.stringify(j.error).slice(0, 200));
    await sleep(1500 * (i + 1));
  }
  throw Error(method + ": rate limited");
}
const venue = async () => BigInt((await rpc("query", { request_type: "view_account", finality: "final", account_id: VENUE })).amount);
const verdict = async (token) => {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id: GATE, method_name: "verdict_of", args_base64: Buffer.from(JSON.stringify({ token })).toString("base64") });
  return r.result?.length ? JSON.parse(Buffer.from(r.result).toString()) : null;
};

const results = [];
async function run(label, token, expect, reasonPrefix) {
  const anchored = await verdict(token);
  const before = await venue();
  const { hash, outcome } = await callFunction({ rpcUrl: RPC, signerId: key.account_id, secretKey: key.secret_key, receiverId: GATE, method: "buy", args: { token, amount: AMOUNT.toString() } });
  const final = await rpc("tx", { tx_hash: hash, sender_account_id: key.account_id, wait_until: "FINAL" });
  if (final.final_execution_status !== "FINAL") throw Error(label + ": transaction not FINAL");
  await sleep(2500);
  const after = await venue();
  const read = readOutcome(final);
  const moved = after - before;
  const ok = read.status === expect && (expect === "cleared" ? moved === AMOUNT : moved === 0n) && (!reasonPrefix || (read.reason || "").startsWith(reasonPrefix));
  results.push({ label, token, anchored: anchored && anchored.verdict, status: read.status, reason: read.reason || "", moved: moved.toString(), tx: hash, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${token} anchored=${anchored ? anchored.verdict : "none"} -> ${read.status}${read.reason ? " (" + read.reason + ")" : ""}, venue moved ${moved} yocto, https://testnet.nearblocks.io/txns/${hash}`);
}

await run("success: ALLOW is cleared", allow, "cleared");
await run("must-fail: BLOCK is refused", block, "refused", "BLOCK:");
await run("must-fail: no verdict is refused", "never-anchored-launch.nearlytrade.near", "refused", "NO VERDICT:");
if (results.some((r) => !r.ok)) process.exit(1);
