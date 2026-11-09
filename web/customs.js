"use strict";

/* Customs-coin mode: reads a deployed Customs token from the chain and judges it against the
   values published in the source. Pure functions first, then loadCoin (all I/O injected), then the DOM part. */

const PUBLISHED = {
  mainnet: {
    outlayer: "outlayer.near",
    checker: "6c0112e5b3c006bd97cd11b42862d28e3ac86c7732b23af5028aae0a1e5e42bb",
    rpc: ["https://rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.fastnear.com"],
    txApi: "https://tx.main.fastnear.com",
    explorer: "https://nearblocks.io",
  },
  testnet: {
    outlayer: "outlayer.testnet",
    checker: "fc72c7b662fc48ca497c9582a0b1aa8271e051d132283a9645cd5395b485f975",
    rpc: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"],
    txApi: "https://tx.test.fastnear.com",
    explorer: "https://testnet.nearblocks.io",
  },
};
const LIVE_TESTNET_COIN = "customs26-token.testnet";
const MAX_CHALLENGES = 64;

function customsEvents(rawTx, token) {
  const out = [];
  for (const r of (rawTx.receipts || [])) {
    if (!r.receipt || r.receipt.receiver_id !== token) continue;
    const outcome = r.execution_outcome && r.execution_outcome.outcome;
    if (!outcome || (outcome.status && outcome.status.Failure)) continue;
    for (const log of (outcome.logs || [])) {
      if (typeof log !== "string" || !log.startsWith("EVENT_JSON:")) continue;
      try {
        const e = JSON.parse(log.slice("EVENT_JSON:".length));
        out.push({ e, tx: String(rawTx.transaction && rawTx.transaction.hash || ""), tsS: Math.floor(Number(r.receipt.block_timestamp || 0) / 1e9) });
      } catch { /* a log that is not JSON is not an event */ }
    }
  }
  return out;
}

/* Wallets the market paid inside [startS, endS): ft_transfer events the token itself logged. */
function openingBuyers(rawTxs, token, market, startS, endS) {
  const seen = new Map();
  for (const tx of rawTxs) {
    for (const { e, tsS } of customsEvents(tx, token)) {
      if (e.standard !== "nep141" || e.event !== "ft_transfer" || tsS < startS || tsS >= endS) continue;
      for (const d of (e.data || [])) {
        if (d.old_owner_id === market && d.new_owner_id !== market && !seen.has(d.new_owner_id)) seen.set(d.new_owner_id, tsS);
      }
    }
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([wallet]) => wallet);
}

/* The token's own challenge events by id: where the filing and the verdict landed. */
function challengeTxs(rawTxs, token) {
  const byId = new Map();
  for (const tx of rawTxs) {
    for (const { e, tx: hash } of customsEvents(tx, token)) {
      if (e.standard !== "customs" || !e.data || e.data.challenge_id === undefined) continue;
      const row = byId.get(e.data.challenge_id) || {};
      if (e.event === "challenge_filed") row.filed = hash;
      else row.verdict = hash;
      byId.set(e.data.challenge_id, row);
    }
  }
  return byId;
}

function judgeChecks(published, params, verdictKey, keyCount, moduleSha) {
  const hex = (s) => String(s || "").toLowerCase();
  const judgeOk = params.outlayer_id === published.outlayer;
  const pinnedOk = hex(params.module_sha256) === published.checker;
  const fetched = moduleSha === null || moduleSha === undefined ? null : hex(moduleSha) === hex(params.module_sha256);
  let checker;
  if (!pinnedOk) {
    checker = { ok: false, text: "This token pins a checker with sha256 " + params.module_sha256 + ", not the published " + published.checker + ". Its verdicts prove nothing." };
  } else if (fetched === false) {
    checker = { ok: false, text: "The module at " + params.module_url + " hashes to " + moduleSha + ", not the pinned " + params.module_sha256 + ". OutLayer would refuse to run it." };
  } else if (fetched === null) {
    checker = { ok: null, text: "The pinned checker sha256 " + params.module_sha256.slice(0, 16) + "... equals the published one. The module bytes could not be fetched from this browser to re-hash." };
  } else {
    checker = { ok: true, text: "The module at the token's URL hashes in this browser to " + params.module_sha256.slice(0, 16) + "..., the published checker." };
  }
  const keyed = typeof verdictKey === "string" && verdictKey.startsWith("ed25519:");
  return [
    { id: "judge", label: "Judge contract", ok: judgeOk,
      text: judgeOk ? "Verdicts come from " + published.outlayer + "." : "This token's judge is " + params.outlayer_id + ", not " + published.outlayer + ". Its verdicts prove nothing." },
    Object.assign({ id: "checker", label: "Checker module" }, checker),
    { id: "verdict_key", label: "Verdict key", ok: keyed,
      text: keyed ? "Pinned from the live judge: " + verdictKey + "." : "No verdict key is pinned. The token accepts no challenge until pin_verdict_key resolves." },
    { id: "keys", label: "Access keys", ok: keyCount === 0,
      text: keyCount === 0 ? "The token account has 0 access keys. Nobody can redeploy or drain it." : "The token account still holds " + keyCount + " access key" + (keyCount === 1 ? "" : "s") + ". The code behind it can change." },
  ];
}

