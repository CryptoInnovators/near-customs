"use strict";

/* Customs: reads a NEAR token launch from public endpoints and traces opening buyers. */

let TX_API = "https://tx.main.fastnear.com";
let RPC = "https://rpc.mainnet.fastnear.com";
let NET = "mainnet";
const MAINNET_MARKET = "dclv2.ref-labs.near";
let MARKET = MAINNET_MARKET;
const HUBS = new Set([
  "system",
  "near",
  "wrap.near",
  "intents.near",
  "dclv2.ref-labs.near",
  "v2.ref-finance.near",
  "nearlytrade.near",
  "token.sweat",
  "aurora",
]);

const BUSY_TXS = 3000;
const MAX_HOPS = 3;
const MIN_SHARE_BPS = 5000n;
const WINDOW_S = 600;
const VEST_S = 86400;
const MAX_SCAN_PAGES = 10;
const SCAN_PAGE = 200;
const TRACE_WALLETS = 32;
const TRACE_PAGE_BUDGET = 300;
const TRACE_TX_BUDGET = 150;
const TX_BATCH = 20;
const CONCURRENCY = 12;
const TIMEOUT_MS = 45000;

const YOCTO = 10n ** 24n;
const NS = 10n ** 9n;
const DEFAULTS = { token: "phire.nearlytrade.near", creator: "provenhire.near" };

const CACHE_PREFIX = "customs.v1.";
const CACHE_TTL = 30 * 60 * 1000;
const NEARLY_API = "https://nearly.trade/api";

const state = {
  pages: 0,
  batches: 0,
  cached: 0,
  run: 0,
  txMemo: new Map(),
  busyMemo: new Map(),
};

class BudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = "BudgetError";
  }
}

/* ---------------------------------------------------------------- utilities */

function timeFormat(tsNs) {
  if (!tsNs) return "time not read";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(Number(tsNs / 1000000n)));
  } catch {
    return "time not read";
  }
}

function dayFormat(tsNs) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(Number(tsNs / 1000000n)));
  } catch {
    return "date not read";
  }
}

function fmtNear(yocto) {
  const n = Number(yocto) / 1e24;
  if (!Number.isFinite(n)) return "?";
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  if (n < 1) return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (n < 100) return n.toFixed(2);
  return Math.round(n).toLocaleString("en-US");
}

function fmtTokens(raw, decimals) {
  const d = Number.isInteger(decimals) ? decimals : 24;
  const n = Number(raw) / Math.pow(10, d);
  if (!Number.isFinite(n)) return "?";
  if (n === 0) return "0";
  if (n >= 100000) {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(n);
  }
  if (n >= 1) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
  }
  return n.toPrecision(3);
}

function pct1(part, total) {
  if (!total) return "0.0";
  return (Number(part) * 100 / Number(total)).toFixed(1);
}

function minHop(cost) {
  return (cost / 10000n) * MIN_SHARE_BPS + ((cost % 10000n) * MIN_SHARE_BPS) / 10000n;
}

function isHub(id) {
  return HUBS.has(id);
}

function hashKey(parts) {
  const s = JSON.stringify(parts);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return CACHE_PREFIX + (h >>> 0).toString(36);
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const hit = JSON.parse(raw);
    if (!hit || Date.now() - hit.t > CACHE_TTL) return null;
    state.cached++;
    return hit.body;
  } catch {
    return null;
  }
}

function writeCache(key, body) {
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), body }));
  } catch {
    /* quota or private mode: the page still works, it just reads again next time */
  }
}

function tidy(text) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > 220 ? flat.slice(0, 220) + "..." : flat;
}

/* ----------------------------------------------------------------- fetching */

