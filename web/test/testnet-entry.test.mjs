import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("the Customs coin route stays reachable from the first screen and mainnet tokens leave token.html for the check screen", async () => {
  const js = await readFile(new URL("../launchpad.js", import.meta.url), "utf8");
  assert.match(js, /href="#\/t\/customs26-token\.testnet"/);
  assert.match(js, /id === C\.LAUNCH/);
  const token = await readFile(new URL("../token.html", import.meta.url), "utf8");
  assert.match(token, /location\.replace\("index\.html"/);
});
