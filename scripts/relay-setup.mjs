// Creates the relay account that delivers the enclave's late signed answers (stamp `late_verdict`) and gives it one function-call key
// per stamp, each scoped to `late_verdict` on that stamp. The account's full-access key stays in ~/.near-credentials; only the
// function-call keys go to ~/.config/customs/relay-key.json (mode 600, for `wrangler secret put RELAY_KEY`). Nothing secret is printed.
// SLOTS="32 34" node scripts/relay-setup.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { addFunctionCallKeyAction, functionCallAction, newKeyPair, sendActions } from "../near-tx.mjs";
import { RPC, rpc, secretOf, saveCred, link } from "./lib-testnet.mjs";

const RELAY = "customs-relay.testnet", FUNDER = process.env.FUNDER || "customs34-fund.testnet";
const NEAR = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
const slots = (process.env.SLOTS || "").split(/\s+/).filter(Boolean);
if (!slots.length) throw Error("SLOTS names the stamp slots, e.g. SLOTS='32 34'");
const as = (signerId, receiverId, actions) => secretOf(signerId).then((secretKey) => sendActions({ rpcUrl: RPC, signerId, secretKey, receiverId, actions }));
const exists = (id) => rpc("query", { request_type: "view_account", finality: "final", account_id: id }).then(() => true, () => false);

if (!(await exists(RELAY))) {
  const kp = await newKeyPair();
  await saveCred(RELAY, kp.publicKeyStr, kp.secretKey);
  const r = await as(FUNDER, "testnet", [functionCallAction("create_account", { new_account_id: RELAY, new_public_key: kp.publicKeyStr }, 60_000_000_000_000n, NEAR(1.5))]);
  console.log("created", RELAY, link(r.hash));
}
const file = `${homedir()}/.config/customs/relay-key.json`;
const have = await readFile(file, "utf8").then((t) => JSON.parse(t), () => []);
const full = await secretOf(RELAY);
for (const n of slots) {
  const stamp = `customs${n}-stamp.testnet`;
  if (have.some((k) => k.stamp === stamp)) continue;
  const fc = await newKeyPair();
  const r = await sendActions({ rpcUrl: RPC, signerId: RELAY, secretKey: full, receiverId: RELAY, actions: [addFunctionCallKeyAction(fc.publicKey, stamp, ["late_verdict"], NEAR(0.25))] });
  if (r.outcome.status?.Failure) throw Error("add key failed for " + stamp);
  have.push({ stamp, account_id: RELAY, public_key: fc.publicKeyStr, secret_key: fc.secretKey });
  await mkdir(`${homedir()}/.config/customs`, { recursive: true });
  await writeFile(file, JSON.stringify(have), { mode: 0o600 });
  console.log("key for", stamp, link(r.hash));
}
console.log("relay keys written to ~/.config/customs/relay-key.json for", have.map((k) => k.stamp).join(", "));
