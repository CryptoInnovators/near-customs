"use strict";

const FASTNEAR_RATE = 3;
const FASTNEAR_BURST = 3;
const limiter = (() => {
  let rate = FASTNEAR_RATE, tokens = FASTNEAR_BURST, updated = Date.now(), reducedUntil = 0, clean = 0;
  return {
    async take() {
      for (;;) {
        const now = Date.now();
        tokens = Math.min(FASTNEAR_BURST, tokens + (now - updated) * rate / 1000);
        updated = now;
        if (tokens >= 1) { tokens--; return; }
        await new Promise((resolve) => setTimeout(resolve, Math.ceil((1 - tokens) * 1000 / rate)));
      }
    },
    response(status) {
      if (status === 429) {
        if (Date.now() >= reducedUntil) rate = Math.max(0.5, rate * 0.8);
        reducedUntil = Date.now() + 10000;
        clean = 0;
      } else if (status >= 200 && status < 300 && Date.now() >= reducedUntil && rate < FASTNEAR_RATE) {
        if (++clean >= 10) { rate = FASTNEAR_RATE; clean = 0; }
      } else clean = 0;
    },
  };
})();

/* One POST with bounded retries for the failures a public endpoint returns under load:
   a refused connection (fetch TypeError, which is what a CORS-less 429 looks like), HTTP 429 and HTTP 5xx.
   A 429 waits 2 s, 4 s, 8 s (or the server's Retry-After when it is longer); other failures wait waitMs * attempt. */
async function postWithRetry(fetchFn, url, init, opts) {
  const tries = (opts && opts.tries) || 3;
  const wait = (opts && opts.waitMs) || 700;
  const backoff = (opts && opts.backoffMs) || 2000;
  const limited = /fastnear/.test(url);
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      if (limited) await limiter.take();
      const res = await fetchFn(url, init);
      if (limited) limiter.response(res.status);
      if (res.status === 429 || res.status >= 500) {
        last = { res, text: await res.text() };
      } else {
        return { res, text: await res.text() };
      }
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      last = { err };
    }
    if (attempt < tries) {
      const after = last.res?.status === 429 ? Math.max(backoff * 2 ** (attempt - 1), 1000 * (Number(last.res.headers?.get?.("retry-after")) || 0)) : wait * attempt;
      await new Promise((r) => setTimeout(r, after));
    }
  }
  if (last.err) throw last.err;
  return last;
}

/* The deployed site proxies FastNEAR at /fastnear/<tx-main|tx-test|rpc-main|rpc-test> (worker.js), so a 429 reaches the
   page as a status instead of a CORS failure. A plain static server has no proxy; then the page calls FastNEAR directly. */
let proxyProbe = null;
function fastnearBase(network, kind) {
  const direct = { "tx-main": "https://tx.main.fastnear.com", "tx-test": "https://tx.test.fastnear.com", "rpc-main": "https://rpc.mainnet.fastnear.com", "rpc-test": "https://rpc.testnet.fastnear.com" };
  const key = kind + "-" + (network === "testnet" ? "test" : "main");
  if (typeof location === "undefined" || !/^https?:$/.test(location.protocol)) return Promise.resolve(direct[key]);
  proxyProbe = proxyProbe || fetch("/fastnear/ping").then((r) => r.status === 204).catch(() => false);
  return proxyProbe.then((ok) => (ok ? location.origin + "/fastnear/" + key : direct[key]));
}

if (typeof module !== "undefined") module.exports = { postWithRetry };
if (typeof window !== "undefined") window.FastnearLimiter = limiter;
