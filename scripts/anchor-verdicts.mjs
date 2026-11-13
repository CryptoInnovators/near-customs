// Anchors the verdict of every stored check on the testnet gate (customs27-gate.testnet) as the Customs oracle account,
// and records each anchor transaction in web/data/anchors.json so the page can link it. A launch whose anchored verdict already
// matches is skipped. The oracle key is read from near-cli's credentials file and is never printed.
// node scripts/anchor-verdicts.mjs
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { callFunction } from "../near-tx.mjs";

const GATE = "customs27-gate.testnet", ORACLE = "customs27-oracle.testnet", RPC = ["https://rpc.testnet.fastnear.com"];
const { verdictOf } = createRequire(import.meta.url)("../web/verdict.js");
const read = async (f) => JSON.parse(await readFile(new URL("../web/data/" + f, import.meta.url), "utf8").catch(() => "null"));
const items = [...[await read("replay.json")].filter(Boolean), ...((await read("verdicts.json"))?.items || [])];
const anchors = (await read("anchors.json")) || {};
const key = JSON.parse(await readFile(`${homedir()}/.near-credentials/testnet/${ORACLE}.json`, "utf8")).private_key;

async function onchain(token) {
  const r = await fetch(RPC[0], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: GATE, method_name: "verdict_of", args_base64: Buffer.from(JSON.stringify({ token })).toString("base64") } }) });
  const j = await r.json();
  return j.result?.result ? JSON.parse(Buffer.from(j.result.result).toString()) : null;
}

for (const x of items) {
  if (!x.complete || !x.buyers) continue;
  const v = verdictOf(x.buyers.map((b) => ({ near: b.near, status: b.status })));
  if (!v) continue;
  const have = await onchain(x.token);
  if (have && have.verdict === v.kind && anchors[x.token]) continue;
  const evidence = createHash("sha256").update(JSON.stringify({ token: x.token, creator: x.creator, buyers: x.buyers })).digest("hex");
  const args = { token: x.token, verdict: v.kind, reason: v.reasons.join(" "), buyers: v.buyers, funded: v.funded, evidence };
  const { hash, outcome } = await callFunction({ rpcUrl: RPC, signerId: ORACLE, secretKey: key, receiverId: GATE, method: "anchor", args });
  if (outcome.status?.Failure) throw Error("anchor failed for " + x.token + ": " + JSON.stringify(outcome.status.Failure).slice(0, 200));
  anchors[x.token] = { tx: hash, verdict: v.kind, evidence };
  await writeFile(new URL("../web/data/anchors.json", import.meta.url), JSON.stringify(anchors, null, 2) + "\n");
  console.log(`ANCHORED ${x.token} ${v.kind} ${hash}`);
}
console.log(JSON.stringify({ anchored: Object.keys(anchors).length }));
