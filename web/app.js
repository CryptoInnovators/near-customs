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
    }, { tries: 4, waitMs: 900 });
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
  TX_API = await fastnearBase(NET, "tx");
  RPC = await fastnearBase(NET, "rpc");
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
  // A Nearly dev buy lands in a lock contract (trader lock_N.nearlytrade.near) on behalf of its owner, the creator.
  tape = Array.isArray(tape) ? tape.filter((t) => t.side === "buy" && t.trader && t.ts_ms && t.block).map((t) => (t.owner ? Object.assign({}, t, { trader: t.owner }) : t)) : [];
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
  for (const b of list) {
    if (b.wallet === creator) b.trace = { status: "creator", path: [], note: "" };
    else if (b.cost === 0n) b.trace = { status: "unpriced", path: [], note: "The buy moved no wNEAR into the market, so the half-cost floor cannot be computed." };
    else b.trace = null;
    if (b.trace && typeof hooks.onTrace === "function") hooks.onTrace(b);
  }
  await traceAll(list, creator, runId, hooks, TRACE_WALLETS);
  // One unattended second pass for buyers a rate limit or the budget left untraced, at lower concurrency.
  if (runId === state.run && list.some((b) => b.trace && b.trace.status === "not_traced")) {
    await new Promise((r) => setTimeout(r, 2000));
    state.pages = 0;
    state.batches = 0;
    await traceAll(list, creator, runId, hooks, TRACE_WALLETS, 3);
  }

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

/* Traces every buyer whose trace is missing or not_traced, the first `cap` of them; the rest are marked not_traced. */
async function traceAll(list, creator, runId, hooks, cap, limit = CONCURRENCY) {
  const eligible = [];
  for (const b of list) {
    if (b.trace && b.trace.status !== "not_traced") continue;
    if (eligible.length < cap) eligible.push(b);
    else b.trace = { status: "not_traced", path: [], note: "The page traces the " + cap + " largest priced buys at a time. This wallet was not ruled out." };
    if (b.trace && typeof hooks.onTrace === "function") hooks.onTrace(b);
  }
  let started = 0;
  let budgetHit = false;
  await mapLimit(eligible, limit, async (b) => {
    if (runId !== state.run) return;
    if (budgetHit) {
      b.trace = { status: "not_traced", path: [], note: "The funding search reached its receipt budget earlier. This wallet was not ruled out." };
      if (typeof hooks.onTrace === "function") hooks.onTrace(b);
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
}

/* Re-traces the buyers of a finished inspection that are still not_traced, with a fresh budget. */
async function retryUntraced(data, hooks = {}) {
  const runId = ++state.run;
  state.pages = 0;
  state.batches = 0;
  await traceAll(data.list, data.creator, runId, hooks, data.list.length, 4);
  return runId === state.run ? data : null;
}

globalThis.CustomsInspector = { inspect: (token, creator, hooks = {}) => inspect(token, creator, ++state.run, hooks), retry: retryUntraced, setProgress: (fn) => { progress = fn; } };


let progress = () => {};
