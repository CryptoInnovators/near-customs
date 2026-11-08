import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PUBLISHED, openingBuyers, challengeTxs, judgeChecks, latestEntry, loadCoin } = require("../customs.js");

const dir = new URL("./fixtures/testnet/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
const TOKEN = "customs26-token.testnet";
const pub = PUBLISHED.testnet;
const params = load("customs_params.json");
const win = load("window.json");
const key = load("verdict_key.json");
const rawTxs = load("txs.json").transactions;
const sha = params.module_sha256;

test("fixtures are recorded chain data, not empty", () => {
  assert.ok(rawTxs.length >= 10);
  assert.equal(params.outlayer_id, "outlayer.testnet");
  assert.ok(key.startsWith("ed25519:"));
});

test("the live coin passes all four checks", () => {
  const checks = judgeChecks(pub, params, key, load("access_keys.json").keys.length, sha);
  assert.deepEqual(checks.map((c) => [c.id, c.ok]), [["judge", true], ["checker", true], ["verdict_key", true], ["keys", true]]);
});

test("a foreign judge goes red with the published text", () => {
  const checks = judgeChecks(pub, { ...params, outlayer_id: "evil.testnet" }, key, 0, sha);
  const judge = checks.find((c) => c.id === "judge");
  assert.equal(judge.ok, false);
  assert.match(judge.text, /This token's judge is evil\.testnet, not outlayer\.testnet\. Its verdicts prove nothing\./);
});

test("a foreign pinned checker goes red", () => {
  const other = "0".repeat(64);
  const checks = judgeChecks(pub, { ...params, module_sha256: other }, key, 0, other);
  assert.equal(checks.find((c) => c.id === "checker").ok, false);
});

test("module bytes that hash differently from the pinned sha go red", () => {
  const checks = judgeChecks(pub, params, key, 0, "1".repeat(64));
  const checker = checks.find((c) => c.id === "checker");
  assert.equal(checker.ok, false);
  assert.match(checker.text, /OutLayer would refuse/);
});

test("an unfetched module is unread, not green", () => {
  assert.equal(judgeChecks(pub, params, key, 0, null).find((c) => c.id === "checker").ok, null);
});

test("an unpinned verdict key goes red", () => {
  assert.equal(judgeChecks(pub, params, null, 0, sha).find((c) => c.id === "verdict_key").ok, false);
});

test("a leftover access key goes red", () => {
  const keys = judgeChecks(pub, params, key, 1, sha).find((c) => c.id === "keys");
  assert.equal(keys.ok, false);
  assert.match(keys.text, /1 access key/);
});

test("opening buyers are the market's payouts inside the window", () => {
  const buyers = openingBuyers(rawTxs, TOKEN, params.market_id, win.start_s, win.opening_ends_s);
  assert.deepEqual(buyers.filter((b) => b.includes("buyer")).sort(), ["customs26-buyer1.testnet", "customs26-buyer2.testnet"]);
});

test("transfers outside the window or from another sender are not opening buys", () => {
  assert.deepEqual(openingBuyers(rawTxs, TOKEN, params.market_id, win.opening_ends_s, win.opening_ends_s + 1), []);
  assert.deepEqual(openingBuyers(rawTxs, TOKEN, "someone-else.testnet", win.start_s, win.opening_ends_s), []);
});

test("events logged by another contract are ignored", () => {
  assert.deepEqual(openingBuyers(rawTxs, "not-the-token.testnet", params.market_id, win.start_s, win.opening_ends_s), []);
});

test("challenge ids map to the transactions that filed and resolved them", () => {
  const byId = challengeTxs(rawTxs, TOKEN);
  assert.equal(byId.get(0).filed, "3Nr9SzTP8jBpZxTwV9W9hPfd2KMjfSsYqPBGyru3RuVN");
  assert.equal(byId.get(1).filed, "FVbjGgwXwyGAVkqR8JMLXKLyvRuGgZ65QLTBp2vJ1ECq");
});

function recorded(overrides = {}) {
  const challenges = [load("challenge_0.json"), load("challenge_1.json")];
  const openings = { "customs26-buyer1.testnet": load("opening_buyer1.json"), "customs26-buyer2.testnet": load("opening_buyer2.json") };
  return {
    async view(_acct, method, args) {
      if (method === "customs_params") return params;
      if (method === "verdict_key") return key;
      if (method === "window") return win;
      if (method === "opening_of") return openings[args.account_id] || null;
      if (method === "challenge_of") return challenges[args.challenge_id] || null;
      throw new Error("unexpected view " + method);
    },
    async keyCount() { return load("access_keys.json").keys.length; },
    async history() { return load("history.json").account_txs.map((t) => t.transaction_hash); },
    async txs() { return rawTxs; },
    async sha256Url() { return sha; },
    ...overrides,
  };
}

test("loadCoin on the recorded chain: seized buyer, vested buyer, upheld and rejected challenge", async () => {
  const m = await loadCoin(recorded(), "testnet", TOKEN);
  assert.equal(m.kind, "customs");
  assert.ok(m.checks.every((c) => c.ok === true));
  const bag = Object.fromEntries(m.buyers.map((b) => [b.wallet, b.opening.state]));
  assert.equal(bag["customs26-buyer1.testnet"], "seized_frozen");
  assert.equal(bag["customs26-buyer2.testnet"], "vested");
  assert.deepEqual(m.challenges.map((c) => c.title), ["Upheld", "Rejected"]);
  assert.equal(m.challenges[0].seized, "994413985995229504683186338");
});

test("an account without customs_params is not a Customs token", async () => {
  const io = recorded({ async view() { throw new Error("MethodNotFound"); } });
  const m = await loadCoin(io, "testnet", "wrap.testnet");
  assert.equal(m.kind, "not_customs");
  assert.match(m.reason, /MethodNotFound/);
});

test("the latest entry is the newest transaction by block time, whatever order the list came in", () => {
  const forward = latestEntry(rawTxs);
  assert.equal(forward.hash, "FVbjGgwXwyGAVkqR8JMLXKLyvRuGgZ65QLTBp2vJ1ECq");
  assert.equal(latestEntry([...rawTxs].reverse()).hash, forward.hash);
  assert.ok(forward.height > 276000000 && forward.tsS > 1793777000);
  assert.equal(latestEntry([]), null);
});

test("loadCoin reports each read as it resolves: params first, then checks, latest, bags, notices", async () => {
  const stages = [];
  const m = await loadCoin(recorded(), "testnet", TOKEN, (stage, payload) => stages.push(stage === "check" ? "check:" + payload.id : stage));
  assert.equal(stages[0], "params");
  assert.equal(stages[1], "check:judge");
  assert.deepEqual([...stages].sort().filter((s) => s.startsWith("check:")), ["check:checker", "check:judge", "check:keys", "check:verdict_key"]);
  assert.deepEqual(stages.slice(-3), ["latest", "bags", "notices"]);
  assert.equal(m.latest.hash, "FVbjGgwXwyGAVkqR8JMLXKLyvRuGgZ65QLTBp2vJ1ECq");
});

test("a transport failure is a failed read, never a Not-a-Customs-token verdict", async () => {
  const io = recorded({ async view() { throw Object.assign(new Error("The NEAR RPC could not be reached"), { transport: true }); } });
  await assert.rejects(loadCoin(io, "testnet", TOKEN), /could not be reached/);
});
