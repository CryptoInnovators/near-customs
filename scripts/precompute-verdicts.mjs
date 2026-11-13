// Checks the top Nearly launches with the page's own inspector (web/app.js) and writes web/data/verdicts.json,
// the snapshot the check screen shows before a visitor runs a live check. A launch is stored only when every
// opening buyer has a final trace; a partial run is retried once and otherwise left out.
// node scripts/precompute-verdicts.mjs [maxLaunches]
import { readFile, writeFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const web = (f) => new URL("../web/" + f, import.meta.url);
const out = web("data/verdicts.json");
const old = JSON.parse(await readFile(out, "utf8").catch(() => '{"items":[]}'));
const fresh = new Map((old.items || []).filter((x) => x.complete && Date.now() - Date.parse(x.computed_at) < 6 * 3600_000).map((x) => [x.token, x]));
const pre = (await Promise.all(["net.js", "ui.js", "rule.js"].map((f) => readFile(web(f), "utf8")))).join("\n");
const core = (await readFile(web("app.js"), "utf8")).split("/* ---------------------------------------------------------------- rendering */")[0];
const context = { AbortController, BigInt, Buffer, Date, Intl, Map, Math, Number, Object, Promise, Set, TextDecoder, Uint8Array, URL, URLSearchParams, btoa: (v) => Buffer.from(v, "binary").toString("base64"), fetch, performance, setTimeout, clearTimeout, console, progress() {} };
runInNewContext(`${pre}\n${core}\nglobalThis.__inspector = CustomsInspector;`, context);
const { __inspector: inspector, traceVerdict } = context;

const pull = async (sort, n) => {
  const res = await fetch(`https://nearly.trade/api/launches?sort=${sort}&limit=${n}`);
  if (!res.ok) throw Error(`launch list HTTP ${res.status}`);
  const body = await res.json();
  return (Array.isArray(body) ? body : body.launches || body.data || []).map((r) => ({ ...r, token: r.token || r.account_id })).filter((r) => r.token);
};
// newest first so the feed's latest launches are always stored, then the largest by market cap
const seen = new Set();
const rows = [...(await pull("new", Number(process.argv[2]) || 40)), ...(await pull("fdv", Number(process.argv[3]) || 40))].filter((r) => !seen.has(r.token) && seen.add(r.token));

async function finalBlock() {
  const r = await fetch("https://rpc.mainnet.fastnear.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "block", params: { finality: "final" } }) });
  return (await r.json()).result.header.height;
}
const near = (y) => Number(y || 0n) / 1e24;
const write = () => writeFile(out, JSON.stringify({ items: [...fresh.values()] }, null, 2) + "\n");

for (const row of rows) {
  if (fresh.has(row.token)) continue;
  const started = Date.now();
  try {
    let d = await inspector.inspect(row.token, row.creator, {});
    if (d && !traceVerdict(d.list).complete) d = await inspector.retry(d, {});
    const v = d && traceVerdict(d.list);
    if (!v || !v.complete) { console.log(`PARTIAL ${row.token}: ${v ? v.done + "/" + v.total : "no data"}, left out`); continue; }
    const f = v.figures;
    fresh.set(row.token, {
      token: row.token, name: row.name || row.token, symbol: row.symbol || "", creator: row.creator, created_at_ms: row.created_at_ms || null,
      complete: true, opening_buyers: d.list.length, funded: f.funded.length, creator_buys: f.devBuys.length,
      funded_near: near(f.fundedCost), creator_near: near(f.devBuyCost), total_near: near(f.totalCost),
      first_block: d.t0Height || null, read_block: await finalBlock(), computed_at: new Date().toISOString(),
      buyers: d.list.map((b) => ({ wallet: b.wallet, near: near(b.cost), first_tx: b.firstTx, status: b.trace.status,
        path: (b.trace.path || []).map((h) => ({ from: h.from, to: h.to, near: near(h.yocto), tx: h.tx })) })),
    });
    console.log(`OK ${row.token}: ${f.funded.length} paid, ${f.devBuys.length} creator buy, of ${d.list.length} in ${Date.now() - started} ms`);
    await write();
  } catch (e) {
    console.log(`FAIL ${row.token}: ${e.message}`);
  }
}
await write();
console.log(JSON.stringify({ launches: rows.length, stored: fresh.size, paid: [...fresh.values()].filter((x) => x.funded > 0).length }));
