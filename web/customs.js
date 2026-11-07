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
    rpc: ["https://test.rpc.fastnear.com", "https://archival-rpc.testnet.fastnear.com"],
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
  if (!opening) return { cls: "muted", label: "no bag" };
  switch (opening.state) {
    case "seized_frozen": return { cls: "funded", label: "seized, remainder frozen" };
    case "seized_released": return { cls: "funded", label: "seized, freeze over" };
    case "vested": return { cls: "", label: "vested" };
    case "vesting": return { cls: "vesting", label: "vesting" };
    default: return { cls: "muted", label: String(opening.state) };
  }
}

function challengeCard(c, txs) {
  const base = { id: c.id, wallet: c.wallet, challenger: c.challenger, bond: c.bond, filedTx: txs && txs.filed, verdictTx: txs && txs.verdict };
  const s = c.state;
  if (s && typeof s === "object" && s.Upheld) return Object.assign(base, { cls: "funded", title: "Upheld", seized: s.Upheld.seized });
  if (s === "Rejected") return Object.assign(base, { cls: "", title: "Rejected" });
  if (s === "Unanswered") return Object.assign(base, { cls: "muted", title: "Unanswered" });
  if (s === "Reclaimed") return Object.assign(base, { cls: "muted", title: "Bond reclaimed" });
  return Object.assign(base, { cls: "vesting", title: "Pending" });
}

/* io: { view(account, method, args) -> json|throws, keyCount(account), history(account) -> [hash], txs(hashes) -> raw[], sha256Url(url) -> hex|null } */
async function loadCoin(io, net, token) {
  const published = PUBLISHED[net];
  let params;
  try {
    params = await io.view(token, "customs_params", {});
  } catch (err) {
    return { kind: "not_customs", token, net, reason: String(err && err.message || err) };
  }
  const [verdictKey, keyCount, win, hashes, moduleSha] = await Promise.all([
    io.view(token, "verdict_key", {}),
    io.keyCount(token),
    io.view(token, "window", {}),
    io.history(token),
    io.sha256Url(params.module_url).catch(() => null),
  ]);
  const rawTxs = hashes.length ? await io.txs(hashes) : [];
  const buyers = openingBuyers(rawTxs, token, params.market_id, win.start_s, win.opening_ends_s);
  const openings = await Promise.all(buyers.map(async (wallet) => ({ wallet, opening: await io.view(token, "opening_of", { account_id: wallet }) })));
  const txsById = challengeTxs(rawTxs, token);
  const challenges = [];
  for (let id = 0; id < MAX_CHALLENGES; id++) {
    const c = await io.view(token, "challenge_of", { challenge_id: id });
    if (!c) break;
    challenges.push(challengeCard(Object.assign({ id }, c), txsById.get(id)));
  }
  return {
    kind: "customs", token, net, published, params, verdictKey, win,
    checks: judgeChecks(published, params, verdictKey, keyCount, moduleSha),
    buyers: openings.filter((o) => o.opening), challenges,
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
      for (const url of p.rpc) {
        try {
          const json = await post(url, body, "The NEAR RPC", { tries: 1 });
          if (json.error) throw new Error(JSON.stringify(json.error.cause || json.error));
          if (json.result && json.result.error) throw new Error(json.result.error);
          return json.result;
        } catch (err) {
          if (!(err instanceof TypeError) && !/HTTP (429|5\d\d)/.test(err.message)) throw err;
          last = err;
        }
      }
      await new Promise((r) => setTimeout(r, 900 * (round + 1)));
    }
    throw new Error("The NEAR RPC could not be reached from this browser (" + p.rpc.join(", ") + "). " + (last && last.message || ""));
  }
  return {
    async view(account, method, args) {
      const r = await rpc({ request_type: "call_function", account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args)) });
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
}

function cEsc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function cTokens(raw, decimals) {
  const n = Number(raw) / Math.pow(10, decimals);
  if (!Number.isFinite(n) || n === 0) return "0";
  return new Intl.NumberFormat("en-US", { notation: n >= 100000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(n);
}
function cWhen(s) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s * 1000)) + " UTC";
}
function cShort(h) {
  return h && h.length > 18 ? h.slice(0, 8) + "..." + h.slice(-6) : h;
}

