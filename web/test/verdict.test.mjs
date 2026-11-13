import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const { verdictOf } = createRequire(import.meta.url)("../verdict.js");
const b = (status, near = 1) => ({ status, near });

test("no link and nothing paid is ALLOW", () => {
  assert.equal(verdictOf([b("unlinked"), b("unlinked", 3)]).kind, "ALLOW");
});
test("one funded buyer of two is BLOCK, one of ten small is WARN", () => {
  assert.equal(verdictOf([b("linked"), b("unlinked")]).kind, "BLOCK");
  const big = Array.from({ length: 9 }, () => b("unlinked", 10));
  const v = verdictOf([b("linked", 1), ...big]);
  assert.equal(v.kind, "WARN");
  assert.match(v.reasons[0], /paid 1 of 10 opening buyers/);
});
test("a large funded NEAR share blocks even with few buyers paid", () => {
  const many = Array.from({ length: 9 }, () => b("unlinked", 1));
  assert.equal(verdictOf([b("linked", 9), ...many]).kind, "BLOCK");
});
test("the creator's own buy warns only above 10% of opening NEAR", () => {
  assert.equal(verdictOf([b("creator", 1), b("unlinked", 20)]).kind, "ALLOW");
  assert.equal(verdictOf([b("creator", 5), b("unlinked", 20)]).kind, "WARN");
});
test("a partial trace never returns a verdict", () => {
  assert.equal(verdictOf([b("linked"), b(null)]), null);
  assert.equal(verdictOf([b("linked"), b("not_traced")]), null);
  assert.equal(verdictOf([]), null);
});
