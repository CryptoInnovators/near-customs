"use strict";

const FASTNEAR_RATE = 5;
const FASTNEAR_BURST = 5;
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
   a refused connection (fetch TypeError, which is what a CORS-less 429 looks like), HTTP 429 and HTTP 5xx. */
async function postWithRetry(fetchFn, url, init, opts) {
  const tries = (opts && opts.tries) || 3;
  const wait = (opts && opts.waitMs) || 700;
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      if (/^https:\/\/(?:tx\.main|rpc\.mainnet)\.fastnear\.com(?:\/|$)/.test(url)) await limiter.take();
      const res = await fetchFn(url, init);
      if (/^https:\/\/(?:tx\.main|rpc\.mainnet)\.fastnear\.com(?:\/|$)/.test(url)) limiter.response(res.status);
      if (res.status === 429 || res.status >= 500) {
        last = { res, text: await res.text() };
      } else {
        return { res, text: await res.text() };
      }
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      last = { err };
    }
    if (attempt < tries && last.res?.status !== 429) await new Promise((r) => setTimeout(r, wait * attempt));
  }
  if (last.err) throw last.err;
  return last;
}

if (typeof module !== "undefined") module.exports = { postWithRetry };
