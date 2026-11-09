import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const {postWithRetry}=require("../web/net.js");
const pre=(await Promise.all(["ui.js","rule.js"].map((f)=>readFile(new URL("../web/"+f,import.meta.url),"utf8")))).join("\n");
const source=await readFile(new URL("../web/app.js",import.meta.url),"utf8");
const core=source.split("/* ---------------------------------------------------------------- rendering */")[0];
const started=performance.now();
const context={AbortController,BigInt,Buffer,Date,Intl,Map,Math,Number,Object,Promise,Set,TextDecoder,Uint8Array,URL,btoa:(v)=>Buffer.from(v,"binary").toString("base64"),fetch,performance,postWithRetry,progress(){},setTimeout,clearTimeout};
runInNewContext(`${pre}\n${core}\nglobalThis.__inspect=inspect;globalThis.__state=state;`,context);
try{
 const data=await context.__inspect("phire.nearlytrade.near","provenhire.near",0);
 const buyersMs=Math.round(context.__buyersAt-started),tracedMs=Math.round(performance.now()-started);
 console.log(`buyers_ms=${buyersMs}`);console.log(`traced_ms=${tracedMs}`);console.log(`buyers=${data.list.length} trace_pages=${data.tracePages} trace_batches=${data.traceBatches}`);
 if(!(buyersMs<4000&&tracedMs<20000))process.exitCode=1;
}catch(err){console.error(`perf_inspect_error=${err.message}`);process.exitCode=1;}
