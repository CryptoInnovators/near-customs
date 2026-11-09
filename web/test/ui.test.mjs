import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { shorten, shortAccount, group, amountParts, utc, countdown, stampHtml, STAMPS } = createRequire(import.meta.url)("../ui.js");

test("hashes show 6 and 4 characters, short values stay whole", () => {
  assert.equal(shorten("FVbjGgwXwyGAVkqR8JMLXKLyvRuGgZ65QLTBp2vJ1ECq"), "FVbjGg…1ECq");
  assert.equal(shorten("abcdefgh"), "abcdefgh");
});

test("accounts are shown whole to 30 characters and shortened beyond", () => {
  assert.equal(shortAccount("customs26-token.testnet"), "customs26-token.testnet");
  assert.equal(shortAccount("d9eade234d867aa002539c484ed0dc808bdc5a0ccea6756a1ebfec0c0df9325a"), "d9eade23…f9325a");
});

test("amounts keep the raw integer grouped and the token amount to two places", () => {
  const seized = amountParts("994413985995229504683186338", 24);
  assert.equal(seized.raw, "994,413,985,995,229,504,683,186,338");
  assert.equal(seized.amount, "994.41");
  assert.equal(amountParts("0", 24).amount, "0.00");
  assert.equal(amountParts("not a number", 24).amount, "?");
});

test("times are UTC and the countdown rolls from days to hours and minutes", () => {
  assert.equal(utc(1793777816), "04 Nov 2026 07:36 UTC");
  assert.equal(countdown(1000 + 2 * 86400 + 5 * 3600, 1000), "2 d 5 h");
  assert.equal(countdown(1000 + 14 * 3600 + 2 * 60, 1000), "14 h 02 m");
  assert.equal(countdown(1000, 1000), null);
});

test("stamps carry their ink: green for pass, red for seized and refused, outline for the unread", () => {
  assert.equal(STAMPS.pass.ink, "green");
  assert.equal(STAMPS.seized.ink, "red");
  assert.equal(STAMPS.fail.ink, "red");
  assert.equal(STAMPS.unread.ink, "ink");
  assert.match(stampHtml("seized", "remainder frozen", { view: true }), /data-stamp="seized" data-ink="red" data-land="view" style="--r:-8deg/);
  assert.match(stampHtml("pass", "block 1", {}), /--r:-4deg/);
  assert.match(stampHtml("pass", "<b>", {}), /&lt;b&gt;/);
});

test("group puts thousands separators on long integers", () => {
  assert.equal(group("1234567"), "1,234,567");
});