function renderCoin(root, m) {
  if (m.kind === "not_customs") {
    root.innerHTML = '<div class="panel-head"><h2>' + cEsc(m.token) + '</h2><p class="panel-meta">Not a Customs token</p></div>' +
      '<p class="sees">' + cEsc(m.token) + ' does not answer customs_params on ' + cEsc(m.net) + ' (' + cEsc(m.reason) + '). Nothing on this panel is green for it. The inspector below reads Nearly launches on mainnet.</p>';
    return;
  }
  const ex = m.published.explorer;
  const dec = 24;
  const checks = m.checks.map((c) =>
    '<li class="check ' + (c.ok === true ? "pass" : c.ok === false ? "fail" : "unread") + '" data-check="' + c.id + '">' +
      '<span class="check-mark" aria-hidden="true">' + (c.ok === true ? "pass" : c.ok === false ? "FAIL" : "not read") + "</span>" +
      "<div><strong>" + cEsc(c.label) + "</strong><p>" + cEsc(c.text) + "</p></div></li>").join("");
  const rows = m.buyers.map((b, i) => {
    const t = bagState(b.opening);
    return '<article class="row" data-bag="' + cEsc(b.opening.state) + '">' +
      '<div class="row-top"><span class="row-index">' + String(i + 1).padStart(2, "0") + "</span>" +
      '<a class="wallet" href="' + ex + "/address/" + encodeURIComponent(b.wallet) + '">' + cEsc(b.wallet) + "</a>" +
      '<span class="tag ' + t.cls + '">' + cEsc(t.label) + "</span></div>" +
      '<dl class="facts"><div><dt>Bought</dt><dd>' + cEsc(cTokens(b.opening.bought, dec)) + "</dd></div>" +
      "<div><dt>Locked now</dt><dd>" + cEsc(cTokens(b.opening.locked, dec)) + "</dd></div>" +
      "<div><dt>Unlocks</dt><dd>" + cEsc(cWhen(b.opening.unlock_s)) + "</dd></div></dl></article>";
  }).join("");
  const cards = m.challenges.map((c) =>
    '<article class="row challenge" data-challenge="' + c.id + '" data-state="' + cEsc(c.title) + '">' +
    '<div class="row-top"><span class="row-index">#' + c.id + "</span>" +
    '<a class="wallet" href="' + ex + "/address/" + encodeURIComponent(c.wallet) + '">' + cEsc(c.wallet) + "</a>" +
    '<span class="tag ' + c.cls + '">' + cEsc(c.title) + "</span></div>" +
    '<dl class="facts"><div><dt>Challenger</dt><dd>' + cEsc(c.challenger) + "</dd></div>" +
    "<div><dt>Bond</dt><dd>" + cEsc(cTokens(c.bond, 24)) + " NEAR</dd></div>" +
    (c.seized ? "<div><dt>Seized to challenger</dt><dd>" + cEsc(cTokens(c.seized, dec)) + "</dd></div>" : "") +
    (c.filedTx ? '<div><dt>Filed</dt><dd><a href="' + ex + "/txns/" + encodeURIComponent(c.filedTx) + '">' + cEsc(cShort(c.filedTx)) + "</a></dd></div>" : "") +
    (c.verdictTx && c.verdictTx !== c.filedTx ? '<div><dt>Verdict</dt><dd><a href="' + ex + "/txns/" + encodeURIComponent(c.verdictTx) + '">' + cEsc(cShort(c.verdictTx)) + "</a></dd></div>" : "") +
    "</dl></article>").join("");
  const p = m.params;
  root.innerHTML =
    '<div class="panel-head"><h2>This is a Customs coin</h2><p class="panel-meta">' + cEsc(m.token) + " / NEAR " + cEsc(m.net) + "</p></div>" +
    '<p class="sees">Read live from the chain at page load. The token is judged against the values published in its source: the OutLayer contract that answers challenges, the sha256 of the checker module it runs, the verdict key and the access keys left on the account.</p>' +
    '<ul class="checks">' + checks + "</ul>" +
    '<dl class="method"><div><dt>Opening window</dt><dd class="mono">' + cEsc(cWhen(m.win.start_s)) + " to " + cEsc(cWhen(m.win.opening_ends_s)) + "</dd></div>" +
    '<div><dt>Vest ends</dt><dd class="mono">' + cEsc(cWhen(m.win.vest_ends_s)) + "</dd></div>" +
    '<div><dt>Seizure</dt><dd class="mono">' + (p.seize_bps / 100) + "% of the unvested bag, rest frozen " + Math.round(p.lock_s / 86400) + " days</dd></div>" +
    '<div><dt>Market</dt><dd class="mono">' + cEsc(p.market_id) + "</dd></div>" +
    '<div><dt>Creator</dt><dd class="mono">' + cEsc(p.creator_id) + "</dd></div>" +
    '<div><dt>Min bond</dt><dd class="mono">' + cEsc(cTokens(p.min_bond.toString(), 24)) + " NEAR</dd></div></dl>" +
    '<h3 class="sub">Opening bags</h3><div class="ledger" id="coin-bags">' + (rows || '<p class="empty">The market paid no wallets in the opening window.</p>') + "</div>" +
    '<h3 class="sub">Challenges</h3><div class="ledger" id="coin-challenges">' + (cards || '<p class="empty">No challenge has been filed.</p>') + "</div>";
}

if (typeof document !== "undefined" && document.getElementById("coin-panel")) {
  const query = new URLSearchParams(location.search);
  const net = query.get("network") === "mainnet" ? "mainnet" : "testnet";
  const token = (query.get("coin") || LIVE_TESTNET_COIN).trim().toLowerCase();
  const root = document.getElementById("coin-panel");
  root.setAttribute("aria-busy", "true");
  loadCoin(browserIo(net), net, token)
    .then((m) => renderCoin(root, m))
    .catch((err) => {
      root.innerHTML = '<div class="panel-head"><h2>' + cEsc(token) + '</h2><p class="panel-meta">Read failed</p></div><p class="sees">' + cEsc(err.message || err) + "</p>";
    })
    .finally(() => root.removeAttribute("aria-busy"));
}

if (typeof module !== "undefined") module.exports = { PUBLISHED, openingBuyers, challengeTxs, judgeChecks, bagState, challengeCard, loadCoin };
