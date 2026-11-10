import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHandler } from "../handler.js";

test("/start explains Customs Radar and its command", async () => {
  const handle = createHandler();
  const response = await handle("/start");
  assert.match(response, /Customs Radar/);
  assert.match(response, /\/check <token\.near>/);
});

test("/check returns a funding verdict, receipt, and live challenge status", async () => {
  const handle = createHandler({
    fetchImpl: async () => ({ ok: true, json: async () => ({ creator: "maker.near" }) }),
    replayFn: async (token, creator) => {
      assert.equal(token, "coin.near");
      assert.equal(creator, "maker.near");
      return { buyers: 2, rows: [
        { class: "linked", first_buy_tx: "buyhash", path: [{ tx: "fundhash" }] },
        { class: "unlinked", path: [] },
      ] };
    },
    challengeFn: async () => "Live challenge status: #0 Pending.",
  });
  const response = await handle("/check coin.near");
  assert.match(response, /1 of 2 opening buyers trace to creator maker\.near/);
  assert.match(response, /https:\/\/nearblocks\.io\/txns\/fundhash/);
  assert.match(response, /#0 Pending/);
});

test("invalid token and missing creator fail clearly", async () => {
  const handle = createHandler({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.match(await handle("/check not-an-account"), /^Usage:/);
  assert.match(await handle("/check coin.near"), /No creator account/);
});

test("startup exits clearly when TELEGRAM_BOT_TOKEN is unset", () => {
  const index = fileURLToPath(new URL("../index.js", import.meta.url));
  const { TELEGRAM_BOT_TOKEN: _token, ...env } = process.env;
  const result = spawnSync(process.execPath, [index], {
    env, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TELEGRAM_BOT_TOKEN is required/);
  assert.doesNotMatch(result.stderr, /bot\w{20,}/);
});
