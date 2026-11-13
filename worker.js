// Serves web/ as static assets and proxies FastNEAR reads at /fastnear/<tx-main|tx-test|rpc-main|rpc-test>/...
// FastNEAR answers a rate limit (429) without CORS headers, which a browser can only see as a failed fetch;
// same-origin through this worker the page sees the 429 and backs off (web/net.js).
import { agentBuy, stampBreak } from "./agent.mjs";

const UPSTREAM = {
  "tx-main": "https://tx.main.fastnear.com",
  "tx-test": "https://tx.test.fastnear.com",
  "rpc-main": "https://rpc.mainnet.fastnear.com",
  "rpc-test": "https://rpc.testnet.fastnear.com",
  "drpc-test": "https://near-testnet.drpc.org",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/agent/buy") return request.method === "POST" ? agentBuy(request, env) : new Response("Use POST", { status: 405 });
    if (url.pathname === "/stamp/break") return request.method === "POST" ? stampBreak(request, env) : new Response("Use POST", { status: 405 });
    const m = url.pathname.match(/^\/fastnear\/([a-z-]+)(\/[A-Za-z0-9/_-]*)?$/);
    if (!m) return env.ASSETS.fetch(request);
    if (m[1] === "ping") return new Response(null, { status: 204 });
    const base = UPSTREAM[m[1]];
    if (!base || request.method !== "POST") return new Response("Not found", { status: 404 });
    const body = await request.text();
    if (body.length > 65536) return new Response("Body too large", { status: 413 });
    /* FastNEAR rate limits (429) hard under a page's burst; absorb it here so the browser sees a 200 and no failed request */
    let upstream;
    for (let attempt = 0; attempt < 5; attempt++) {
      upstream = await fetch(base + (m[2] || "/"), { method: "POST", headers: { "content-type": "application/json" }, body });
      if (upstream.status !== 429) break;
      await new Promise((r) => setTimeout(r, Math.min(3000, 400 * 2 ** attempt)));
    }
    const headers = { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store" };
    const retry = upstream.headers.get("retry-after");
    if (retry) headers["retry-after"] = retry;
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