function bagState(opening) {
  if (!opening) return { kind: "unread", sub: "no bag" };
  switch (opening.state) {
    case "seized_frozen": return { kind: "seized", sub: "remainder frozen" };
    case "seized_released": return { kind: "seized", sub: "freeze over" };
    case "vested": return { kind: "vested", sub: "vest complete" };
    case "vesting": return { kind: "bonded", sub: "vesting" };
    default: return { kind: "unread", sub: String(opening.state) };
  }
}

function challengeCard(c, txs) {
  const base = { id: c.id, wallet: c.wallet, challenger: c.challenger, bond: c.bond, path: c.path || [], filedTx: txs && txs.filed, verdictTx: txs && txs.verdict, createdBlock: c.created_block };
  const s = c.state;
  if (s && typeof s === "object" && s.Upheld) return Object.assign(base, { kind: "upheld", title: "Upheld", seized: s.Upheld.seized });
  if (s === "Rejected") return Object.assign(base, { kind: "rejected", title: "Rejected" });
  if (s === "Unanswered") return Object.assign(base, { kind: "unread", title: "Unanswered" });
  if (s === "Reclaimed") return Object.assign(base, { kind: "unread", title: "Bond reclaimed" });
  return Object.assign(base, { kind: "pending", title: "Pending" });
}

/* The newest transaction in the read: the one whose first receipt has the highest block timestamp. */
function latestEntry(rawTxs) {
  let best = null;
  for (const tx of rawTxs) {
    let first = null;
    for (const r of (tx.receipts || [])) {
      const ts = Number(r.receipt && r.receipt.block_timestamp || 0);
      if (!first || ts < first.ts) first = { ts, height: Number(r.receipt.block_height || 0) };
    }
    if (!first) continue;
    if (!best || first.ts > best.ts) best = { hash: String(tx.transaction && tx.transaction.hash || ""), ts: first.ts, tsS: Math.floor(first.ts / 1e9), height: first.height, signer: String(tx.transaction && tx.transaction.signer_id || "") };
  }
  return best;
}

/* io: { view(account, method, args) -> json|throws, keyCount(account), history(account) -> [hash], txs(hashes) -> raw[], sha256Url(url) -> hex|null, lastBlock? }
   on(stage, payload) reports each read as it resolves so the page can stamp them in the order they come back. */
async function loadCoin(io, net, token, on = () => {}) {
  const published = PUBLISHED[net];
  let params;
  try {
    params = await io.view(token, "customs_params", {});
  } catch (err) {
    if (err && err.transport) throw err;
    return { kind: "not_customs", token, net, reason: String(err && err.message || err), readBlock: io.lastBlock || null };
  }
  on("params", { params, readBlock: io.lastBlock || null });
  const only = (id, verdictKey, keyCount, moduleSha) => judgeChecks(published, params, verdictKey, keyCount, moduleSha).find((c) => c.id === id);
  const announce = (c, value) => { on("check", Object.assign({ readBlock: io.lastBlock || null, value }, c)); return c; };
  announce(only("judge", null, 0, undefined), params.outlayer_id);
  const [verdictKey, keyCount, win, hashes, moduleSha] = await Promise.all([
    io.view(token, "verdict_key", {}).then((v) => { announce(only("verdict_key", v, 0, undefined), v); return v; }),
    io.keyCount(token).then((n) => { announce(only("keys", null, n, undefined), n); return n; }),
    io.view(token, "window", {}).then((w) => { on("window", { win: w, readBlock: io.lastBlock || null }); return w; }),
    io.history(token),
    io.sha256Url(params.module_url).catch(() => null).then((sha) => { announce(only("checker", null, 0, sha), params.module_sha256); return sha; }),
  ]);
  const rawTxs = hashes.length ? await io.txs(hashes) : [];
  const latest = latestEntry(rawTxs);
  on("latest", { latest });
  const buyers = openingBuyers(rawTxs, token, params.market_id, win.start_s, win.opening_ends_s);
  const openings = await Promise.all(buyers.map(async (wallet) => ({ wallet, opening: await io.view(token, "opening_of", { account_id: wallet }) })));
  const txsById = challengeTxs(rawTxs, token);
  const bagRows = openings.filter((o) => o.opening);
  on("bags", { buyers: bagRows, win });
  const challenges = [];
  for (let id = 0; id < MAX_CHALLENGES; id++) {
    const c = await io.view(token, "challenge_of", { challenge_id: id });
    if (!c) break;
    challenges.push(challengeCard(Object.assign({ id }, c), txsById.get(id)));
  }
  on("notices", { challenges });
  return {
    kind: "customs", token, net, published, params, verdictKey, keyCount, win, latest,
    readBlock: io.lastBlock || null,
    checks: judgeChecks(published, params, verdictKey, keyCount, moduleSha),
    buyers: bagRows, challenges,
  };
}

