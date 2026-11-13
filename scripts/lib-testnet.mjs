// Small testnet helpers shared by the stamp scripts: RPC reads with backoff, near-cli credentials, key files.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
export const RPC = ["https://near-testnet.drpc.org", "https://rpc.testnet.fastnear.com"];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function rpc(method, params) {
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch(RPC[0], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (!j.error) return j.result;
      if (!/rate|limit|timeout/i.test(JSON.stringify(j.error))) throw Error(method + ": " + JSON.stringify(j.error).slice(0, 240));
    } catch (e) { if (/^\w+: /.test(e.message) && !/fetch|abort|timeout/i.test(e.message)) throw e; }
    await sleep(2000 * (i + 1));
  }
  throw Error(method + ": rate limited");
}
export async function view(account, method, args = {}) {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return r.result.length ? JSON.parse(Buffer.from(r.result).toString()) : null;
}
const credPath = (id) => `${homedir()}/.near-credentials/testnet/${id}.json`;
export const secretOf = async (id) => JSON.parse(await readFile(credPath(id), "utf8")).private_key;
export async function saveCred(id, publicKey, secretKey) {
  await mkdir(`${homedir()}/.near-credentials/testnet`, { recursive: true });
  await writeFile(credPath(id), JSON.stringify({ account_id: id, public_key: publicKey, private_key: secretKey }), { mode: 0o600 });
}
export const link = (hash) => `https://testnet.nearblocks.io/txns/${hash}`;
