// One-time setup of the agent account: adds a function-call key limited to `buy` on the gate, writes that key to
// ~/.config/customs/agent-key.json (mode 600, for `wrangler secret put AGENT_KEY`), then deletes the account's full-access key
// so the agent can do nothing else. Nothing secret is printed.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { addFunctionCallKeyAction, deleteKeyAction, newKeyPair, sendActions, b58decode } from "../near-tx.mjs";

const AGENT = "customs27-agent.testnet", GATE = "customs27-gate.testnet", RPC = ["https://rpc.testnet.fastnear.com"];
const cred = JSON.parse(await readFile(`${homedir()}/.near-credentials/testnet/${AGENT}.json`, "utf8"));
const full = cred.private_key;
const fullPub = b58decode(full.replace(/^ed25519:/, "")).slice(32);

const fc = await newKeyPair();
const add = await sendActions({ rpcUrl: RPC, signerId: AGENT, secretKey: full, receiverId: AGENT, actions: [addFunctionCallKeyAction(fc.publicKey, GATE, ["buy"], 300_000_000_000_000_000_000_000n)] });
if (add.outcome.status?.Failure) throw Error("add key failed");
await mkdir(`${homedir()}/.config/customs`, { recursive: true });
await writeFile(`${homedir()}/.config/customs/agent-key.json`, JSON.stringify({ account_id: AGENT, public_key: fc.publicKeyStr, secret_key: fc.secretKey }), { mode: 0o600 });
console.log("added function-call key", fc.publicKeyStr, add.hash);
const del = await sendActions({ rpcUrl: RPC, signerId: AGENT, secretKey: full, receiverId: AGENT, actions: [deleteKeyAction(fullPub)] });
if (del.outcome.status?.Failure) throw Error("delete full-access key failed");
console.log("deleted the full-access key", del.hash);
