// Rebuilds web/data/replay.json from the live testnet token customs26-token.testnet: the creator's funding transfer to the first buyer
// and both opening swaps are read from FastNEAR and asserted, so the replay row on the check screen is chain data, not a fixture.
// node scripts/replay-testnet.mjs
import { writeFile } from "node:fs/promises";

const TOKEN = "customs26-token.testnet", CREATOR = "customs26-creator.testnet", POOL_MARKET = "dclv2.ref-dev.testnet";
const FUND = { hash: "23atwS3gdX11c1r7o3UBZK1w7UAuskk7VofmoaZiP5HU", buyer: "customs26-buyer1.testnet" };
const SWAPS = [
  { hash: "75sREratSM2pa3iGJBx61hbwPSx3Wfa8bseN3g6CmR2T", buyer: "customs26-buyer1.testnet" },
  { hash: "GuTXDmdNSsSosDHgjHJLLxgQH1VwXR1Z5jSfxy1TThV5", buyer: "customs26-buyer2.testnet" },
];

async function tx(hash) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch("https://tx.test.fastnear.com/v0/transactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx_hashes: [hash] }) });
    const j = await r.json();
    if (j.transactions && j.transactions[0]) return j.transactions[0];
    await new Promise((s) => setTimeout(s, 3000 * (i + 1)));
  }
  throw Error("FastNEAR returned no transaction for " + hash);
}
const near = (y) => Number(BigInt(y)) / 1e24;
const assert = (c, m) => { if (!c) throw Error(m); };

const fund = await tx(FUND.hash);
assert(fund.transaction.signer_id === CREATOR && fund.transaction.receiver_id === FUND.buyer, "funding transfer is not creator to buyer1");
const dep = fund.transaction.actions[0].Transfer.deposit;
const buyers = [];
for (const s of SWAPS) {
  const t = await tx(s.hash);
  assert(t.transaction.signer_id === s.buyer && t.transaction.receiver_id === "wrap.testnet", "swap " + s.hash + " is not " + s.buyer + " paying wrap.testnet");
  const a = t.transaction.actions[0].FunctionCall;
  const args = JSON.parse(Buffer.from(a.args, "base64").toString());
  assert(args.receiver_id === POOL_MARKET && args.msg.includes(TOKEN), "swap " + s.hash + " does not buy " + TOKEN);
  const linked = s.buyer === FUND.buyer;
  buyers.push({
    wallet: s.buyer, near: near(args.amount), first_tx: s.hash, status: linked ? "linked" : "unlinked",
    path: linked ? [{ from: CREATOR, to: s.buyer, near: near(dep), tx: FUND.hash }] : [],
  });
}
const head = await (await fetch("https://rpc.testnet.fastnear.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "block", params: { finality: "final" } }) })).json();
const item = {
  token: TOKEN, name: "Customs coin", symbol: "CUSTOMS", creator: CREATOR, net: "testnet", created_at_ms: null, complete: true,
  opening_buyers: buyers.length, funded: buyers.filter((b) => b.status === "linked").length, creator_buys: 0,
  read_block: head.result.header.height, computed_at: new Date().toISOString(), buyers,
};
await writeFile(new URL("../web/data/replay.json", import.meta.url), JSON.stringify(item, null, 2) + "\n");
console.log(`OK ${buyers.map((b) => b.wallet + ":" + b.status + ":" + b.near).join(" ")} at block ${item.read_block}`);
