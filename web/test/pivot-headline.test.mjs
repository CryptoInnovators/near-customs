import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("first screen states the v5 pitch and puts the launch feed and agent gate on the page", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.equal(html.match(/<h1\b[^>]*>(.*?)<\/h1>/s)?.[1]?.trim(), "See who really bought first.");
  assert.match(html, /Every new NEAR token launch, checked for creator-funded buyers before you buy\./);
  assert.match(html, /id="launch-list"/);
  assert.match(html, /id="graph"/);
  assert.match(html, />Let an agent buy it</);
  assert.ok(html.indexOf('id="launch-list"') < html.indexOf('id="agent-go"'), "the feed comes before the agent gate");
});
