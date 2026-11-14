import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const read = (f) => readFile(new URL("../" + f, import.meta.url), "utf8");

test("the first screen is the meme.cooking launch board: header, board, rail, and the hunt button on the bonded card", async () => {
  const html = await read("index.html");
  assert.match(html, /<main id="view"/);
  assert.match(html, /launches from meme\.cooking/);
  assert.match(html, /id="payout"/);
  assert.match(html, /id="page-error"/);
  assert.doesNotMatch(html, /Let Customs/);
  const js = await read("launchpad.js");
  assert.match(js, /id="break-go"/);
  assert.match(js, /id="stage-steps"/);
  assert.match(js, /id="seal-amount"/);
  assert.match(js, /id="seal-state"/);
  assert.match(js, /Hunt for \$\{L\.num\(payNum\(\)\)\} NEAR/);
  assert.doesNotMatch(js, /Let Customs Hunt/);
});

test("the hunt files through the sponsored worker endpoint and polls the contract for the verdict", async () => {
  const js = await read("lp-chain.js");
  assert.match(js, /\/stamp\/break/);
  assert.match(js, /challenge_of/);
  assert.match(js, /name === "Pending"/);
  assert.match(js, /\/stamp\/relay/);
});

test("each card is a meme.cooking launch with its own trace, Rhea pool read and one inline verdict", async () => {
  const js = await read("launchpad.js"), chain = await read("lp-chain.js");
  assert.match(js, /\/mc\/launches/);
  assert.match(js, /\/mc\/trades\?meme_id=/);
  assert.match(chain, /get_pool/);
  assert.match(chain, /signer_id === owner/);
});

test("slop tells from the launchpad spec never return", async () => {
  for (const f of ["launchpad.css", "launchpad.js", "index.html", "lp-lib.js", "lp-chain.js"]) {
    const t = await read(f);
    assert.doesNotMatch(t, /efebe1|text-transform: ?uppercase|<del>|radial-gradient\(circle at 5px|MethodNameMismatch|pic letter/, f);
    assert.doesNotMatch(t, new RegExp("\\u2014"), f + " has an em dash");
  }
});
