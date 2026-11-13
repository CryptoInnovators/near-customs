import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../../worker.js";

test("the proxy absorbs upstream 429s so the browser sees one 200", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => (++calls < 3 ? new Response("limit", { status: 429 }) : new Response('{"ok":true}', { status: 200 }));
  try {
    const r = await worker.fetch(new Request("https://x/fastnear/tx-main/v0/account", { method: "POST", body: "{}" }), { ASSETS: {} });
    assert.equal(r.status, 200);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = real; }
});

test("a proxy that is rate limited on every attempt still reports 429 rather than a fake success", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response("limit", { status: 429 });
  try {
    const r = await worker.fetch(new Request("https://x/fastnear/tx-main/v0/account", { method: "POST", body: "{}" }), { ASSETS: {} });
    assert.equal(r.status, 429);
  } finally { globalThis.fetch = real; }
});