async function postJSON(url, body, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const { res, text } = await postWithRetry(fetch, url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }, { tries: 5, waitMs: 900 });
    if (!res.ok) {
      throw new Error(label + " returned HTTP " + res.status + ". " + tidy(text));
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(label + " returned a body that is not JSON.");
    }
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(label + " did not answer within 45 seconds.");
    }
    if (err instanceof TypeError) {
      throw new Error(label + " could not be reached from this browser. " + tidy(err.message));
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function normalizePage(json) {
  const rows = Array.isArray(json.account_txs) ? json.account_txs : [];
  return {
    list: rows.map((t) => ({
      hash: String(t.transaction_hash || ""),
      height: Number(t.tx_block_height) || 0,
      ts: BigInt(t.tx_block_timestamp || 0),
    })),
    resume: json.resume_token || null,
    count: Number(json.txs_count) || 0,
  };
}

async function accountPage(account, extra, label) {
  const body = Object.assign({ account_id: account }, extra);
  const key = hashKey(["account", body]);
  const cached = readCache(key);
  if (cached) return normalizePage(cached);
  const json = await postJSON(TX_API + "/v0/account", body, label || "The FastNEAR account list");
  writeCache(key, json);
  return normalizePage(json);
}

async function txBatch(hashes, trace) {
  const key = hashKey(["txs", hashes.slice().sort()]);
  const cached = readCache(key);
  if (cached) return cached.transactions.map(parseTx);
  if (trace) {
    if (state.batches >= TRACE_TX_BUDGET) {
      throw new BudgetError("The funding search reached its " + TRACE_TX_BUDGET + " receipt batches.");
    }
    state.batches++;
  }
  const json = await postJSON(
    TX_API + "/v0/transactions",
    { tx_hashes: hashes },
    "The FastNEAR transaction read"
  );
  const rows = Array.isArray(json.transactions) ? json.transactions : [];
  writeCache(key, { transactions: rows });
  return rows.map(parseTx);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function fetchAllTxs(hashes, trace) {
  const unique = Array.from(new Set(hashes.filter(Boolean)));
  const pending = unique.filter((h) => !state.txMemo.has(h));
  const batches = [];
  for (let i = 0; i < pending.length; i += TX_BATCH) {
    batches.push(pending.slice(i, i + TX_BATCH));
  }
  let done = 0;
  await mapLimit(batches, CONCURRENCY, async (batch) => {
    const txs = await txBatch(batch, trace);
    txs.forEach((tx) => state.txMemo.set(tx.hash, tx));
    done++;
    progress(
      "Read " + done + " of " + batches.length + " receipt batches" +
      (pending.length !== unique.length ? " (" + (unique.length - pending.length) + " cached)" : "") + "."
    );
    await new Promise((r) => setTimeout(r, 80));
  });
  return unique.map((h) => state.txMemo.get(h)).filter(Boolean);
}

/* -------------------------------------------------------------- tx parsing  */

function ftMoves(tx, token) {
  const out = [];
  for (const r of tx.receipts) {
    if (r.recv !== token) continue;
    for (const log of r.logs) {
      const e = events(log);
      if (!e || e.standard !== "nep141" || e.event !== "ft_transfer") continue;
      for (const d of (Array.isArray(e.data) ? e.data : [])) {
        out.push({
          tx: tx.hash,
          from: String(d.old_owner_id || ""),
          to: String(d.new_owner_id || ""),
          amount: BigInt(d.amount || 0),
          memo: typeof d.memo === "string" ? d.memo : null,
          ts: r.ts,
          height: r.height,
        });
      }
    }
  }
  return out;
}

function costInto(tx, market) {
  let total = 0n;
  for (const r of tx.receipts) {
    if (r.recv !== "wrap.near") continue;
    for (const log of r.logs) {
      if (!log.startsWith("Transfer ")) continue;
      const parts = log.slice("Transfer ".length).split(" ");
      if (parts.length < 5 || parts[1] !== "from" || parts[3] !== "to") continue;
      if (parts[4] !== market) continue;
      try {
        total += BigInt(parts[0]);
      } catch {
        /* a malformed log line is not a payment */
      }
    }
  }
  return total;
}

/* -------------------------------------------------------------- the rule    */

function checkPath(path, buy, creator) {
  if (buy.wallet === creator) return { ok: true };
  if (buy.cost === 0n) return { ok: false, reason: "The buy moved no wNEAR into the market." };
  if (!path.length) return { ok: false, reason: "No path was found." };
  if (path.length > MAX_HOPS) return { ok: false, reason: "The path is longer than three hops." };
  if (path[0].from !== creator) return { ok: false, reason: "The first hop does not leave the creator." };
  const floor = minHop(buy.cost);
  for (let i = 0; i < path.length; i++) {
    const e = path[i];
    if (isHub(e.from) && e.from !== creator) {
      return { ok: false, reason: "The path passes through hub " + e.from + "." };
    }
    if (isHub(e.to)) return { ok: false, reason: "The path passes through hub " + e.to + "." };
    if (e.yocto < floor) return { ok: false, reason: "Hop " + (i + 1) + " is below half the buy cost." };
    if (i > 0) {
      if (path[i - 1].to !== e.from) return { ok: false, reason: "The path is broken at hop " + (i + 1) + "." };
      if (path[i - 1].ts >= e.ts) return { ok: false, reason: "The path is out of time order." };
    }
  }
  const last = path[path.length - 1];
  if (last.to !== buy.wallet) return { ok: false, reason: "The path does not end at the buyer." };
  if (last.ts >= buy.ts) return { ok: false, reason: "The last hop landed after the buy." };
  return { ok: true };
}

async function isBusy(account) {
  if (state.busyMemo.has(account)) return state.busyMemo.get(account);
  const page = await accountPage(
    account,
    { desc: true, limit: 1 },
    "The FastNEAR busy check"
  );
  const busy = page.count >= BUSY_TXS;
  state.busyMemo.set(account, busy);
  return busy;
}

async function trace(wallet, buy, runId) {
  if (wallet === buy.creator) return { status: "creator", path: [], note: "" };
  if (buy.cost === 0n) {
    return { status: "unpriced", path: [], note: "The buy moved no wNEAR into the market, so the half-cost floor cannot be computed." };
  }
  if (isHub(wallet)) {
    return { status: "unlinked", path: [], note: "The buyer account is a listed hub, so a path through it would link nothing." };
  }
  const floor = minHop(buy.cost);
  if (floor === 0n) {
    return { status: "unlinked", path: [], note: "The buy cost rounds to a zero half-cost floor." };
  }

  let frontier = [{ node: wallet, ts: buy.ts, height: buy.height, tail: [] }];
  const seen = [wallet];

  async function inflows(account, beforeTs, beforeHeight) {
    if (state.pages >= TRACE_PAGE_BUDGET) {
      throw new BudgetError("The funding search reached its " + TRACE_PAGE_BUDGET + " account pages.");
    }
    state.pages++;
    const page = await accountPage(
      account,
      {
        is_receiver: true,
        is_success: true,
        desc: true,
        limit: 60,
        to_tx_block_height: beforeHeight,
      },
      "The FastNEAR inflow list for " + account
    );
    const txs = await fetchAllTxs(page.list.map((t) => t.hash), true);
    const edges = [];
    for (const tx of txs) {
      for (const e of edgesInto(tx, account)) {
        if (e.ts < beforeTs && e.yocto >= floor) edges.push(e);
      }
    }
    return edges;
  }

  try {
    for (let depth = 0; depth < MAX_HOPS; depth++) {
      if (runId !== state.run) return { status: "incomplete", path: [], note: "A newer inspection replaced this one." };
      const next = [];
      for (const entry of frontier) {
        const inflowsList = await inflows(entry.node, entry.ts, entry.height);
        for (const e of inflowsList) {
          if (e.yocto < floor || e.ts >= entry.ts) continue;
          const path = [e, ...entry.tail];
          if (e.from === buy.creator) {
            const verdict = checkPath(path, buy, buy.creator);
            if (verdict.ok) return { status: "linked", path, note: "" };
            continue;
          }
          if (isHub(e.from) || seen.includes(e.from)) continue;
          if (await isBusy(e.from)) continue;
          seen.push(e.from);
          next.push({ node: e.from, ts: e.ts, height: e.height, tail: path });
        }
      }
      if (!next.length) break;
      frontier = next;
    }
    return { status: "unlinked", path: [], note: "No path to the creator within three hops, each before the buy and each at least half its cost." };
  } catch (err) {
    if (err instanceof BudgetError) {
      return { status: "not_traced", path: [], note: err.message + " This wallet was not ruled out." };
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ reading */

async function rpcBatch(items, label) {
  // FastNEAR's RPC rejects JSON-RPC batch arrays, so each query is its own request.
  return mapLimit(items, 8, async (params, i) => {
    try {
      const json = await postJSON(RPC, { jsonrpc: "2.0", id: i + 1, method: "query", params }, label);
      return json && typeof json === "object" ? json : { error: { message: label + " returned an unexpected shape." } };
    } catch (err) {
      return { error: { message: err.message } };
    }
  });
}

function decodeBase64Array(bytes) {
  try {
    const bin = String.fromCharCode.apply(null, bytes);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

function b64(value) {
  return btoa(JSON.stringify(value));
}

async function readBalances(token, wallets) {
  const heightJson = await postJSON(
    RPC,
    { jsonrpc: "2.0", id: "block", method: "block", params: { finality: "final" } },
    "The block height read"
  );
  const height = heightJson && heightJson.result && heightJson.result.header
    ? heightJson.result.header.height
    : null;
  if (!height) throw new Error("The RPC block read returned no final block height.");

  const out = { height, decimals: 24, symbol: "", balances: new Map(), errors: [] };
  const items = [{
    request_type: "call_function",
    block_id: height,
    account_id: token,
    method_name: "ft_metadata",
    args_base64: b64({}),
  }];
  wallets.forEach((w) => items.push({
    request_type: "call_function",
    block_id: height,
    account_id: token,
    method_name: "ft_balance_of",
    args_base64: b64({ account_id: w }),
  }));

  for (let i = 0; i < items.length; i += 40) {
    const chunk = items.slice(i, i + 40);
    const res = await rpcBatch(chunk, "The RPC balance read");
    res.forEach((r, j) => {
      const index = i + j;
      if (r.error) {
        out.errors.push("RPC: " + (r.error.message || JSON.stringify(r.error)));
        return;
      }
      const bytes = r.result && Array.isArray(r.result.result) ? r.result.result : null;
      if (!bytes) return;
      const text = decodeBase64Array(bytes);
      if (!text) return;
      if (index === 0) {
        try {
          const meta = JSON.parse(text);
          if (Number.isInteger(meta.decimals) && meta.decimals >= 0 && meta.decimals <= 36) {
            out.decimals = meta.decimals;
          }
          out.symbol = String(meta.symbol || "");
        } catch {
          out.errors.push("Token metadata did not parse. Amounts are shown with 24 decimals.");
        }
        return;
      }
      const wallet = wallets[index - 1];
      try {
        out.balances.set(wallet, BigInt(JSON.parse(text)));
      } catch {
        out.errors.push("Balance for " + wallet + " did not parse.");
      }
    });
  }
  return out;
}

async function scanToken(token, created) {
  const until = created.ts + BigInt(VEST_S + 3600) * NS;
  let resume = null;
  let pages = 0;
  let complete = false;
  const list = [];
  while (pages < MAX_SCAN_PAGES) {
    const body = {
      account_id: token,
      desc: false,
      limit: SCAN_PAGE,
      from_tx_block_height: created.height,
    };
    if (resume) body.resume_token = resume;
    progress("Reading token transaction page " + (pages + 1) + " of at most " + MAX_SCAN_PAGES + ".");
    const json = await postJSON(TX_API + "/v0/account", body, "The token transaction list");
    const page = normalizePage(json);
    pages++;
    let stop = false;
    for (const t of page.list) {
      if (t.ts >= until) {
        stop = true;
        break;
      }
      list.push(t);
    }
    if (stop) {
      complete = true;
      break;
    }
    if (!page.resume) {
      complete = true;
      break;
    }
    resume = page.resume;
  }
  return { list, pages, complete };
}

async function inspect(token, creator, runId, hooks = {}) {
  NET = String(token).endsWith(".testnet") ? "testnet" : "mainnet";
  TX_API = NET === "testnet" ? "https://tx.test.fastnear.com" : "https://tx.main.fastnear.com";
  RPC = NET === "testnet" ? "https://rpc.testnet.fastnear.com" : "https://rpc.mainnet.fastnear.com";
  state.pages = 0;
  state.batches = 0;
  state.cached = 0;
  state.txMemo = new Map();
  state.busyMemo = new Map();

  // Nearly's trade tape supplies trader, side, raw amounts, block, timestamp and receipt hash.
  // Use it for opening buyers; FastNEAR remains the source for funding-path receipts.
  MARKET = hooks.market || MAINNET_MARKET;
  let tape = hooks.nearlyTrades;
  if (!tape && !hooks.skipNearly) {
    const response = await fetch(NEARLY_API + "/trades/" + encodeURIComponent(token));
    if (response.ok) tape = await response.json();
  }
  tape = Array.isArray(tape) ? tape.filter((t) => t.side === "buy" && t.trader && t.ts_ms && t.block) : [];
  let created, scan = { list: [], pages: 0, complete: true }, txs = [], moves = [], sales = [];
  let t0, t0Height;
  if (tape.length) {
    const firstTrade = tape.reduce((a, b) => Number(a.ts_ms) < Number(b.ts_ms) ? a : b);
    created = { ts: BigInt(firstTrade.ts_ms) * 1000000n, height: Number(firstTrade.block), hash: firstTrade.receipt };
    t0 = created.ts;
    t0Height = created.height;
    const end = Number(firstTrade.ts_ms) + WINDOW_S * 1000;
    const grouped = new Map();
    for (const trade of tape) {
      if (Number(trade.ts_ms) >= end) continue;
      const wallet = String(trade.trader);
      const b = grouped.get(wallet) || { wallet, tokens: 0n, cost: 0n, first: BigInt(trade.ts_ms) * 1000000n, firstHeight: Number(trade.block), firstTx: String(trade.receipt || ""), txs: new Set() };
      b.tokens += BigInt(trade.token_amount || 0);
      b.cost += BigInt(trade.near_amount || 0);
      if (BigInt(trade.ts_ms) * 1000000n < b.first) { b.first = BigInt(trade.ts_ms) * 1000000n; b.firstHeight = Number(trade.block); b.firstTx = String(trade.receipt || ""); }
      if (trade.receipt) b.txs.add(String(trade.receipt));
      grouped.set(wallet, b);
    }
    sales = [...grouped.values()];
    if (!sales.length) throw new Error("Nearly returned no opening buys for " + token + ".");
    sales.sort((a,b) => a.first < b.first ? -1 : 1);
    moves = sales.map((b) => ({ from: MARKET, to: b.wallet, amount: b.tokens, ts: b.first, height: b.firstHeight, tx: b.firstTx }));
  } else {
    progress("Reading the token's first transaction.");
    const first = await accountPage(token, { desc: false, limit: 1 }, "The FastNEAR first transaction read");
    if (!first.list.length) throw new Error("FastNEAR returned no transactions for " + token + ".");
    created = first.list[0];
    progress("Reading the token's first day.");
    scan = await scanToken(token, created);
    if (!scan.list.length) throw new Error("FastNEAR returned no usable transactions for " + token + ".");
    progress("Fetching receipts for " + scan.list.length + " token transactions.");
    txs = await fetchAllTxs(scan.list.map((t) => t.hash), false);
    if (runId !== state.run) return null;
    for (const tx of txs) for (const m of ftMoves(tx, token)) moves.push(m);
    moves.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    sales = moves.filter((m) => m.from === MARKET && m.to !== token && m.memo !== "tax");
    if (!sales.length) throw new Error("No sales from " + MARKET + " appeared in this token's first day.");
    t0 = sales[0].ts;
    t0Height = sales[0].height;
  }
  const winEnd = t0 + BigInt(WINDOW_S) * NS;
  const vestEnd = t0 + BigInt(VEST_S) * NS;

  const buyers = new Map();
  for (const m of tape.length ? [] : sales) {
    if (m.ts >= winEnd) continue;
    const b = buyers.get(m.to) || {
      wallet: m.to,
      tokens: 0n,
      first: m.ts,
      firstHeight: m.height,
      firstTx: m.tx,
      txs: new Set(),
    };
    b.tokens += m.amount;
    if (m.ts < b.first) {
      b.first = m.ts;
      b.firstHeight = m.height;
      b.firstTx = m.tx;
    }
    b.txs.add(m.tx);
    buyers.set(m.to, b);
  }

  const list = tape.length ? sales.sort((a, b) => (a.tokens < b.tokens ? 1 : -1)) : Array.from(buyers.values()).sort((a, b) => (a.tokens < b.tokens ? 1 : -1));
  const openingTokens = list.reduce((sum, b) => sum + b.tokens, 0n);

  progress("Pricing " + list.length + " opening buys from wrap.near logs.");
  for (const b of list) {
    if (!tape.length) {
      let cost = 0n;
      for (const hash of b.txs) {
        const tx = state.txMemo.get(hash);
        if (tx) cost += costInto(tx, MARKET);
      }
      b.cost = cost;
    }

    let sold = 0n;
    for (const m of moves) {
      if (m.from !== b.wallet) continue;
      if (m.ts < b.first) continue;
      if (m.ts >= vestEnd) continue;
      sold += m.amount;
    }
    // Outflow can exceed the opening buy when the wallet bought more later; the share is of what it received.
    b.sold = sold > b.tokens ? b.tokens : sold;
    b.remaining = b.tokens - b.sold;
  }

  if (typeof hooks.onBuyers === "function") hooks.onBuyers({ token, creator, created, scan, txs, moves, sales, t0, t0Height, winEnd, vestEnd, list, openingTokens });
  globalThis.__buyersAt = typeof performance !== "undefined" ? performance.now() : undefined;

  progress("Reading balances at a final block.");
  let balances = null;
  let balanceError = "";
  try {
    if (!tape.length) balances = await readBalances(token, list.map((b) => b.wallet));
  } catch (err) {
    balanceError = err.message;
  }

  progress("Tracing funding for the first " + Math.min(TRACE_WALLETS, list.length) + " priced wallets.");
  const eligible = [];
  let started = 0;
  let budgetHit = false;
  for (const b of list) {
    if (b.wallet === creator) b.trace = { status: "creator", path: [], note: "" };
    else if (b.cost === 0n) b.trace = { status: "unpriced", path: [], note: "The buy moved no wNEAR into the market, so the half-cost floor cannot be computed." };
    else if (eligible.length < TRACE_WALLETS) eligible.push(b);
    else b.trace = { status: "not_traced", path: [], note: "The page traces the " + TRACE_WALLETS + " largest priced buys. This wallet sits outside that limit and was not ruled out." };
    if (typeof hooks.onTrace === "function" && b.trace) hooks.onTrace(b);
  }
  await mapLimit(eligible, CONCURRENCY, async (b) => {
    if (runId !== state.run) return;
    if (budgetHit) {
      b.trace = { status: "not_traced", path: [], note: "The funding search reached its receipt budget earlier. This wallet was not ruled out." };
      return;
    }
    started++;
    progress("Tracing " + started + " of " + eligible.length + ": " + b.wallet);
    try {
      b.trace = await trace(b.wallet, { wallet: b.wallet, cost: b.cost, ts: b.first, height: b.firstHeight, creator }, runId);
      if (b.trace.status === "not_traced") budgetHit = true;
    } catch (err) {
      b.trace = { status: "not_traced", path: [], note: "A read for this wallet failed (" + tidy(err.message) + "). It was not ruled out." };
    }
    if (typeof hooks.onTrace === "function") hooks.onTrace(b);
  });

  if (runId !== state.run) return null;

  return {
    token,
    creator,
    created,
    scan,
    txs,
    moves,
    sales,
    t0,
    t0Height,
    winEnd,
    vestEnd,
    list,
    openingTokens,
    balances,
    balanceError,
    tracePages: state.pages,
    traceBatches: state.batches,
    cached: state.cached,
  };
}

globalThis.CustomsInspector = { inspect: (token, creator, hooks = {}) => inspect(token, creator, ++state.run, hooks), setProgress: (fn) => { progress = fn; } };

/* ---------------------------------------------------------------- rendering */

const sheet = document.getElementById("sheet");
const resultEl = document.getElementById("result");
const buyersBody = document.getElementById("buyers-body");
const buyersMeta = document.getElementById("buyers-meta");
const notesBody = document.getElementById("notes-body");
const notesMeta = document.getElementById("notes-meta");
const tokenInput = document.getElementById("token");
const creatorInput = document.getElementById("creator");
const form = document.getElementById("inspect-form");
const button = document.getElementById("inspect");
const ID_RULE = /^(?:[a-f0-9]{64}|(?:[a-z0-9]+[-_])*[a-z0-9]+(?:\.(?:[a-z0-9]+[-_])*[a-z0-9]+)*)$/;

let progressLine = null;

function progress(message) {
  if (!progressLine) return;
  progressLine.textContent = message;
}

function showWorking(message) {
  setField("green");
  resultEl.dataset.state = "reading";
  resultEl.innerHTML = '<p class="progress busy" data-progress>' + esc(message) + "</p>";
  progressLine = resultEl.querySelector("[data-progress]");
  document.getElementById("bar").innerHTML = "";
  buyersBody.innerHTML = "";
  buyersMeta.textContent = "Reading.";
  notesBody.innerHTML = "";
  notesMeta.textContent = "Reading.";
}

function showError(message, token) {
  setField("green");
  resultEl.dataset.state = "error";
  resultEl.innerHTML =
    '<div class="figure" aria-hidden="true">?</div>' +
    '<div class="verdict-line" data-error><b>Could not read ' + esc(token) + '.</b><br><code class="plain">' + esc(message) + "</code><br>" +
    "The page stopped at the first failed call. Lodge the declaration again to read it fresh.</div>" +
    '<div class="stamp-zone">' + stampHtml("unread", "read failed", {}) + "</div>";
  document.getElementById("bar").innerHTML = "";
  buyersBody.innerHTML = '<p class="empty-line">No line items for ' + esc(token) + ".</p>";
  buyersMeta.textContent = "Read failed.";
  notesBody.innerHTML = "";
  notesMeta.textContent = "Read failed.";
}

function statusInfo(b) {
  switch (b.trace.status) {
    case "creator": return { cls: "red", label: "Creator", funded: true };
    case "linked": return { cls: "red", label: "Creator funded, " + b.trace.path.length + (b.trace.path.length === 1 ? " hop" : " hops"), funded: true };
    case "unpriced": return { cls: "dash", label: "Not priced" };
    case "not_traced": return { cls: "dash", label: "Not checked" };
    default: return { cls: "", label: "No link" };
  }
}

function renderVerdict(data) {
  const total = data.openingTokens || 0n;
  const counts = { funded: 0, unlinked: 0, unpriced: 0, unchecked: 0 };
  let fundedTokens = 0n;
  for (const b of data.list) {
    if (b.trace.status === "creator" || b.trace.status === "linked") {
      counts.funded++;
      fundedTokens += b.tokens;
    } else if (b.trace.status === "unpriced") counts.unpriced++;
    else if (b.trace.status === "not_traced") counts.unchecked++;
    else counts.unlinked++;
  }
  const n = data.list.length;
  const share = total ? pct1(fundedTokens, total) : "0.0";
  const direct = data.list.filter((b) => b.trace.status === "creator").length;
  const viaHops = data.list.filter((b) => b.trace.status === "linked").length;
  const extra = (counts.unchecked ? " " + counts.unchecked + " were not checked." : "") + (counts.unpriced ? " " + counts.unpriced + " buys had no readable wNEAR cost." : "");

  let kind;
  let sentence;
  if (!n) {
    kind = "empty";
    sentence = "The market paid no wallets in the first ten minutes after the first sale.";
  } else if (counts.funded) {
    kind = "linked";
    sentence = counts.funded + " of " + n + " opening buyers received creator money from <b>" + esc(data.creator) + "</b>: " + direct + " direct, " + viaHops + " through other wallets." + esc(extra);
  } else if (counts.unchecked) {
    kind = "incomplete";
    sentence = "No opening buy traced back to " + esc(data.creator) + " in the wallets checked. " + counts.unchecked + " of " + n + " buyers were not checked.";
  } else {
    kind = "no_link";
    sentence = "No opening buy traces back to " + esc(data.creator) + " within three hops before the buy. " + counts.unlinked + " of " + n + " buyers were ruled out." + esc(extra);
  }

  const block = data.balances ? data.balances.height : null;
  const sub = block ? "block " + block.toLocaleString("en-US") : "block not read";
  const stamp = kind === "empty" ? stampHtml("pass", "nothing to declare", { delay: 400 }) : stampHtml(kind, sub, { delay: 400 });
  resultEl.dataset.state = "done";
  resultEl.innerHTML =
    '<div class="figure" data-share>' + share + "%</div>" +
    '<p class="verdict-line">' + sentence + "<br><span class=\"prov\">" + esc(data.token) + ", first sale " + esc(dayFormat(data.t0)) + "</span></p>" +
    '<div class="stamp-zone" data-verdict="' + kind + '">' + stamp + "</div>";

  const seg = (cls, count, title) => (count ? '<i class="' + cls + '" style="flex:' + count + ' 1 0" title="' + title + '"></i>' : "");
  document.getElementById("bar").innerHTML =
    '<div class="barstrip" aria-hidden="true">' + seg("funded", counts.funded, "creator funded") + seg("unlinked", counts.unlinked, "no creator link") + seg("unpriced", counts.unpriced, "not priced") + seg("unchecked", counts.unchecked, "not checked") + "</div>" +
    '<ul class="legend">' +
      '<li><span class="sw funded"></span>Creator funded <b>' + counts.funded + "</b></li>" +
      '<li><span class="sw"></span>No creator link <b>' + counts.unlinked + "</b></li>" +
      '<li><span class="sw unpriced"></span>Not priced <b>' + counts.unpriced + "</b></li>" +
      '<li><span class="sw unchecked"></span>Not checked <b>' + counts.unchecked + "</b></li></ul>";

  if (counts.funded) {
    document.body.style.setProperty("--field-delay", "400ms");
    setField("red");
  } else setField("green");

  buyersMeta.textContent = n + (n === 1 ? " buyer" : " buyers") + ", read at block " + (block ? block.toLocaleString("en-US") : "not read") + ", first sale " + dayFormat(data.t0);
  notesMeta.textContent = "Read at block " + (block ? block.toLocaleString("en-US") : "not read");
}

function chain(txShort, tx) {
  return refHtml("tx", tx, NET, shorten(txShort));
}

function renderEvidence(b, data) {
  const decimals = data.balances ? data.balances.decimals : 24;
  const buyLine = "<p>The market paid " + esc(b.wallet) + " " + esc(fmtTokens(b.tokens, decimals)) + " tokens for " +
    (b.cost ? esc(fmtNear(b.cost)) + " NEAR" : "a cost this page could not read") + " in " + chain(b.firstTx, b.firstTx) +
    " at " + esc(timeFormat(b.first)) + ", block " + b.firstHeight.toLocaleString("en-US") + ".</p>";
  if (b.trace.status === "linked") {
    const hops = b.trace.path.map((e, i) =>
      '<li><span class="hop-n">' + (i + 1) + "</span>  " + esc(e.from) + '<span class="gt">&gt;</span>' + esc(e.to) + "  " +
      "<b>" + esc(fmtNear(e.yocto)) + " NEAR</b>  tx " + chain(e.tx, e.tx) + "  " + esc(timeFormat(e.ts)) + "</li>").join("");
    return '<ol class="path">' + hops + "</ol>" + buyLine;
  }
  if (b.trace.status === "creator") return "<p>The buyer is the creator account: the creator's own buy.</p>" + buyLine;
  return "<p>" + esc(b.trace.note || "No path to the creator was found.") + "</p>" + buyLine;
}

function renderRows(data) {
  if (!data.list.length) {
    buyersBody.innerHTML = '<p class="empty-line">No line items. The market paid no opening wallets.</p>';
    return;
  }
  const decimals = data.balances ? data.balances.decimals : 24;
  const rows = data.list.map((b, i) => {
    const tag = statusInfo(b);
    const balance = data.balances && data.balances.balances.has(b.wallet)
      ? fmtTokens(data.balances.balances.get(b.wallet), decimals) : "not read";
    const soldPct = b.tokens ? pct1(b.sold, b.tokens) + "%" : "0.0%";
    const paid = b.cost ? fmtNear(b.cost) + " NEAR" : "not found";
    const open = '<button type="button" class="toggle" aria-expanded="false" aria-controls="ev-' + i + '">Evidence</button>';
    return '<tr class="line print-line' + (tag.funded ? " funded" : "") + '" style="--i:' + Math.min(i, 12) + '" data-row data-status="' + esc(b.trace.status) + '">' +
      '<td class="n" data-label="No.">' + String(i + 1).padStart(2, "0") + "</td>" +
      '<td class="wallet-cell" data-label="Wallet" data-wallet>' + refHtml("account", b.wallet, NET) + "</td>" +
      '<td class="r" data-col="a" data-label="Received"><span class="tok">' + esc(fmtTokens(b.tokens, decimals)) + "</span></td>" +
      '<td class="r" data-col="b" data-label="Still holds"><span class="tok">' + esc(balance) + "</span></td>" +
      '<td class="r" data-col="c" data-label="Paid"><span class="tok">' + esc(paid) + "</span></td>" +
      '<td class="r" data-col="d" data-label="Sold in 24h"><span class="tok">' + soldPct + '</span><span class="raw">' + esc(fmtTokens(b.sold, decimals)) + " tokens</span></td>" +
      '<td data-col="e" data-label="First buy"><span class="tok">' + esc(timeFormat(b.first)) + '</span><span class="raw">block ' + b.firstHeight.toLocaleString("en-US") + "</span></td>" +
      '<td class="stateCell" data-label="Link"><span class="tag ' + tag.cls + '">' + esc(tag.label) + "</span> " + open + "</td></tr>" +
      '<tr class="evidence-row" id="ev-' + i + '"><td colspan="8"><div class="ex"><div><div class="evidence">' + renderEvidence(b, data) + "</div></div></div></td></tr>";
  }).join("");
  buyersBody.innerHTML = '<table class="ledger insp"><thead><tr><th class="r">No.</th><th>Wallet</th><th class="r">Received</th><th class="r">Still holds</th><th class="r">Paid</th><th class="r">Sold in 24h</th><th>First buy</th><th>Link</th></tr></thead><tbody>' + rows + "</tbody></table>";
}

function renderMethod(data) {
  const block = data.balances ? data.balances.height.toLocaleString("en-US") : "not read";
  const rows = [
    ["Market", MARKET],
    ["Opening window", WINDOW_S + " s after the first sale"],
    ["First sale", timeFormat(data.t0) + ", block " + data.t0Height.toLocaleString("en-US")],
    ["Token receipts", data.txs.length.toLocaleString("en-US")],
    ["Opening buyers", String(data.list.length)],
    ["Tokens sold", fmtTokens(data.openingTokens, data.balances ? data.balances.decimals : 24)],
    ["Trace budget", state.pages + " pages, " + state.batches + " batches"],
    ["Response cache", state.cached + " reused"],
  ];
  notesBody.innerHTML = '<div class="cells">' + rows.map(([k, v], i) =>
    '<div class="box"><p class="cap"><span class="no">' + (i + 1) + "</span><span>" + esc(k) + '</span></p><p class="val key">' + esc(v) + "</p></div>").join("") + "</div>";

  const notes = [];
  notes.push("Balances and metadata are read at final block " + block + ". Receipts are read once and kept for 30 minutes in this browser.");
  notes.push("Funding paths follow plain NEAR transfers and Intents withdrawals up to three hops. Each hop is at least half the wNEAR the buy paid into " + MARKET + ".");
  if (data.scan.list.length && !data.scan.complete) {
    notes.push("The token scan stopped at " + MAX_SCAN_PAGES + " pages before the 24 hour mark, so Sold counts transfers up to that page.");
  }
  if (data.balanceError) notes.push("Balances could not be read: " + data.balanceError + " Amounts are shown with 24 decimals.");
  if (data.balances && data.balances.errors.length) notes.push("Some balance calls failed (" + data.balances.errors[0] + "). Those rows say not read.");
  if (data.list.some((b) => b.trace.status === "not_traced")) {
    notes.push("Not checked marks a wallet where the receipt budget or the " + TRACE_WALLETS + " wallet limit was reached first.");
  }
  notesBody.insertAdjacentHTML("beforeend", '<p class="notes-text">' + esc(notes.join(" ")) + "</p>");
}

/* ------------------------------------------------------------------- wiring */

function setBusy(busy) {
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
  button.textContent = busy ? "Lodging" : "Lodge declaration";
  sheet.setAttribute("aria-busy", busy ? "true" : "false");
}

function markInvalid(boxId, inputEl, show) {
  const box = document.getElementById(boxId);
  box.classList.toggle("invalid", show);
  const old = box.querySelector(".err-msg");
  if (old) old.remove();
  if (show) {
    box.querySelector(".cap").insertAdjacentHTML("afterend", '<p class="err-msg">Account ids end in .near, .testnet or are 64 hex characters</p>');
    inputEl.focus();
  }
}

async function runInspection() {
  const token = tokenInput.value.trim().toLowerCase();
  const creator = creatorInput.value.trim().toLowerCase();
  markInvalid("box-token", tokenInput, false);
  markInvalid("box-creator", creatorInput, false);
  if (!ID_RULE.test(token) || token.length > 64) { markInvalid("box-token", tokenInput, true); return; }
  if (!ID_RULE.test(creator) || creator.length > 64) { markInvalid("box-creator", creatorInput, true); return; }
  if (token === creator) {
    showError("The token account and the creator account are the same. Name the token contract and the account that launched it.", token);
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("token", token);
  url.searchParams.set("creator", creator);
  window.history.replaceState(null, "", url);

  state.run++;
  const runId = state.run;
  setBusy(true);
  showWorking("Reading " + token + " and its first day of trades.");

  try {
    const data = await inspect(token, creator, runId);
    if (!data || runId !== state.run) return;
    await new Promise((r) => setTimeout(r, 400));
    renderVerdict(data);
    renderRows(data);
    renderMethod(data);
    watchStamps(document);
  } catch (err) {
    if (runId !== state.run) return;
    showError(err && err.message ? err.message : String(err), token);
    watchStamps(document);
  } finally {
    if (runId === state.run) {
      setBusy(false);
      progressLine = null;
    }
  }
}

if (form) {
buyersBody.addEventListener("click", (event) => {
  if (event.target.closest("a, button.copy")) return;
  const tr = event.target.closest("tr.line");
  if (!tr) return;
  const ev = tr.nextElementSibling;
  const open = !tr.classList.contains("is-open");
  tr.classList.toggle("is-open", open);
  ev.classList.toggle("is-open", open);
  ev.querySelector(".ex").classList.toggle("open", open);
  tr.querySelector(".toggle").setAttribute("aria-expanded", String(open));
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runInspection();
});

(function start() {
  const params = new URLSearchParams(window.location.search);
  tokenInput.value = params.get("token") || DEFAULTS.token;
  creatorInput.value = params.get("creator") || DEFAULTS.creator;
  chainStrip(NET, NET === "testnet" ? [RPC, "https://rpc.testnet.near.org"] : [RPC, "https://archival-rpc.mainnet.fastnear.com"]);
  wireCopy(document);
  runInspection();
})();
}
