// Live proof on NEAR testnet of the Customs stamp (customs28-stamp.testnet), no mocks. The sponsored filing account
// (customs28-hunter.testnet) holds only a function-call key scoped to `challenge`, spending prepaid credit. Runs, in order:
//   M1 must-fail  a real receipt that does not pay the named clean buyer      -> enclave Rejected, filing bond forfeited, stamp stands
//   M2 must-fail  a path naming a transaction that does not exist             -> checker refuses, challenge Unanswered, no verdict applied
//   M3 must-fail  a bond above the sponsored credit                           -> the cap: the call fails on chain, nothing filed
//   S1 success    the path Customs walked to the creator-funded buyer          -> enclave Upheld, the creator's bond lands in the prover's account
// Each run polls to a terminal state and asserts a post-condition only completion can produce. Exits 1 if any fails.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { callFunction } from "../near-tx.mjs";
import { RPC, rpc, view, sleep, link } from "./lib-testnet.mjs";

const STAMP = "customs28-stamp.testnet", LAUNCH = "customs26-token.testnet", PROVER = "customs26-hunter.testnet";
const CLEAN = "customs26-buyer2.testnet", FUNDED = "customs26-buyer1.testnet";
const FUND_TX = "23atwS3gdX11c1r7o3UBZK1w7UAuskk7VofmoaZiP5HU", BUY1 = "75sREratSM2pa3iGJBx61hbwPSx3Wfa8bseN3g6CmR2T", BUY2 = "GuTXDmdNSsSosDHgjHJLLxgQH1VwXR1Z5jSfxy1TThV5";
const FAKE = "11111111111111111111111111111111";
const key = JSON.parse(await readFile(`${homedir()}/.config/customs/filer-key.json`, "utf8"));
const params = await view(STAMP, "stamp_params");
const bond = params.min_bond;
const fee = BigInt(params.exec_fee);
const results = [];
const balance = async (id) => BigInt((await rpc("query", { request_type: "view_account", finality: "final", account_id: id })).amount);

async function file(label, wallet, path, bondYocto) {
  const before = { credit: BigInt(await view(STAMP, "credit_of", { account: key.account_id })), forfeited: BigInt(await view(STAMP, "forfeited")), prover: await balance(PROVER) };
  const { hash, outcome } = await callFunction({ rpcUrl: RPC, signerId: key.account_id, secretKey: key.secret_key, receiverId: STAMP, method: "challenge", args: { launch: LAUNCH, wallet, path, bond: bondYocto, payout_to: PROVER }, gas: 200_000_000_000_000n });
  return { label, hash, outcome, before };
}
async function settle(run) {
  const failed = run.outcome.status?.Failure;
  if (failed) return { ...run, state: "tx failed", reason: JSON.stringify(failed).slice(0, 220) };
  const logs = (run.outcome.receipts_outcome || []).flatMap((r) => r.outcome.logs || []);
  const filed = logs.map((l) => { try { return JSON.parse(l.replace("EVENT_JSON:", "")); } catch { return null; } }).find((e) => e && e.event === "challenge_filed");
  if (!filed) return { ...run, state: "not filed", reason: "no challenge_filed event" };
  const cid = filed.data.challenge_id;
  let ch;
  for (let i = 0; i < 60; i++) {
    ch = await view(STAMP, "challenge_of", { challenge_id: cid });
    if (ch && ch.state !== "Pending") break;
    await sleep(5000);
  }
  return { ...run, cid, ch, state: typeof ch.state === "string" ? ch.state : Object.keys(ch.state)[0] };
}
const ok = (label, cond, detail) => { results.push({ label, ok: cond }); console.log(`${cond ? "PASS" : "FAIL"} ${label}: ${detail}`); };

// M1
{
  const r = await settle(await file("M1", CLEAN, [FUND_TX, BUY2], bond));
  const forfeited = BigInt(await view(STAMP, "forfeited"));
  const stamp = await view(STAMP, "stamp_of", { launch: LAUNCH });
  ok("must-fail M1 (clean buyer, real receipt that pays someone else)", r.state === "Rejected" && forfeited === r.before.forfeited + BigInt(bond) && stamp.state === "Standing", `challenge ${r.cid} ${r.state}, forfeited +${forfeited - r.before.forfeited} yocto, stamp ${JSON.stringify(stamp.state)}, filing tx ${link(r.hash)}`);
}
// M2
{
  const r = await settle(await file("M2", FUNDED, [FAKE, BUY1], bond));
  const credit = BigInt(await view(STAMP, "credit_of", { account: key.account_id }));
  ok("must-fail M2 (a hop that is not a real transaction)", r.state === "Unanswered", `challenge ${r.cid} ${r.state}, filing tx ${link(r.hash)}`);
}
// M3
{
  const r = await file("M3", FUNDED, [FUND_TX, BUY1], "5000000000000000000000000");
  const failed = r.outcome.status?.Failure ? JSON.stringify(r.outcome.status.Failure) : "";
  ok("must-fail M3 (the sponsored credit is the cap)", /filing credit is below bond \+ exec_fee/.test(failed), `${failed.match(/stamp: [^"\\]*/)?.[0] || "no failure"}, tx ${link(r.hash)}`);
}
// S1
{
  const r = await settle(await file("S1", FUNDED, [FUND_TX, BUY1], bond));
  const stamp = await view(STAMP, "stamp_of", { launch: LAUNCH });
  await sleep(4000);
  const gain = (await balance(PROVER)) - r.before.prover;
  const expected = BigInt(stamp.bond) + BigInt(bond);
  ok("success S1 (the funded buyer's path breaks the stamp)", r.state === "Upheld" && stamp.state.Broken && gain === expected, `challenge ${r.cid} ${r.state}, prover ${PROVER} gained ${gain} yocto (expected ${expected}), stamp ${JSON.stringify(stamp.state)}, filing tx ${link(r.hash)}`);
}
if (results.some((x) => !x.ok)) process.exit(1);
