"use strict";
const RPC = "https://rpc.mainnet.fastnear.com";
const TXAPI = "https://tx.main.fastnear.com";
const NB = "https://nearblocks.io";
const MAX_HOLDERS = 25, TOKEN_TX_PAGE = 100, MAX_HOPS = 3, BUSY_TXS = 3000;
const WINDOW_BLOCKS = 300000, FANIN_PER_NODE = 6, NODES_PER_LEVEL = 24, REQUEST_BUDGET = 600;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}
const acctLink = (id) => el("a", { href: `${NB}/address/${encodeURIComponent(id)}`, rel: "noopener", target: "_blank" }, id);
const txLink = (h, label) => el("a", { href: `${NB}/txns/${encodeURIComponent(h)}`, rel: "noopener", target: "_blank", class: "mono" }, label || h);
const iso = (ns) => new Date(Number(BigInt(ns) / 1000000n)).toISOString().replace(".000Z", "Z");
const stamp = (text) => el("span", { class: "stamp" }, text);

function showError(box, what, err, next) {
  box.replaceChildren(el("div", { class: "err" },
    el("div", {}, what),
    el("div", { class: "msg" }, err && err.message ? err.message : String(err)),
    el("div", { class: "next" }, "Next: " + next)));
}

let requests = 0;
async function postJson(url, body) {
  requests++;
  let res;
  const label = `POST ${url} ${JSON.stringify(body).slice(0, 160)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error(`${label}\nnetwork error: ${e.message}`);
    }
    if (res.status === 429 || res.status >= 500) { await sleep(800 * 2 ** attempt); continue; }
    break;
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${label}\nHTTP ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch (e) { throw new Error(`${label}\nnot JSON: ${text.slice(0, 200)}`); }
}
async function rpc(method, params) {
  const r = await postJson(RPC, { jsonrpc: "2.0", id: 1, method, params });
  if (r.error) throw new Error(`RPC ${method} error: ${JSON.stringify(r.error).slice(0, 400)}`);
  return r.result;
}
async function view(account, method, args, block) {
  const r = await rpc("query", {
    request_type: "call_function", block_id: block, account_id: account, method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  if (r.error) throw new Error(`view ${account}.${method}: ${r.error}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result)));
}
const accountPage = (body) => postJson(`${TXAPI}/v0/account`, body);
async function getTxs(hashes) {
  const out = [];
  for (let i = 0; i < hashes.length; i += 20) {
    const r = await postJson(`${TXAPI}/v0/transactions`, { tx_hashes: hashes.slice(i, i + 20) });
    out.push(...(r.transactions || []));
  }
  return out;
}

function fmtAmount(raw, decimals) {
  const b = BigInt(raw), d = 10n ** BigInt(decimals);
  const whole = (b / d).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (b % d).toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
const fmtNear = (yocto) => fmtAmount(yocto, 24);

function tokenEvents(tx, token) {
  const out = [];
  for (const r of tx.receipts || []) {
    const o = r.execution_outcome;
    if (!o || o.outcome.executor_id !== token) continue;
    for (const log of o.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      let ev; try { ev = JSON.parse(log.slice(11)); } catch (e) { continue; }
      if (ev.standard !== "nep141") continue;
      for (const d of ev.data || []) {
        const to = ev.event === "ft_transfer" ? d.new_owner_id : ev.event === "ft_mint" ? d.owner_id : null;
        if (to) out.push({ to, amount: d.amount, height: o.block_height, ts: o.block_timestamp, hash: tx.transaction.hash });
      }
    }
  }
  return out;
}

function txSucceeded(tx) {
  const st = tx.execution_outcome && tx.execution_outcome.outcome.status;
  return st && (st.SuccessReceiptId !== undefined || st.SuccessValue !== undefined);
}

/* incoming plain NEAR transfers to `acct` before `beforeHeight` and after `beforeHeight - WINDOW_BLOCKS` */
async function incomingTransfers(acct, beforeHeight, cache) {
  const key = acct + "@" + beforeHeight;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const page = await accountPage({ account_id: acct, desc: true, limit: 100, to_tx_block_height: beforeHeight });
    const busy = (page.txs_count || 0) > BUSY_TXS;
    if (busy) return { busy: true, count: page.txs_count, list: [] };
    const rows = (page.account_txs || []).filter((t) =>
      t.is_real_receiver && !t.is_function_call && !t.is_signer && t.is_success && t.tx_block_height >= beforeHeight - WINDOW_BLOCKS);
    const uniq = [...new Set(rows.map((t) => t.transaction_hash))];
    const txs = await getTxs(uniq);
    const list = [];
    for (const tx of txs) {
      const t = tx.transaction;
      if (t.receiver_id !== acct || !txSucceeded(tx)) continue;
      const amt = t.actions.filter((a) => a.Transfer).reduce((s, a) => s + BigInt(a.Transfer.deposit), 0n);
      if (amt > 0n) list.push({ from: t.signer_id, to: acct, hash: t.hash, height: tx.execution_outcome.block_height, amount: amt.toString() });
    }
    list.sort((a, b) => b.height - a.height);
    return { busy: false, count: page.txs_count, list };
  })();
  cache.set(key, p);
  return p;
}

