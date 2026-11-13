import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("first screen performs the v6 pitch: a stamped launch, an unstamped one, and a button that breaks a stamp", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.equal(html.match(/<h1\b[^>]*>(.*?)<\/h1>/s)?.[1]?.trim(), "Launches post a bond. Break one.");
  assert.match(html, /Prove one was and the bond is yours\./);
  assert.match(html, /id="card-stamped"/);
  assert.match(html, /id="card-bare"/);
  assert.match(html, />Break this stamp</);
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
