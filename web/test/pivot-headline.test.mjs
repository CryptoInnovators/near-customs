import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("first-screen headline matches the pivot headline", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const headline = html.match(/<h1\b[^>]*>(.*?)<\/h1>/s)?.[1]?.trim();

  assert.equal(headline, "Keep opening buyers from dumping on the next buyer.");
});
