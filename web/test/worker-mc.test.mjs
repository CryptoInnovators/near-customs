import test from "node:test";
import assert from "node:assert/strict";
import worker from "../../worker.js";

const memes = [
  { meme_id: 10, owner: "a.near", name: "Old", symbol: "OLD", image: "Q".repeat(46), created_timestamp_ms: 1, total_deposit: "5", hard_cap: "9", soft_cap: "1", staker_count: 3, pool_id: 77, token_id: "old-10.meme-cooking.near" },
  { meme_id: 11, owner: "b.near", name: "NoPool", symbol: "NP", image: "Q".repeat(46), created_timestamp_ms: 2, total_deposit: "5", hard_cap: "9", soft_cap: "1", staker_count: 3, pool_id: null, token_id: null },
  { meme_id: 12, owner: "c.near", name: "Lonely", symbol: "LN", image: "Q".repeat(46), created_timestamp_ms: 3, total_deposit: "5", hard_cap: "9", soft_cap: "1", staker_count: 1, pool_id: 78, token_id: "ln-12.meme-cooking.near" },
  { meme_id: 13, owner: "d.near", name: "New", symbol: "NEW", image: "Q".repeat(46), created_timestamp_ms: 4, total_deposit: "5", hard_cap: "9", soft_cap: "1", staker_count: 4, pool_id: 79, token_id: "new-13.meme-cooking.near" },
];
const trades = [
  { meme_id: 13, account_id: "x.near", is_deposit: false, amount: "1", timestamp_ms: 9, receipt_id: "r3" },
  { meme_id: 13, account_id: "y.near", is_deposit: true, amount: "2", timestamp_ms: 8, receipt_id: "r2" },
  { meme_id: 13, account_id: "x.near", is_deposit: true, amount: "1", timestamp_ms: 7, receipt_id: "r1" },
];
globalThis.fetch = async (u) => {
  const url = String(u);
  if (url.endsWith("/meme")) return Response.json(memes);
  if (url.includes("/trades?meme_id=13")) return Response.json(trades);
  return new Response("no", { status: 404 });
};
const call = (path) => worker.fetch(new Request("https://x.test" + path), {});

test("launches keep only finalized pool launches with 2+ stakers, newest first", async () => {
  const j = await (await call("/mc/launches")).json();
  assert.equal(j.total, 4);
  assert.deepEqual(j.launches.map((l) => l.id), [13, 10]);
  assert.equal(j.launches[0].pool_id, 79);
});

test("trades return deposits only, oldest first, with receipts", async () => {
  const j = await (await call("/mc/trades?meme_id=13")).json();
  assert.deepEqual(j.deposits.map((d) => d.receipt), ["r1", "r2"]);
});

test("a non-numeric meme_id is refused and a bad image id never reaches the gateway", async () => {
  assert.equal((await call("/mc/trades?meme_id=1;drop")).status, 400);
  assert.equal((await call("/mc/img/not-a-cid")).status, 404);
});
