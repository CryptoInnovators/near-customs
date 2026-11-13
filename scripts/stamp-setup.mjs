// Deploys the Customs stamp on NEAR testnet, pins its OutLayer verdict key, posts the creator's bond for customs26-token.testnet,
// and creates the sponsored filing account with a function-call key limited to `challenge` on the stamp. Secrets stay in
// ~/.near-credentials and ~/.config/customs; nothing secret is printed. Re-runnable: each step checks the chain first.
// node scripts/stamp-setup.mjs <path to customs_stamp.wasm>
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { addFunctionCallKeyAction, createAccountAction, addFullAccessKeyAction, deployContractAction, functionCallAction, newKeyPair, sendActions, transferAction, b58decode } from "../near-tx.mjs";
import { RPC, rpc, view, secretOf, saveCred, sleep, link } from "./lib-testnet.mjs";

const STAMP = "customs28-stamp.testnet", FILER = "customs28-hunter.testnet", FUNDER = "customs26-buyer1.testnet", CREATOR = "customs26-creator.testnet";
const LAUNCH = "customs26-token.testnet", MARKET = "dclv2.ref-dev.testnet";
const NEAR = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
const wasm = new Uint8Array(await readFile(process.argv[2]));
const log = (m, h) => console.log(m, h ? link(h) : "");
const exists = async (id) => { try { await rpc("query", { request_type: "view_account", finality: "final", account_id: id }); return true; } catch { return false; } };
const send = (signerId, receiverId, actions) => sendActions({ rpcUrl: RPC, signerId, secretKey: null, receiverId, actions });

async function as(signerId, receiverId, actions) {
  const secretKey = await secretOf(signerId);
  const r = await sendActions({ rpcUrl: RPC, signerId, secretKey, receiverId, actions });
  if (r.outcome.status?.Failure) throw Error(signerId + " -> " + receiverId + " failed: " + JSON.stringify(r.outcome.status.Failure).slice(0, 300));
  return r;
}

async function makeAccount(id, near) {
  if (await exists(id)) return;
  const kp = await newKeyPair();
  await saveCred(id, kp.publicKeyStr, kp.secretKey);
  const r = await as(FUNDER, "testnet", [functionCallAction("create_account", { new_account_id: id, new_public_key: kp.publicKeyStr }, 60_000_000_000_000n, NEAR(near))]);
  log("created " + id, r.hash);
}

await makeAccount(STAMP, 3);
await makeAccount(FILER, 1);

const params = await view(LAUNCH, "customs_params");
const win = await view(LAUNCH, "window");
console.log("token params read: min_bond", params.min_bond, "exec_fee", params.exec_fee, "window", JSON.stringify(win));

const code = await rpc("query", { request_type: "view_code", finality: "final", account_id: STAMP }).catch(() => null);
if (!code) {
  const init = {
    params: {
      outlayer_id: params.outlayer_id, module_url: params.module_url, module_sha256: params.module_sha256,
      min_stamp: NEAR(1).toString(), hold_s: 86400, min_bond: "100000000000000000000000", exec_fee: params.exec_fee,
      reclaim_blocks: params.reclaim_blocks, max_age_blocks: params.max_age_blocks, max_hops: params.max_hops,
    },
  };
  const r = await as(STAMP, STAMP, [deployContractAction(wasm), functionCallAction("new", init, 60_000_000_000_000n, 0n)]);
  log("deployed and initialised " + STAMP, r.hash);
}

let key = await view(STAMP, "verdict_key");
if (!key) {
  const r = await as(FUNDER, STAMP, [functionCallAction("pin_verdict_key", {}, 150_000_000_000_000n, BigInt(params.exec_fee))]);
  log("pin_verdict_key filed", r.hash);
  for (let i = 0; i < 40 && !key; i++) { await sleep(5000); key = await view(STAMP, "verdict_key"); }
}
console.log("verdict key pinned:", key);
if (!key) throw Error("verdict key was not pinned");

if (!(await view(STAMP, "stamp_of", { launch: LAUNCH }))) {
  const start = win.start_s, end = win.opening_ends_s;
  const r = await as(CREATOR, STAMP, [functionCallAction("post_stamp", { launch: LAUNCH, market: MARKET, window_start_s: start, window_end_s: end }, 30_000_000_000_000n, NEAR(1))]);
  log("creator posted the 1 NEAR bond", r.hash);
}

const have = BigInt((await view(STAMP, "credit_of", { account: FILER })));
if (have < NEAR(1)) {
  const r = await as(FUNDER, STAMP, [functionCallAction("deposit_credit", { account: FILER }, 30_000_000_000_000n, NEAR(1))]);
  log("sponsor funded the filer's credit with 1 NEAR", r.hash);
}

// the filer's key: function-call only, scoped to `challenge` on the stamp; its full-access key is deleted afterwards
const fc = await newKeyPair();
const fullSecret = await secretOf(FILER);
const fullPub = b58decode(fullSecret.replace(/^ed25519:/, "")).slice(32);
await sendActions({ rpcUrl: RPC, signerId: FILER, secretKey: fullSecret, receiverId: FILER, actions: [addFunctionCallKeyAction(fc.publicKey, STAMP, ["challenge"], NEAR(0.25))] });
await mkdir(`${homedir()}/.config/customs`, { recursive: true });
await writeFile(`${homedir()}/.config/customs/filer-key.json`, JSON.stringify({ account_id: FILER, public_key: fc.publicKeyStr, secret_key: fc.secretKey }), { mode: 0o600 });
console.log("filer function-call key written to ~/.config/customs/filer-key.json", fc.publicKeyStr);
