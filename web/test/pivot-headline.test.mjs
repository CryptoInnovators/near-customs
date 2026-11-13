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

test("each feed card is a meme.cooking launch with its own funding trace, Rhea pool read and one inline verdict", async () => {
  const js = await readFile(new URL("../feed.js", import.meta.url), "utf8");
  assert.match(js, /\/mc\/launches/);
  assert.match(js, /\/mc\/trades\?meme_id=/);
  assert.match(js, /get_pool/);
  assert.match(js, /signer_id === owner/);
  assert.doesNotMatch(js, /CustomsHunt\.hunt/);
  const stamp = await readFile(new URL("../stamp.js", import.meta.url), "utf8");
  assert.match(stamp, /"Busted"/);
  assert.match(stamp, /Settled on chain/);
  const css = await readFile(new URL("../feed.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /rotate\(5deg\)/);
});
