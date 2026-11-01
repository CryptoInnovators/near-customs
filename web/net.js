"use strict";

/* One POST with bounded retries for the failures a public endpoint returns under load:
   a refused connection (fetch TypeError, which is what a CORS-less 429 looks like), HTTP 429 and HTTP 5xx. */
async function postWithRetry(fetchFn, url, init, opts) {
  const tries = (opts && opts.tries) || 3;
  const wait = (opts && opts.waitMs) || 700;
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetchFn(url, init);
      if (res.status === 429 || res.status >= 500) {
        last = { res, text: await res.text() };
      } else {
        return { res, text: await res.text() };
      }
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      last = { err };
    }
    if (attempt < tries) await new Promise((r) => setTimeout(r, wait * attempt));
  }
  if (last.err) throw last.err;
  return last;
}

if (typeof module !== "undefined") module.exports = { postWithRetry };
