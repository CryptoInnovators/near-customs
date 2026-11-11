import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHandler } from "../handler.js";

test("live testnet command reports stored verdicts and verified filing transactions", async () => {
  const response = await createHandler()("/check customs26-token.testnet");
  assert.match(response, /outlayer\.testnet; vest 86400s; seizure 2000 bps/);
  assert.match(response, /#0 Upheld: customs26-buyer1\.testnet/);
  assert.match(response, /#1 Rejected: customs26-buyer2\.testnet/);
  assert.match(response, /3Nr9SzTP8jBpZxTwV9W9hPfd2KMjfSsYqPBGyru3RuVN/);
  assert.match(response, /FVbjGgwXwyGAVkqR8JMLXKLyvRuGgZ65QLTBp2vJ1ECq/);
  const evidence = await readFile(new URL("../../docs/EVIDENCE.md", import.meta.url), "utf8");
  assert.ok(evidence.includes("3Nr9SzTP8jBpZxTwV9W9hPfd2KMjfSsYqPBGyru3RuVN"));
  assert.ok(evidence.includes("FVbjGgwXwyGAVkqR8JMLXKLyvRuGgZ65QLTBp2vJ1ECq"));
});
