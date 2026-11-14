import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../../worker.js";

const store = new Map();
globalThis.caches = { default: { match: async (req) => (store.has(req.url) ? store.get(req.url).clone() : undefined), put: async (req, res) => { store.set(req.url, res); } } };
const ctx = { waitUntil: (p) => p };

test("the proxy absorbs upstream 429s so the browser sees one 200", async () => {
  store.clear();
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => (++calls < 3 ? new Response("limit", { status: 429 }) : new Response('{"ok":true}', { status: 200 }));
  try {
    const r = await worker.fetch(new Request("https://x/fastnear/tx-main/v0/account", { method: "POST", body: "{}" }), { ASSETS: {} }, ctx);
    assert.equal(r.status, 200);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = real; }
});

test("a proxy that is rate limited on every attempt still reports 429 rather than a fake success", async () => {
  store.clear();
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response("limit", { status: 429 });
  try {
    const r = await worker.fetch(new Request("https://x/fastnear/tx-main/v0/account", { method: "POST", body: "{}" }), { ASSETS: {} }, ctx);
    assert.equal(r.status, 429);
  } finally { globalThis.fetch = real; }
});

test("a mainnet tx read is served from the edge cache the second time, one upstream call for two visitors", async () => {
  store.clear();
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{"txs_count":7}', { status: 200 }); };
  try {
    const body = JSON.stringify({ account_id: "a.near", limit: 3 });
    const one = await worker.fetch(new Request("https://x/fastnear/tx-main/v0/account", { method: "POST", body }), { ASSETS: {} }, ctx);
    await new Promise((r) => setTimeout(r, 5));
    const two = await worker.fetch(new Request("https://x/fastnear/tx-main/v0/account", { method: "POST", body }), { ASSETS: {} }, ctx);
    assert.equal(one.status, 200);
    assert.equal(two.status, 200);
    assert.equal(await two.text(), '{"txs_count":7}');
    assert.equal(calls, 1);
    const other = await worker.fetch(new Request("https://x/fastnear/tx-main/v0/account", { method: "POST", body: JSON.stringify({ account_id: "b.near" }) }), { ASSETS: {} }, ctx);
    assert.equal(other.status, 200);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = real; }
});
