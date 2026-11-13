import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { postWithRetry } = createRequire(import.meta.url)("../net.js");

const reply = (status, body) => ({ status, ok: status < 400, text: async () => body });
const seq = (...steps) => {
  let i = 0;
  const f = async () => {
    f.calls = ++i;
    const s = steps[Math.min(i - 1, steps.length - 1)];
    if (s instanceof Error) throw s;
    return s;
  };
  f.calls = 0;
  return f;
};
const fast = { tries: 3, waitMs: 1, backoffMs: 1 };

test("a dropped connection then a good answer returns the answer", async () => {
  const f = seq(new TypeError("Failed to fetch"), reply(200, "{}"));
  const out = await postWithRetry(f, "u", {}, fast);
  assert.equal(out.res.status, 200);
  assert.equal(f.calls, 2);
});

test("429 and 5xx are retried, and the last one is returned when all tries fail", async () => {
  const f = seq(reply(429, "slow down"), reply(503, "down"), reply(503, "still down"));
  const out = await postWithRetry(f, "u", {}, fast);
  assert.equal(out.res.status, 503);
  assert.equal(out.text, "still down");
  assert.equal(f.calls, 3);
});

test("a 404 is an answer and is not retried", async () => {
  const f = seq(reply(404, "no such account"));
  const out = await postWithRetry(f, "u", {}, fast);
  assert.equal(out.res.status, 404);
  assert.equal(f.calls, 1);
});

test("persistent network failure surfaces the original error", async () => {
  const f = seq(new TypeError("Failed to fetch"));
  await assert.rejects(postWithRetry(f, "u", {}, fast), /Failed to fetch/);
  assert.equal(f.calls, 3);
});

test("an abort is never retried", async () => {
  const e = new Error("aborted");
  e.name = "AbortError";
  const f = seq(e);
  await assert.rejects(postWithRetry(f, "u", {}, fast), /aborted/);
  assert.equal(f.calls, 1);
});

test("a 429 backs off and doubles the wait each attempt", async () => {
  const f = seq(reply(429, "slow"), reply(429, "slow"), reply(200, "{}"));
  const t0 = Date.now();
  const out = await postWithRetry(f, "u", {}, { tries: 3, waitMs: 1, backoffMs: 60 });
  assert.equal(out.res.status, 200);
  assert.ok(Date.now() - t0 >= 170, "expected about 60 + 120 ms of backoff, got " + (Date.now() - t0));
});