/* ------------------------------------------------------------------ browser */

function browserIo(net) {
  const p = PUBLISHED[net];
  async function post(url, body, label, opts) {
    const { res, text } = await postWithRetry(fetch, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, opts);
    if (!res.ok) throw new Error(label + " returned HTTP " + res.status);
    return JSON.parse(text);
  }
  /* A public RPC that rate limits answers 429 without CORS headers, which the browser reports as a TypeError.
     Each endpoint gets one try per round, then the next endpoint, for up to three rounds. */
  async function rpc(params) {
    const body = { jsonrpc: "2.0", id: "customs", method: "query", params: Object.assign({ finality: "final" }, params) };
    let last;
    for (let round = 0; round < 3; round++) {
      for (const url of rpcOrder(net, p.rpc)) {
        try {
          const json = await post(url, body, "The NEAR RPC", { tries: 1 });
          if (json.error) throw Object.assign(new Error(JSON.stringify(json.error.cause || json.error)), { contract: true });
          if (json.result && json.result.error) throw Object.assign(new Error(json.result.error), { contract: true });
          rpcWorked(net, p.rpc, url);
          return json.result;
        } catch (err) {
          if (!(err instanceof TypeError) && !/HTTP (429|5\d\d)/.test(err.message)) throw err;
          last = err;
        }
      }
      await new Promise((r) => setTimeout(r, 900 * (round + 1)));
    }
    throw Object.assign(new Error("The NEAR RPC could not be reached from this browser (" + p.rpc.join(", ") + "). " + (last && last.message || "")), { transport: true });
  }
  const io = {
    lastBlock: null,
    async view(account, method, args) {
      const r = await rpc({ request_type: "call_function", account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args)) });
      if (r.block_height > (io.lastBlock || 0)) io.lastBlock = r.block_height;
      return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result)));
    },
    async keyCount(account) {
      return (await rpc({ request_type: "view_access_key_list", account_id: account })).keys.length;
    },
    async history(account) {
      const hashes = [];
      let resume = null;
      for (let page = 0; page < 5; page++) {
        const json = await post(p.txApi + "/v0/account", Object.assign({ account_id: account, limit: 200 }, resume ? { resume_token: resume } : {}), "The FastNEAR account list");
        for (const t of (json.account_txs || [])) if (t.is_success && !hashes.includes(t.transaction_hash)) hashes.push(t.transaction_hash);
        resume = json.resume_token;
        if (!resume) break;
      }
      return hashes;
    },
    async txs(hashes) {
      const out = [];
      for (let i = 0; i < hashes.length; i += 20) {
        const json = await post(p.txApi + "/v0/transactions", { tx_hashes: hashes.slice(i, i + 20) }, "The FastNEAR transaction read");
        out.push(...(json.transactions || []));
      }
      return out;
    },
    async sha256Url(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error("module fetch HTTP " + res.status);
      const digest = await crypto.subtle.digest("SHA-256", await res.arrayBuffer());
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    },
  };
  return io;
}

if (typeof module !== "undefined") module.exports = { PUBLISHED, LIVE_TESTNET_COIN, openingBuyers, challengeTxs, judgeChecks, bagState, challengeCard, latestEntry, loadCoin };
if (typeof globalThis !== "undefined") globalThis.CustomsContract = { loadCoin, browserIo, PUBLISHED, LIVE_TESTNET_COIN };
