// Serves web/ as static assets and proxies FastNEAR reads at /fastnear/<tx-main|tx-test|rpc-main|rpc-test>/...
// FastNEAR answers a rate limit (429) without CORS headers, which a browser can only see as a failed fetch;
// same-origin through this worker the page sees the 429 and backs off (web/net.js).
import { agentBuy, huntInject, stampBreak, stampRelay, stampArm } from "./agent.mjs";

const UPSTREAM = {
  "tx-main": "https://tx.main.fastnear.com",
  "tx-test": "https://tx.test.fastnear.com",
  "rpc-main": "https://rpc.mainnet.fastnear.com",
  "rpc-test": "https://rpc.testnet.fastnear.com",
  "drpc-test": "https://near-testnet.drpc.org",
};

/* meme.cooking, NEAR's official memecoin launchpad: its public API (api.meme.cooking) read through this worker so the page sees one origin,
   one cache and no CORS failures. /mc/launches slims the 2.5 MB launch list to the launches that raised real deposits and opened a pool. */
const MC = "https://api.meme.cooking";
const mcCache = new Map();
async function mcGet(path, ttlMs) {
  const hit = mcCache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.body;
  const r = await fetch(MC + path, { headers: { accept: "application/json" } });
  if (!r.ok) throw Error("meme.cooking answered HTTP " + r.status);
  const body = await r.json();
  mcCache.set(path, { at: Date.now(), body });
  return body;
}
const JSON_HEAD = { "content-type": "application/json", "cache-control": "public, max-age=15" };
async function mcRoute(url) {
  try {
    if (url.pathname === "/mc/launches") {
      const all = await mcGet("/meme", 60_000);
      const now = Date.now();
      const slim = (m, status) => ({ id: m.meme_id, owner: m.owner, name: m.name, symbol: m.symbol, image: m.image, created_ms: m.created_timestamp_ms, end_ms: m.end_timestamp_ms ?? null, deposit: m.total_deposit, hard_cap: m.hard_cap, soft_cap: m.soft_cap, stakers: m.staker_count, pool_id: m.pool_id ?? null, token_id: m.token_id ?? null, total_supply: m.total_supply ?? null, decimals: m.decimals ?? null, is_finalized: !!m.is_finalized, team_allocation: m.team_allocation ?? null, description: (m.description || "").slice(0, 160), status });
      const newest = (list, n) => list.sort((a, b) => b.meme_id - a.meme_id).slice(0, n);
      const cooked = newest(all.filter((m) => m.pool_id && m.token_id && m.staker_count >= 2 && m.image), 12).map((m) => slim(m, "cooked"));
      const cooking = newest(all.filter((m) => !m.is_finalized && m.end_timestamp_ms > now && m.image), 6).map((m) => slim(m, "cooking"));
      const spoiled = newest(all.filter((m) => !m.is_finalized && m.end_timestamp_ms && m.end_timestamp_ms <= now && m.staker_count >= 3 && m.image && BigInt(m.total_deposit || "0") < BigInt(m.soft_cap || "0")), 3).map((m) => slim(m, "spoiled"));
      return new Response(JSON.stringify({ total: all.length, launches: [...cooking, ...cooked, ...spoiled], read_ms: now }), { headers: JSON_HEAD });
    }
    if (url.pathname === "/mc/trades") {
      const id = url.searchParams.get("meme_id");
      if (!/^\d{1,6}$/.test(id || "")) return new Response("meme_id must be a number", { status: 400 });
      const t = await mcGet("/trades?meme_id=" + id, 20_000);
      const side = (isDeposit) => t.filter((x) => !!x.is_deposit === isDeposit).map((x) => ({ account: x.account_id, amount: x.amount, ts: x.timestamp_ms, receipt: x.receipt_id })).sort((a, b) => a.ts - b.ts);
      return new Response(JSON.stringify({ meme_id: Number(id), trades: t.length, deposits: side(true), withdrawals: side(false) }), { headers: JSON_HEAD });
    }
    const img = url.pathname.match(/^\/mc\/img\/([A-Za-z0-9]{40,70})$/);
    if (img) {
      const key = new Request(url.origin + url.pathname);
      const hit = await caches.default.match(key);
      if (hit) return hit;
      const r = await fetch("https://gateway.pinata.cloud/ipfs/" + img[1]);
      const type = r.headers.get("content-type") || "";
      if (!r.ok || !type.startsWith("image/")) return new Response("No image", { status: 404 });
      const out = new Response(r.body, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
      await caches.default.put(key, out.clone());
      return out;
    }
    return new Response("Not found", { status: 404 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e).slice(0, 160) }), { status: 502, headers: { "content-type": "application/json" } });
  }
}

async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/agent/buy") return request.method === "POST" ? agentBuy(request, env) : new Response("Use POST", { status: 405 });
    if (url.pathname === "/hunt/inject") return request.method === "POST" ? huntInject(request, env) : new Response("Use POST", { status: 405 });
    if (url.pathname === "/stamp/relay") return request.method === "POST" ? stampRelay(request, env) : new Response("Use POST", { status: 405 });
    if (url.pathname === "/stamp/arm") return request.method === "POST" ? stampArm(request, env) : new Response("Use POST", { status: 405 });
    if (url.pathname === "/stamp/break") return request.method === "POST" ? stampBreak(request, env) : new Response("Use POST", { status: 405 });
    if (url.pathname.startsWith("/mc/") && request.method === "GET") return mcRoute(url);
    const m = url.pathname.match(/^\/fastnear\/([a-z-]+)(\/[A-Za-z0-9/_-]*)?$/);
    if (!m) return env.ASSETS.fetch(request);
    if (m[1] === "ping") return new Response(null, { status: 204 });
    const base = UPSTREAM[m[1]];
    if (!base || request.method !== "POST") return new Response("Not found", { status: 404 });
    const body = await request.text();
    if (body.length > 65536) return new Response("Body too large", { status: 413 });
    /* mainnet tx reads of finished launches do not change: serve them from the edge cache so a page load costs the shared upstream budget once, not once per visitor */
    const cacheable = m[1] === "tx-main";
    const cacheKey = cacheable ? new Request(url.origin + "/__cache" + url.pathname + "/" + await sha256(body)) : null;
    if (cacheKey) {
      const hit = await caches.default.match(cacheKey);
      if (hit) return new Response(hit.body, { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-edge-cache": "hit" } });
    }
    /* FastNEAR rate limits (429) hard under a page's burst; absorb it here so the browser sees a 200 and no failed request */
    let upstream;
    for (let attempt = 0; attempt < 6; attempt++) {
      upstream = await fetch(base + (m[2] || "/"), { method: "POST", headers: { "content-type": "application/json" }, body });
      if (upstream.status !== 429) break;
      await new Promise((r) => setTimeout(r, Math.min(2500, 400 * 2 ** attempt)));
    }
    if (cacheKey && upstream.status === 200) {
      const copy = upstream.clone();
      ctx.waitUntil(caches.default.put(cacheKey, new Response(copy.body, { status: 200, headers: { "content-type": "application/json", "cache-control": "public, max-age=21600" } })));
    }
    const headers = { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store" };
    const retry = upstream.headers.get("retry-after");
    if (retry) headers["retry-after"] = retry;
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