/* backward breadth first search from holder to creator, at most MAX_HOPS transfers */
async function traceFunding(holder, creator, firstHeight, cache) {
  let frontier = [{ acct: holder, before: firstHeight, chain: [] }];
  const seen = new Set([holder]);
  let note = "";
  for (let hop = 1; hop <= MAX_HOPS; hop++) {
    const next = [];
    const nodes = frontier.slice(0, NODES_PER_LEVEL);
    if (frontier.length > nodes.length) note = `capped at ${NODES_PER_LEVEL} accounts per hop`;
    for (let i = 0; i < nodes.length; i += 4) {
      if (requests > REQUEST_BUDGET) return { found: null, note: `request budget of ${REQUEST_BUDGET} reached` };
      const batch = await Promise.all(nodes.slice(i, i + 4).map((n) => incomingTransfers(n.acct, n.before, cache).then((r) => ({ n, r }))));
      for (const { n, r } of batch) {
        if (r.busy) { note = `${n.acct} not expanded (${r.count} transactions)`; continue; }
        const hit = r.list.find((t) => t.from === creator);
        if (hit) return { found: { hop, chain: [hit, ...n.chain] }, note };
        let added = 0;
        for (const t of r.list) {
          if (seen.has(t.from) || added >= FANIN_PER_NODE) continue;
          seen.add(t.from); added++;
          next.push({ acct: t.from, before: t.height, chain: [t, ...n.chain] });
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return { found: null, note };
}

async function run() {
  const btn = $("form").querySelector("button");
  btn.disabled = true; requests = 0;
  const token = $("token").value.trim();
  const creatorOverride = $("creator").value.trim();
  for (const id of ["token-panel", "holders", "flags"]) $(id).textContent = "Waiting";
  history.replaceState(null, "", "?token=" + encodeURIComponent(token) + (creatorOverride ? "&creator=" + encodeURIComponent(creatorOverride) : ""));
  try {
    await runInner(token, creatorOverride);
  } finally { btn.disabled = false; }
}

async function runInner(token, creatorOverride) {
  /* panel 1 */
  let block;
  $("chain").textContent = "Loading";
  try {
    block = await rpc("block", { finality: "final" });
    const h = block.header;
    $("chain").replaceChildren(
      el("div", {}, "Chain ", el("code", {}, "mainnet"), " via ", el("code", {}, RPC)),
      el("div", {}, "Final block ", el("code", {}, String(h.height)), " at ", el("code", {}, iso(h.timestamp_nanosec))),
      stamp(`read at block ${h.height}, ${iso(h.timestamp_nanosec)}`));
  } catch (e) {
    showError($("chain"), "Could not read the latest block.", e, "check your network, then press Read chain. If the RPC itself is down, try again in a minute; no other endpoint is configured.");
    for (const id of ["token-panel", "holders", "flags"]) $(id).textContent = "Not run: the chain connection failed.";
    return;
  }
  const H = block.header.height;
  const readStamp = `read at block ${H}, ${iso(block.header.timestamp_nanosec)}`;

  if (!token) {
    for (const id of ["token-panel", "holders", "flags"]) {
      showError($(id), "No token account entered.", new Error("token field is empty"), "type a NEP-141 token account id such as the one you want to inspect, then press Read chain.");
    }
    return;
  }

  /* panel 2 */
  let meta, decimals, creator, firstTx, first, txHashes;
  try {
    meta = await view(token, "ft_metadata", {}, H);
    decimals = meta.decimals;
    const page = await accountPage({ account_id: token, desc: false, limit: TOKEN_TX_PAGE });
    if (!page.account_txs || !page.account_txs.length) throw new Error(`${TXAPI}/v0/account returned no transactions for ${token}`);
    first = page.account_txs[0];
    txHashes = [...new Set(page.account_txs.map((t) => t.transaction_hash))];
    [firstTx] = await getTxs([first.transaction_hash]);
    creator = creatorOverride || firstTx.transaction.signer_id;
    $("token-panel").replaceChildren(
      el("div", {}, "Token ", acctLink(token), ": ", el("strong", {}, meta.name || "?"), " (", el("code", {}, meta.symbol || "?"), "), ", el("code", {}, `${decimals} decimals`)),
      el("div", {}, "Total transactions touching the token account: ", el("code", {}, String(page.txs_count))),
      el("div", {}, "First transaction ", txLink(first.transaction_hash, first.transaction_hash.slice(0, 12) + "..."), " in block ", el("code", {}, String(first.tx_block_height)), " at ", el("code", {}, iso(first.tx_block_timestamp))),
      el("div", {}, "Creator ", acctLink(creator), creatorOverride ? " (entered by you)" : " (signer of that transaction)"),
      stamp(`metadata ${readStamp}`));
  } catch (e) {
    showError($("token-panel"), `Could not read ${token}.`, e, "check the spelling of the token account (it must be a NEP-141 contract on mainnet that answers ft_metadata), then press Read chain. If the message is an HTTP 429 or a network error, wait a minute and retry.");
    for (const id of ["holders", "flags"]) $(id).textContent = "Not run: the token could not be read.";
    return;
  }

  /* panel 3 */
  let holders;
  try {
    $("holders").textContent = `Reading the first ${txHashes.length} transactions of the token account`;
    const txs = await getTxs(txHashes);
    const events = txs.flatMap((t) => tokenEvents(t, token)).sort((a, b) => a.height - b.height || (BigInt(a.ts) < BigInt(b.ts) ? -1 : 1));
    const byAcct = new Map();
    for (const ev of events) if (!byAcct.has(ev.to) && ev.to !== token) byAcct.set(ev.to, ev);
    holders = [...byAcct.values()].slice(0, MAX_HOLDERS);
    if (!holders.length) throw new Error(`no nep141 ft_transfer or ft_mint events found in the first ${txHashes.length} transactions of ${token}`);
    const bal = new Map();
    for (let i = 0; i < holders.length; i += 5) {
      await Promise.all(holders.slice(i, i + 5).map(async (h) => bal.set(h.to, await view(token, "ft_balance_of", { account_id: h.to }, H))));
    }
    holders.forEach((h, i) => { h.rank = i + 1; h.balance = bal.get(h.to); });
    renderHolders(holders, decimals, readStamp, null, txHashes.length);
  } catch (e) {
    showError($("holders"), "Could not list early holders.", e, "check that the token emits standard NEP-141 events, or press Read chain to retry. Tokens with over " + TOKEN_TX_PAGE + " opening transactions are read only for their first " + TOKEN_TX_PAGE + ".");
    $("flags").textContent = "Not run: no holder list.";
    return;
  }

  /* panel 4 */
  const cache = new Map();
  const results = new Map();
  const flagBox = $("flags");
  try {
    for (let i = 0; i < holders.length; i++) {
      const h = holders[i];
      flagBox.textContent = `Searching funding paths: holder ${i + 1} of ${holders.length} (${h.to}), ${requests} requests so far`;
      if (h.to === creator) { results.set(h.to, { creator: true }); continue; }
      let r;
      try { r = await traceFunding(h.to, creator, h.height, cache); }
      catch (e) { r = { error: e }; }
      results.set(h.to, r);
      renderHolders(holders, decimals, readStamp, results, txHashes.length);
      if (r.note && r.note.startsWith("request budget")) {
        for (const rest of holders.slice(i + 1)) results.set(rest.to, { found: null, note: "not searched: " + r.note });
        break;
      }
    }
    renderFlags(holders, results, creator, flagBox, H, block.header.timestamp_nanosec);
    renderHolders(holders, decimals, readStamp, results, txHashes.length);
  } catch (e) {
    showError(flagBox, "Funding search stopped.", e, "press Read chain to retry; results already shown in panel 3 are unaffected.");
  }
}

function renderHolders(holders, decimals, readStamp, results, scanned) {
  const rows = holders.map((h) => {
    const r = results && results.get(h.to);
    let flag = "searching";
    if (!results) flag = "pending";
    else if (r) {
      if (r.creator) flag = "is the creator";
      else if (r.error) flag = "search failed";
      else if (r.found) flag = `FLAGGED, hop ${r.found.hop}`;
      else flag = "none found";
    }
    return el("tr", {},
      el("td", { class: "n" }, String(h.rank)),
      el("td", {}, acctLink(h.to)),
      el("td", { class: "n" }, `${h.height}`),
      el("td", {}, txLink(h.hash, h.hash.slice(0, 8) + "...")),
      el("td", { class: "n" }, fmtAmount(h.amount, decimals)),
      el("td", { class: "n" }, fmtAmount(h.balance, decimals)),
      el("td", { class: flag.startsWith("FLAGGED") ? "flag" : "" }, flag));
  });
  $("holders").replaceChildren(
    el("table", {},
      el("thead", {}, el("tr", {}, ["#", "Account", "First block", "Tx", "Received", "Holds now", "Creator funded?"].map((t) => el("th", {}, t)))),
      el("tbody", {}, rows)),
    stamp(`First ${holders.length} receivers among the first ${scanned} token transactions. Balances ${readStamp}.`));
}

function renderFlags(holders, results, creator, box, H, tsns) {
  const flagged = holders.filter((h) => results.get(h.to) && results.get(h.to).found);
  const failed = holders.filter((h) => results.get(h.to) && results.get(h.to).error);
  const kids = [];
  kids.push(el("p", {}, el("strong", {}, `${flagged.length} of ${holders.length}`), " early holders have a transfer path from ", acctLink(creator), ` within ${MAX_HOPS} hops.`));
  for (const h of flagged) {
    const f = results.get(h.to).found;
    const hops = f.chain.map((t, i) => el("span", { class: "hop" },
      `hop ${i + 1}: `, acctLink(t.from), " sent ", el("code", {}, fmtNear(t.amount) + " NEAR"), " to ", acctLink(t.to), " in block ", el("code", {}, String(t.height)), ", tx ", txLink(t.hash, t.hash)));
    kids.push(el("div", { class: "path" }, el("strong", {}, `#${h.rank} `), acctLink(h.to), hops));
  }
  const notes = holders.filter((h) => results.get(h.to) && results.get(h.to).note);
  if (notes.length) kids.push(el("p", { class: "what" }, `Search notes: for ${notes.length} holders a funding source was skipped (over ${BUSY_TXS} transactions, a cap, or the request budget). Example: ${results.get(notes[0].to).note}`));
  for (const h of failed) {
    const msg = el("div", { class: "err" }, el("div", {}, `Search failed for ${h.to}.`), el("div", { class: "msg" }, results.get(h.to).error.message), el("div", { class: "next" }, "Next: press Read chain to retry."));
    kids.push(msg);
  }
  if (!flagged.length && !failed.length) kids.push(el("p", {}, "No path found. This does not prove the holders are unrelated to the creator; see the limits below."));
  kids.push(stamp(`Transfers searched back from each holder's first receipt, window ${WINDOW_BLOCKS} blocks. ${requests} requests, run after block ${H}.`));
  box.replaceChildren(...kids);
}

$("form").addEventListener("submit", (e) => { e.preventDefault(); run(); });

(function init() {
  const q = new URLSearchParams(location.search);
  if (q.get("token")) $("token").value = q.get("token");
  if (q.get("creator")) $("creator").value = q.get("creator");
  if (!$("token").value) {
    // The README names this opening as the one its replay reads; it is only a starting value, all data is read live.
    $("token").value = "phire.nearlytrade.near";
  }
  run();
})();
