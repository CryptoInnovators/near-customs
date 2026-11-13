import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("first screen is a memecoin launch feed: a stamped card with a Hunt button, live unstamped cards, a sticker on each", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.equal(html.match(/<h1\b[^>]*>(.*?)<\/h1>/s)?.[1]?.replace(/<[^>]+>/g, "").trim(), "Let Customs Hunt.");
  assert.match(html, /function-call key/);
  assert.match(html, /id="card-stamped"/);
  assert.match(html, /id="feed-cards"/);
  assert.match(html, /class="sticker"/);
  assert.match(html, /ALLOW challenge/);
  assert.match(html, /<button id="break-go" class="hunt" type="button">Hunt this launch</);
  assert.ok(html.indexOf('id="break-go"') < html.indexOf('id="launch-list"'), "the stamps come before the feed");
  assert.match(html, /id="launch-list"/);
  assert.match(html, /id="graph"/);
  assert.match(html, />Let an agent buy it</);
  assert.ok(html.indexOf('id="launch-list"') < html.indexOf('id="agent-go"'), "the feed comes before the agent gate");
});

test("the break button files through the sponsored worker endpoint and polls the contract for the verdict", async () => {
  const js = await readFile(new URL("../stamp.js", import.meta.url), "utf8");
  assert.match(js, /\/stamp\/break/);
  assert.match(js, /challenge_of/);
  assert.match(js, /state !== "Pending"/);
});

test("each feed card is built from a traced mainnet launch and its Hunt button runs the stamp flow with that launch's first buyer", async () => {
  const js = await readFile(new URL("../feed.js", import.meta.url), "utf8");
  assert.match(js, /nearly\.trade\/api/);
  assert.match(js, /CustomsHunt\.hunt\(\{ launch: item\.token, wallet: buyer\.wallet, tx: buyer\.first_tx/);
  assert.match(js, /setInterval\(poll, EVERY\)/);
  const stamp = await readFile(new URL("../stamp.js", import.meta.url), "utf8");
  assert.match(stamp, /window\.CustomsHunt = /);
  assert.match(stamp, /"Busted"/);
});
