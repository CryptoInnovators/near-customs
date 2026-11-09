import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
const require=createRequire(import.meta.url),{postWithRetry}=require('../web/net.js');
const out=new URL('../web/data/verdicts.json',import.meta.url),old=JSON.parse(await readFile(out,'utf8').catch(()=>'{"items":[]}'));
const cache=new Map((old.items||[]).map(x=>[x.token,x]));
const pre=(await Promise.all(['ui.js','rule.js'].map(f=>readFile(new URL('../web/'+f,import.meta.url),'utf8')))).join('\n');
const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8'),core=source.split('/* ---------------------------------------------------------------- rendering */')[0];
const context={AbortController,BigInt,Buffer,Date,Intl,Map,Math,Number,Object,Promise,Set,TextDecoder,Uint8Array,URL,btoa:v=>Buffer.from(v,'binary').toString('base64'),fetch,performance,postWithRetry,progress(){},setTimeout,clearTimeout};
runInNewContext(`${pre}\n${core}\nglobalThis.__inspect=inspect;`,context);
const now=Date.now(),res=await fetch('https://nearly.trade/api/launches?sort=fdv&limit=40');if(!res.ok)throw Error(`launch list HTTP ${res.status}`);const body=await res.json(),rows=(Array.isArray(body)?body:body.launches||body.data||[]).map(r=>({...r,token:r.token||r.account_id||r.contract||r.token_id})).filter(r=>r.token);
for(const row of rows){const cached=cache.get(row.token);if(cached&&now-Date.parse(cached.computed_at)<6*3600_000)continue;try{const started=performance.now(),d=await context.__inspect(row.token,row.creator,0);if(!d)continue;const funded=d.list.filter(b=>['linked','creator'].includes(b.trace?.status));const value={token:row.token,creator:row.creator,opening_buyers:d.list.length,funded:funded.length,funded_near:funded.reduce((n,b)=>n+Number(b.cost||0n),0)/1e24,total_near:d.list.reduce((n,b)=>n+Number(b.cost||0n),0)/1e24,head_block:d.t0Height||null,computed_at:new Date().toISOString()};cache.set(row.token,value);console.log(`OK ${row.token}: ${value.funded}/${value.opening_buyers} in ${Math.round(performance.now()-started)}ms`);}catch(e){console.error(`FAIL ${row.token}: ${e.message}`);}await mkdir(new URL('../web/data/',import.meta.url),{recursive:true});await writeFile(out,JSON.stringify({items:[...cache.values()]},null,2)+'\n');}
console.log(JSON.stringify({launches:rows.length,computed:cache.size,funded: [...cache.values()].filter(x=>x.funded>0).length,funded_near:cache.values().reduce((n,x)=>n+x.funded_near,0)}));
