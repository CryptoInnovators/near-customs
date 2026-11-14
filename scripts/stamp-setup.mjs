// Deploys the Customs stamp on NEAR testnet, pins its OutLayer verdict key, posts the creator's bond for customs26-token.testnet,
// and creates the sponsored filing account with a function-call key limited to `challenge` on the stamp. Secrets stay in
// ~/.near-credentials and ~/.config/customs; nothing secret is printed. Re-runnable: each step checks the chain first.
// node scripts/stamp-setup.mjs <path to customs_stamp.wasm>
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { addFunctionCallKeyAction, createAccountAction, addFullAccessKeyAction, deleteKeyAction, b58encode, deployContractAction, functionCallAction, newKeyPair, sendActions, transferAction, b58decode } from "../near-tx.mjs";
import { findPins } from "../agent.mjs";
import { RPC, rpc, view, secretOf, saveCred, sleep, link } from "./lib-testnet.mjs";

// SLOT picks the stamp instance (default 28, the first). Every slot is a separate contract holding its own bond on the same launch,
// so one breakable stamp can be broken by a prover while the next is still standing. FUNDER pays accounts and credit.
const SLOT = process.env.SLOT || "28";
const STAMP = `customs${SLOT}-stamp.testnet`, FILER = `customs${SLOT}-hunter.testnet`, FUNDER = process.env.FUNDER || "customs26-buyer1.testnet", CREATOR = "customs26-creator.testnet";
const KEY_FILE = SLOT === "28" ? "filer-key.json" : `filer-key-${SLOT}.json`;
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
await makeAccount(FILER, Number(process.env.FILER_NEAR) || 1);

const params = await view(LAUNCH, "customs_params");
const win = await view(LAUNCH, "window");
console.log("token params read: min_bond", params.min_bond, "exec_fee", params.exec_fee, "window", JSON.stringify(win));

const code = await rpc("query", { request_type: "view_code", finality: "final", account_id: STAMP }).catch(() => null);
const initialised = code ? await view(STAMP, "stamp_params").then((p) => !!p, () => false) : false;
if (!initialised) {
  const init = {
    params: {
      outlayer_id: params.outlayer_id, module_url: params.module_url, module_sha256: params.module_sha256,
      min_stamp: NEAR(1).toString(), hold_s: 86400, min_bond: "100000000000000000000000", exec_fee: params.exec_fee,
      reclaim_blocks: params.reclaim_blocks, max_age_blocks: Number(process.env.MAX_AGE) || params.max_age_blocks, max_hops: params.max_hops,
    },
  };
  // a 275 KB upload outlives most free RPC timeouts: deploy with near-cli over an archival endpoint, then this script only initialises
  if (!code) {
    const d = spawnSync("near", ["contract", "deploy", STAMP, "use-file", process.argv[2], "without-init-call", "network-config", "testnet-archival", "sign-with-legacy-keychain", "send"], { encoding: "utf8", timeout: 400_000 });
    if (d.status !== 0) throw Error("near-cli deploy failed: " + (d.stderr || d.stdout).slice(-300));
    console.log("deployed " + STAMP);
  }
  const actions = [functionCallAction("new", init, 60_000_000_000_000n, 0n)];
  const r = await as(STAMP, STAMP, actions);
  log("initialised " + STAMP, r.hash);
}

let key = await view(STAMP, "verdict_key");
// OutLayer's worker can answer after the stamp's yield window. The answer is still on chain in the worker's own resolve call: hand it to
// late_pin, which verifies the key against itself and this account. A bond is posted only behind a pinned key, after this check.
async function latePin() {
  const head = (await rpc("block", { finality: "final" })).header.height;
  const [answer] = (await findPins(STAMP, head - 20000, head)).reverse();
  if (!answer) return;
  const late = await as(FUNDER, STAMP, [functionCallAction("late_pin", { out: { token: answer.token, public_key: answer.public_key, sig: answer.sig } }, 30_000_000_000_000n, 0n)]);
  log("late_pin from the enclave's answer " + answer.worker_tx, late.hash);
  for (let i = 0; i < 10 && !key; i++) { await sleep(3000); key = await view(STAMP, "verdict_key"); }
}
if (!key) await latePin();
for (let t = 0; t < (Number(process.env.PIN_TRIES) || 1) && !key; t++) {
  const r = await as(FUNDER, STAMP, [functionCallAction("pin_verdict_key", {}, 150_000_000_000_000n, BigInt(params.exec_fee))]);
  log("pin_verdict_key filed (attempt " + (t + 1) + ")", r.hash);
  for (let i = 0; i < 40 && !key; i++) { await sleep(5000); key = await view(STAMP, "verdict_key"); }
  if (!key) await latePin();
}
console.log("verdict key pinned:", key);
if (!key) throw Error("verdict key was not pinned");

if (!(await view(STAMP, "stamp_of", { launch: LAUNCH }))) {
  const start = win.start_s, end = win.opening_ends_s;
  const r = await as(CREATOR, STAMP, [functionCallAction("post_stamp", { launch: LAUNCH, market: MARKET, window_start_s: start, window_end_s: end }, 30_000_000_000_000n, NEAR(1))]);
  log("creator posted the 1 NEAR bond", r.hash);
}

const CREDIT = Number(process.env.CREDIT ?? 1);
const have = BigInt((await view(STAMP, "credit_of", { account: FILER })));
if (have < NEAR(CREDIT)) {
  const r = await as(FUNDER, STAMP, [functionCallAction("deposit_credit", { account: FILER }, 30_000_000_000_000n, NEAR(CREDIT))]);
  log("sponsor funded the filer's credit with " + CREDIT + " NEAR", r.hash);
}

// the filer's key: function-call only, scoped to `challenge` on the stamp; its full-access key is deleted afterwards
const fc = await newKeyPair();
const fullSecret = await secretOf(FILER);
const fullPub = b58decode(fullSecret.replace(/^ed25519:/, "")).slice(32);
await sendActions({ rpcUrl: RPC, signerId: FILER, secretKey: fullSecret, receiverId: FILER, actions: [addFunctionCallKeyAction(fc.publicKey, STAMP, ["challenge"], NEAR(0.25))] });
await mkdir(`${homedir()}/.config/customs`, { recursive: true });
await writeFile(`${homedir()}/.config/customs/${KEY_FILE}`, JSON.stringify({ account_id: FILER, public_key: fc.publicKeyStr, secret_key: fc.secretKey }), { mode: 0o600 });
console.log("filer function-call key written to ~/.config/customs/"+KEY_FILE+"", fc.publicKeyStr);
const gone = await sendActions({ rpcUrl: RPC, signerId: FILER, secretKey: fullSecret, receiverId: FILER, actions: [deleteKeyAction("ed25519:" + b58encode(fullPub))] });
log("filer full-access key deleted, only the challenge key remains", gone.hash);
