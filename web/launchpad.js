"use strict";
/* The Customs launchpad: the meme.cooking launch board with each launch's insider-buyer check inside its card, a token view per launch,
   and the bonded $CUSTOMS card whose button runs the hunt. Launches come from api.meme.cooking through /mc on this origin; openers are traced on NEAR
   mainnet (read only); the hunt, the stamps and the bond live on testnet. */
(() => {
  const L = window.LPLib, C = window.LPChain;
  const view = document.getElementById("view");
  const NB_MAIN = "https://nearblocks.io/", NB_TEST = "https://testnet.nearblocks.io/";
  const OPENING = 5;
  const S = { total: 0, launches: [], readAt: 0, feedError: null, stamps: null, stampsError: false, key: null, paid: [], session: [], replay: null, filter: "all", term: "", traced: 0, found: 0, h: null, started: false };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s);
  const nbT = (hash) => `<a class="tx" href="${NB_TEST}txns/${hash}" target="_blank" rel="noreferrer">${L.shortTx(hash)}<i>↗</i></a>`;
  const nbM = (hash, text) => `<a class="tx" href="${NB_MAIN}txns/${hash}" target="_blank" rel="noreferrer">${text || L.shortTx(hash)}<i>↗</i></a>`;
  const acctT = (a) => `<a class="tx" href="${NB_TEST}address/${esc(a)}" target="_blank" rel="noreferrer">${esc(L.short(a, 26))}</a>`;
  const sleep = C.sleep;
  const hash = () => (location.hash.match(/^#\/t\/(.+)$/) || [])[1] || "";

  /* ------------------------------------------------------------ data */
  function norm(m) {
    const cap = BigInt(m.hard_cap || "0") > 0n ? m.hard_cap : m.soft_cap;
    return { ...m, key: String(m.id), raised: L.nearNum(m.deposit), cap: L.nearNum(cap), hard: BigInt(m.hard_cap || "0") > 0n, soft: L.nearNum(m.soft_cap), t: null, fact: null, pool: null, trace: { kind: "queued" } };
  }
  const teamPct = (l) => (l.team_allocation && l.total_supply ? Math.round((Number(BigInt(l.team_allocation) * 1000n / BigInt(l.total_supply))) / 10) : 0);
  const standing = () => (S.stamps ? S.stamps.standing : []);
  const bondSum = () => (S.stamps ? S.stamps.bond : 0);

  async function loadLaunches() {
    S.feedError = null;
    try {
      const d = await C.getJSON("/mc/launches");
      S.total = d.total; S.readAt = Date.now(); S.launches = d.launches.map(norm);
    } catch (e) {
      S.feedError = "meme.cooking did not answer" + (e.status ? " (HTTP " + e.status + ")" : "") + ".";
    }
  }
  async function loadStamps() {
    S.stampsError = false;
    try {
      S.stamps = await C.readStamps();
      if (S.stamps.failed) { S.stampsError = true; return; }
      S.paid = await C.readPaidHunts(S.stamps.broken);
      if (S.stamps.best) S.key = await C.readHunterKey(S.stamps.best.contract).catch(() => null);
    } catch { S.stampsError = true; }
  }
  async function loadReplay() { try { S.replay = await (await fetch("data/replay.json")).json(); } catch { S.replay = null; } }

  async function loadTrades(l) {
    if (l.t) return l.t;
    const t = await C.getJSON("/mc/trades?meme_id=" + l.id);
    l.t = t; l.fact = L.insiderFact(l.owner, t);
    return t;
  }
  async function readPool(l) {
    if (!l.pool_id || l.pool) return;
    try {
      const p = await C.readPool(l.pool_id);
      const q = L.rheaPrice(p, C.WNEAR, l.decimals);
      l.pool = q || { wnear: 0 };
    } catch { l.pool = null; }
  }

  /* the opening-buyer check: one wallet at a time so the shared read budget serves every visitor */
  async function trace(l) {
    if (l.trace.kind === "tracing") return;
    l.trace = { kind: "tracing", i: 0, n: 0 };
    paintCard(l);
    try {
      const t = await loadTrades(l);
      const open = L.openers(l.owner, t, OPENING);
      const rows = [];
      l.trace.n = open.length;
      for (const d of open) {
        l.trace.i = rows.length + 1;
        paintCard(l);
        let r;
        try { r = await C.traceOne(l.owner, d.account); } catch { r = { account: d.account, funded: null, seen: 0, failed: true }; }
        rows.push({ ...d, ...r });
        await sleep(200);
      }
      const bad = rows.filter((r) => r.funded), unread = rows.filter((r) => r.failed).length;
      const allFailed = rows.length > 0 && unread === rows.length;
      l.trace = { kind: allFailed ? "unread" : bad.length ? "funded" : "clean", rows, at: Date.now(), n: rows.length };
      if (!allFailed) { S.traced++; S.found += bad.length; }
    } catch { l.trace = { kind: "unread", rows: [] }; }
    paintCard(l); paintStrip(); if (hash() === l.key) renderToken();
  }
  let queueRunning = false;
  async function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    for (const l of S.launches) {
      if (l.trace.kind !== "queued") continue;
      while (window.CustomsHunting) await sleep(1000);
      await trace(l);
      await sleep(250);
    }
    queueRunning = false;
  }

  /* ------------------------------------------------------------ card pieces */
  const meter = (raised, cap) => { const on = L.meterCells(raised, cap); return `<span class="meter" aria-hidden="true">${"<b></b>".repeat(on)}${"<s></s>".repeat(20 - on)}</span>`; };
  const pic = (l, cls = "") => `<img class="pic ${cls}" src="/mc/img/${esc(l.image)}" alt="" loading="lazy" decoding="async" width="92" height="92">`;

  function badge(l) {
    if (l.status === "cooked") {
      const holds = l.pool && l.pool.wnear ? `<br>holds ${L.num(l.pool.wnear)} wNEAR` : "";
      return `<span class="badge cooked">Cooked</span><p class="status"><a href="https://dex.rhea.finance/pool/${l.pool_id}" target="_blank" rel="noreferrer">Rhea pool ${l.pool_id}</a>${holds}</p>`;
    }
    if (l.status === "cooking") return `<span class="badge cooking">Cooking</span><p class="status" data-left="${l.end_ms}">${L.left(l.end_ms - Date.now())}</p>`;
    return `<span class="badge spoiled">Spoiled</span><p class="status">ended under the ${L.num(l.soft)} N soft cap</p>`;
  }

  function slipFact(l) {
    if (!l.fact) return `<p class="fact">Reading deposits</p>`;
    if (!l.fact.acct) return `<p class="fact">${esc(l.fact.text)}</p>`;
    const [a, b] = l.fact.text.split("{acct}");
    return `<p class="fact">${esc(a)}<b>${esc(L.short(l.fact.acct, 24))}</b>${esc(b)}</p>`;
  }
  function slipVerdict(l, idx) {
    const tr = l.trace;
    let kind = tr.kind, text = "", extra = "";
    if (tr.kind === "queued") { const prev = S.launches.slice(0, idx).reverse().find((x) => x.trace.kind === "tracing" || x.trace.kind === "queued"); text = prev ? "Queued after $" + esc(prev.symbol.toUpperCase()) : "Queued"; }
    else if (tr.kind === "tracing") text = tr.n ? "Tracing opener " + tr.i + " of " + tr.n : "Reading deposits";
    else if (tr.kind === "clean") text = "None of the first " + tr.n + " openers took money from " + esc(L.short(l.owner, 22)) + ". Read " + L.age(Date.now() - tr.at).replace(/ ago$/, "") + " ago";
    else if (tr.kind === "funded") {
      const r = tr.rows.find((x) => x.funded);
      text = esc(L.short(r.account, 20)) + " got NEAR from " + esc(L.short(l.owner, 20)) + " before depositing " + L.near(r.amount) + " N " + nbM(r.funded, "funding tx");
    } else { text = "The chain did not answer."; extra = ` <button class="linkbtn" type="button" data-trace="${esc(l.key)}">Trace again</button>`; kind = "unread"; }
    return { kind, html: `<p>${text}${extra}</p>` };
  }

  function launchCard(l, idx) {
    const raiseLine = l.hard ? `of ${L.num(l.cap)} hard cap` : `soft cap ${L.num(l.soft)} met, no hard cap`;
    const tp = teamPct(l);
    const dep = l.t ? new Set(l.t.deposits.map((d) => d.account)).size : l.stakers;
    const mini = l.t ? `${dep} depositors · ${l.t.deposits.length} deposits · ${l.t.withdrawals.length} withdrawals${tp ? ` · team ${tp}%` : ""}` : `${l.stakers} depositors${tp ? ` · team ${tp}%` : ""}`;
    const v = slipVerdict(l, idx);
    return `<article class="card" data-card="${esc(l.key)}" data-open="${esc(l.key)}">
      <div class="card-main">${pic(l)}<div class="id">${badge(l)}<h3><span class="tk">$${esc(l.symbol.toUpperCase())}</span> ${esc(l.name)}</h3><p class="by">by <b>${esc(L.short(l.owner, 26))}</b> · <span data-age="${l.created_ms}">${L.age(Date.now() - l.created_ms)}</span></p></div></div>
      <div class="raise"><p><b>${L.num(l.raised)} N</b> raised ${raiseLine}</p>${meter(l.raised, l.cap)}<p class="mini">${mini}</p></div>
      <div class="slip" data-kind="${v.kind}">${slipFact(l)}<div class="verdict">${v.html}<button class="ghost" type="button" data-open="${esc(l.key)}">Open</button></div></div>
    </article>`;
  }

  function frameCards(n) {
    return Array.from({ length: n }, () => `<article class="card frame" aria-hidden="true"><div class="card-main"><span class="pic"></span><div class="id"><div class="bar-ph w40"></div><div class="bar-ph w90"></div><div class="bar-ph w60"></div></div></div><div class="raise"><div class="bar-ph w90"></div><span class="meter">${"<s></s>".repeat(20)}</span><div class="bar-ph w60"></div></div><div class="slip"><div class="bar-ph w90"></div><div class="bar-ph w60"></div></div></article>`).join("");
  }

  /* ------------------------------------------------------------ the bonded $CUSTOMS card and the hunt */
  const hunterOfBest = () => (S.stamps && S.stamps.best ? C.hunterOf(S.stamps.best.contract) : "");
  const bondOfBest = () => (S.stamps && S.stamps.best && S.stamps.best.stamp ? L.nearNum(S.stamps.best.stamp.bond) : 1);
  const filingBond = () => (S.stamps ? S.stamps.filing : 0.1);
  const payNum = () => bondOfBest() + filingBond();

  function lastHunt() {
    const h = S.session.find((x) => x.phase === "paid") || null;
    const p = S.paid[0];
    if (!p) return `<p class="last">No hunt has paid out yet. The first proven path takes the bond.</p>`;
    const secs = h && h.who === p.payout_to && h.stamp === p.contract ? `, ${h.secs} s after the click` : "";
    return `<p class="last">Last hunt: <b>${esc(L.short(p.hunter, 22))}</b> proved <b>${esc(L.short(p.creator, 22))}</b> funded <b>${esc(L.short(p.wallet, 22))}</b>. +${L.num(p.paid)} NEAR${secs}. ${acctT(p.contract)}</p>`;
  }

  /* the three lifecycle steps replace the button while a hunt runs, and carry the terminal answer */
  function huntSteps(h) {
    const run = (s, t) => `<li data-state="${s}"><i>${s === "done" ? "✓" : ""}</i><span>${t}</span></li>`;
    const num = (n, s, t) => `<li data-state="${s}"><i>${n}</i><span>${t}</span></li>`;
    let s1, s2, s3, res = "";
    const filed = h.tx ? `Filed on chain in ${h.filedS} s ${nbT(h.tx)}` : "";
    if (h.phase === "filing") { s1 = num(1, "run", "Filing on chain"); s2 = num(2, "idle", "Checker"); s3 = num(3, "idle", "Verdict"); }
    else if (h.phase === "checking") { s1 = num(1, "done", filed); s2 = num(2, "run", "Checker running " + L.clock(h.secs == null ? h.filedS : h.secs)); s3 = num(3, "idle", "Verdict"); }
    else if (h.phase === "paid") { s1 = num(1, "done", filed); s2 = num(2, "done", "Checker verified in " + h.secs + " s"); s3 = num(3, "done", "+" + L.num(h.paid) + " NEAR to " + acctT(h.who)); res = `<b class="payoff">+${L.num(h.paid)} NEAR</b>Upheld. ${L.num(h.paid)} NEAR moved to ${acctT(h.who)} in ${h.secs} s. ${acctT(h.stamp)}`; }
    else if (h.phase === "rejected") { s1 = num(1, "done", filed); s2 = num(2, "done", "Checker verified in " + h.secs + " s"); s3 = num(3, "reject", "Filing bond forfeited"); res = `Rejected in ${h.secs} s. ${esc(L.short(h.wallet, 26))} was not creator-funded. The stamp stands and the hunter lost the ${L.num(h.filingBond)} NEAR filing bond. ${acctT(h.stamp)}`; }
    else if (h.phase === "refused") { s1 = num(1, "error", "Refused by the contract"); s2 = num(2, "idle", "Checker"); s3 = num(3, "idle", "Verdict"); res = `${esc(h.text)} ${nbT(h.tx)}`; }
    else if (h.phase === "unanswered") { s1 = num(1, "done", filed); s2 = num(2, "error", "No verdict"); s3 = num(3, "idle", "Filing bond reclaimable"); res = `The checker could not read that path. No verdict applied; the filing bond can be reclaimed. <button class="retry" type="button" data-hunt="${h.kind}">Hunt again</button>`; }
    else if (h.phase === "timeout") { s1 = num(1, "done", filed); s2 = num(2, "error", "No verdict after " + h.secs + " s"); s3 = num(3, "idle", "Verdict"); res = `The challenge stays on chain; follow it on ${acctT(h.stamp)}.`; }
    else if (h.phase === "busy") { s1 = num(1, "error", "Filer busy"); s2 = num(2, "idle", "Checker"); s3 = num(3, "idle", "Verdict"); res = `${esc(h.text)} <button class="retry" type="button" data-hunt="${h.kind}">Try again</button>`; }
    else if (h.phase === "unavailable") { s1 = num(1, "error", "No funded stamp"); s2 = num(2, "idle", "Checker"); s3 = num(3, "idle", "Verdict"); res = `${esc(h.text)} <button class="retry" type="button" data-hunt="${h.kind}">Check again</button>`; }
    else { s1 = num(1, "error", "Not filed"); s2 = num(2, "idle", "Checker"); s3 = num(3, "idle", "Verdict"); res = `${esc(h.text)} <button class="retry" type="button" data-hunt="${h.kind}">Try again</button>`; }
    return `<ol id="stage-steps" class="huntsteps" aria-live="polite">${s1}${s2}${s3}</ol>${res ? `<p class="result">${res}</p>` : ""}`;
  }

  function huntBody() {
    if (S.stampsError) return `<p class="result">The testnet node did not answer. <button class="retry" type="button" data-reload-stamps>Read again</button></p><button class="huntbtn" id="break-go" type="button" disabled>Hunt for ${L.num(payNum())} NEAR</button>`;
    if (!S.stamps) return `<button class="huntbtn" id="break-go" type="button" disabled>Reading the stamps</button>`;
    const h = S.h;
    const live = h && !["paid", "rejected", "refused", "busy", "unavailable", "unanswered", "timeout", "error"].includes(h.phase);
    const canHunt = S.stamps.best && S.stamps.best.stamp && S.stamps.best.stamp.state === "Standing";
    const btn = canHunt ? `<button class="huntbtn" id="break-go" type="button" data-hunt="funded">Hunt for ${L.num(payNum())} NEAR</button>` : `<button class="huntbtn" id="break-go" type="button" disabled>No standing stamp to hunt</button>`;
    const clean = canHunt ? `<button class="linkbtn" id="break-clean" type="button" data-hunt="clean">Hunt a clean buyer instead and watch the checker reject it</button>` : "";
    if (!h) return btn + lastHunt() + `<p class="last">${clean}</p>`;
    return huntSteps(h) + (live ? "" : btn + `<p class="last">${clean}</p>`);
  }

  function bondedCard() {
    const r = S.replay, st = S.stamps;
    const status = r ? `testnet launch · ${r.opening_buyers} opening buyers · creator paid ${r.funded} of them` : "testnet launch";
    const funded = r && r.buyers.find((b) => b.path && b.path.length);
    const path = funded ? `The proven path is on chain: ${nbT(funded.path[0].tx)} then ${nbT(funded.first_tx)}` : "";
    const standingN = st ? st.standing.length : 0;
    const slip = S.stampsError
      ? `<dl><div><dt>Bond at stake</dt><dd id="seal-amount">Unread</dd><dd class="sub" id="seal-state">The testnet node did not answer</dd></div></dl>`
      : `<dl>
          <div><dt>Bond at stake</dt><dd id="seal-amount">${st ? L.num(bondSum()) + " NEAR" : "Reading"}</dd><dd class="sub" id="seal-state">${st ? standingN + (standingN === 1 ? " stamp standing" : " stamps standing") : "Reading the stamps"}</dd></div>
          <div><dt>Hunter is paid</dt><dd>${st ? L.num(payNum()) + " NEAR" : "Reading"}</dd><dd class="sub">bond plus your filing bond back</dd></div>
          <div><dt>A false hunt costs</dt><dd>${st ? L.num(filingBond()) + " NEAR" : "Reading"}</dd><dd class="sub">filing bond, kept by the stamp</dd></div>
        </dl>`;
    return `<article class="card bonded" id="card-stamped" data-state="${standingN ? "standing" : "idle"}">
      <div class="card-main"><img class="pic" src="img/customs.svg" alt="" width="120" height="120"><div class="id">
        <span class="badge cooked">Bonded</span><p class="status">${esc(status)}</p>
        <h3><span class="tk">$CUSTOMS</span> Customs coin</h3><p class="by">by <b>customs26-creator.testnet</b></p>
        <p class="facts">${path}</p></div></div>
      <div class="slip">${slip}<div class="hunt-slot">${huntBody()}</div>
        <p class="last"><a class="tx" href="#/t/customs26-token.testnet">Open the token</a></p></div>
    </article>`;
  }

  function paintHunt() {
    document.querySelectorAll(".hunt-slot").forEach((n) => { n.innerHTML = huntBody(); });
  }

  /* ------------------------------------------------------------ board */
  function counts() {
    const L0 = S.launches;
    return { all: L0.length + 1, bonded: 1, cooked: L0.filter((l) => l.status === "cooked").length, cooking: L0.filter((l) => l.status === "cooking").length, spoiled: L0.filter((l) => l.status === "spoiled").length };
  }
  const match = (l) => !S.term || `${l.symbol} ${l.name} ${l.owner}`.toLowerCase().includes(S.term);
  function visible() { return S.launches.filter((l) => (S.filter === "all" || S.filter === l.status) && match(l)); }
  function showBonded() { return (S.filter === "all" || S.filter === "bonded") && (!S.term || "customs coin customs26-creator.testnet".includes(S.term)); }

  function stripHtml() {
    const tracedN = S.launches.filter((l) => ["clean", "funded", "unread"].includes(l.trace.kind)).length;
    return `<div><b>${S.total ? S.total.toLocaleString("en-US") : "…"}</b><span>launches on meme.cooking</span></div>
      <div><b>${S.stamps ? L.num(bondSum()) + " NEAR" : "…"}</b><span>bond standing on $CUSTOMS</span></div>
      <div><b>${S.stamps ? L.num(S.stamps.paid) + " NEAR" : "…"}</b><span>paid to hunters</span></div>
      <div><b id="found">${S.found}</b><span>creator-funded openers found across ${tracedN} of ${S.launches.length} launches traced this visit</span></div>`;
  }
  function paintStrip() { const s = $(".strip"); if (s) s.innerHTML = stripHtml(); }

  function railHtml() {
    const bounties = standing().map((s) => `<li><p class="r1"><b class="amt">${L.num(L.nearNum(s.stamp.bond))} NEAR</b> on <b>$CUSTOMS</b>, ${esc(s.contract.replace(".testnet", ""))}</p><p class="r2">Creator can release it in ${L.left(s.stamp.release_s * 1000 - Date.now()).replace(" left", "")}. Hunter credit ${L.num(Number(s.credit) / 1e24)} NEAR.</p></li>`).join("");
    const log = [...S.session.filter((x) => ["paid", "rejected"].includes(x.phase)).map(sessionRow), ...S.paid.map(paidRow)].slice(0, 5).join("");
    return `<aside class="rail">
      <section id="rail"><h2>Open bounties</h2><ul class="bounties">${S.stamps ? (bounties || `<li class="empty">No bond is standing right now.</li>`) : `<li class="empty">Reading the stamps</li>`}</ul>
        ${S.stamps ? `<p class="note">stamp_of read at testnet block ${C.lastBlock().toLocaleString("en-US")}. A creator posts a bond on a Customs stamp to pay whoever proves an opening buyer was their own money.</p>` : ""}</section>
      <section id="log"><h2>Hunt log</h2><ul class="log">${log || `<li class="empty">No hunt yet.</li>`}</ul>
        <p class="note"><a class="tx" href="attack-lab.html">How the check works</a></p></section>
    </aside>`;
  }
  const paidRow = (p) => `<li class="won"><p class="r1"><b>${esc(L.short(p.hunter, 24))}</b> proved <b>${esc(L.short(p.creator, 22))}</b> funded <b>${esc(L.short(p.wallet, 24))}</b></p><p class="r2">Upheld by the checker. <span class="amt">+${L.num(p.paid)} NEAR</span> to ${esc(L.short(p.payout_to, 24))}.</p><p class="r3">slot ${p.slot} · ${acctT(p.contract)}</p></li>`;
  const sessionRow = (h) => h.phase === "paid"
    ? `<li class="won"><p class="r1"><b>${esc(L.short(h.hunter, 24))}</b> proved <b>${esc(L.short(h.wallet, 24))}</b> was creator-funded</p><p class="r2">Upheld ${h.secs} s after the click. <span class="amt">+${L.num(h.paid)} NEAR</span> to ${esc(L.short(h.who, 24))}.</p><p class="r3">this visit · ${nbT(h.tx)}</p></li>`
    : `<li class="lost"><p class="r1"><b>${esc(L.short(h.hunter, 24))}</b> filed a path for <b>${esc(L.short(h.wallet, 24))}</b></p><p class="r2">Rejected in ${h.secs} s. The ${L.num(h.filingBond)} NEAR filing bond is forfeited, the stamp stands.</p><p class="r3">this visit · ${nbT(h.tx)}</p></li>`;

  function chipsHtml() {
    const c = counts();
    const chip = (k, label, n) => (n > 0 ? `<button type="button" class="chip ${S.filter === k ? "on" : ""}" data-f="${k}">${label} <span>${n}</span></button>` : "");
    return chip("all", "All", c.all) + chip("bonded", "Bonded", c.bonded) + chip("cooked", "Cooked", c.cooked) + chip("cooking", "Cooking", c.cooking) + chip("spoiled", "Spoiled", c.spoiled);
  }
  function gridHtml() {
    if (!S.launches.length && !S.feedError) return (showBonded() ? bondedCard() : "") + frameCards(5);
    const rows = visible();
    const parts = [];
    if (showBonded()) parts.push(bondedCard());
    rows.forEach((l) => parts.push(launchCard(l, S.launches.indexOf(l))));
    if (!parts.length) return `<div class="empty-board">No launch matches "${esc(S.term)}"<br><button class="ghost" type="button" data-clear>Clear search</button></div>`;
    return parts.join("");
  }
  function clockText() { return S.readAt ? "read " + Math.max(0, Math.round((Date.now() - S.readAt) / 1000)) + " s ago" : "Reading meme.cooking"; }

  function renderBoard() {
    document.body.dataset.view = "board";
    setTabs("board");
    view.innerHTML = `<section class="strip" aria-label="Board totals">${stripHtml()}</section>
      <div class="layout"><section class="boardcol">
        <div class="bar"><div class="chips">${chipsHtml()}</div><p class="asof" id="clock">${clockText()}</p></div>
        <label class="mobile-search"><span class="sr">Search launches</span><input id="qm" type="search" placeholder="Search $TICKER, name or creator" value="${esc(S.term)}" autocomplete="off"></label>
        <div class="grid" id="grid">${gridHtml()}</div></section>${railHtml()}</div>`;
    const err = $("#page-error");
    if (S.feedError) { err.hidden = false; err.innerHTML = `${esc(S.feedError)} <button type="button" data-reload-feed>Read again</button>`; } else err.hidden = true;
  }
  function paintGridOnly() {
    const g = $("#grid"); if (!g) return;
    g.innerHTML = gridHtml(); const c = $(".chips"); if (c) c.innerHTML = chipsHtml();
  }
  function paintCard(l) {
    const old = document.querySelector(`[data-card="${CSS.escape(l.key)}"]`);
    if (old) old.outerHTML = launchCard(l, S.launches.indexOf(l));
    else if (hash() === "" && $("#grid") && S.launches.every((x) => x.t === null)) { /* grid still showing frames */ }
  }
  function paintBonded() { const old = $("#card-stamped"); if (old) old.outerHTML = bondedCard(); const r = $(".rail"); if (r) r.outerHTML = railHtml(); paintStrip(); }

  function setTabs(where, jump) {
    const on = (el, v) => el && el.classList.toggle("on", v);
    on($("#nav-board"), where === "board"); on($("#tab-board"), where === "board");
  }

  /* ------------------------------------------------------------ token views */
  const track = (stops, hops, cls) => `<ol class="track ${cls || ""}">${stops.map((s, i) => `<li class="stop ${s.cls || ""}"><span class="acct">${esc(s.label)}</span><span class="role">${esc(s.role)}</span>${hops[i] ? `<span class="hop">${hops[i]}</span>` : ""}</li>`).join("")}</ol>`;

  function chartSvg(l) {
    const w = Math.max(320, Math.min(860, (view.querySelector(".chartbox") || {}).clientWidth || 640)), hgt = 240, padL = 52, padB = 24, padT = 10, padR = 10;
    const pts = L.raiseSeries(l.t);
    if (!pts.length) return `<p class="dim" style="margin-top:10px">No deposit has been made yet.</p>`;
    const t0 = pts[0].ts, t1 = Math.max(pts[pts.length - 1].ts, t0 + 60000);
    const maxY = Math.max(...pts.map((p) => p.y), 1) * 1.08;
    const X = (ts) => padL + ((ts - t0) / (t1 - t0)) * (w - padL - padR), Y = (y) => padT + (1 - y / maxY) * (hgt - padT - padB);
    let d = `M${X(t0).toFixed(1)} ${Y(0).toFixed(1)}`, prev = 0;
    for (const p of pts) { d += ` L${X(p.ts).toFixed(1)} ${Y(prev).toFixed(1)} L${X(p.ts).toFixed(1)} ${Y(p.y).toFixed(1)}`; prev = p.y; }
    d += ` L${X(t1).toFixed(1)} ${Y(prev).toFixed(1)}`;
    const fundedSet = new Set((l.trace.rows || []).filter((r) => r.funded).map((r) => r.account));
    const ticks = pts.filter((p) => p.deposit && (p.account === l.owner || fundedSet.has(p.account))).map((p) => `<line class="tick" x1="${X(p.ts).toFixed(1)}" x2="${X(p.ts).toFixed(1)}" y1="${padT}" y2="${hgt - padB}"><title>${esc(p.account)}</title></line><circle class="dot" cx="${X(p.ts).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="4"><title>${esc(p.account)}</title></circle>`).join("");
    const grid = [0, 0.5, 1].map((f) => { const y = Y(maxY / 1.08 * f); return `<line class="grid" x1="${padL}" x2="${w - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="ax" x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${L.num(maxY / 1.08 * f)}</text>`; }).join("");
    const fmt = (ts) => new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    return `<svg class="chart" viewBox="0 0 ${w} ${hgt}" role="img" aria-label="Cumulative NEAR raised over time">${grid}<path class="step" d="${d}"/>${ticks}<text class="ax" x="${padL}" y="${hgt - 6}">${fmt(t0)}</text><text class="ax" x="${w - padR}" y="${hgt - 6}" text-anchor="end">${fmt(t1)}</text></svg>`;
  }

  function openersTable(l) {
    const tr = l.trace;
    if (!l.t) return `<p class="dim" style="margin-top:10px">Reading deposits</p>`;
    const open = L.openers(l.owner, l.t, OPENING);
    if (!open.length) return `<p class="dim" style="margin-top:10px">No other account has deposited yet.</p>`;
    const rowFor = (d) => (tr.rows || []).find((r) => r.account === d.account);
    const res = (d) => {
      const r = rowFor(d);
      if (!r) return tr.kind === "tracing" ? `<span class="res-wait">Tracing</span>` : `<span class="res-wait">Queued</span>`;
      if (r.failed) return `<span class="res-wait">Chain did not answer</span>`;
      return r.funded ? `<span class="res-funded">Creator-funded ${nbM(r.funded, "funding tx")}</span>` : `<span class="res-clean">clean</span>`;
    };
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Wallet</th><th>First deposit</th><th>Receipt</th><th>Result</th></tr></thead><tbody>${open.map((d, i) => `<tr><td>${i + 1}</td><td class="mono">${esc(L.short(d.account, 30))}</td><td class="mono">${L.near(d.amount)} N</td><td>${nbM(d.receipt)}</td><td>${res(d)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function pathPanel(l) {
    const tr = l.trace, bad = (tr.rows || []).find((r) => r.funded);
    if (bad) {
      const dep = l.t.deposits.find((d) => d.account === bad.account);
      return `<article class="panel"><h2>The insider path</h2>${track([{ label: l.owner, role: "launch creator", cls: "hot" }, { label: bad.account, role: "funded by the creator" }, { label: "meme.cooking #" + l.id, role: "opening deposit" }], [`<span>creator pays the wallet</span>${nbM(bad.funded, "funding tx")}`, `<span>wallet deposits ${L.near(dep.amount)} N</span>${nbM(dep.receipt)}`])}</article>`;
    }
    if (tr.kind === "clean") return `<article class="panel"><h2>Opening buyers</h2><p class="dim" style="margin-top:4px">None of the first ${tr.n} openers took money from ${esc(L.short(l.owner, 26))}. Read ${L.age(Date.now() - tr.at)}.</p>${openersTable(l)}</article>`;
    return `<article class="panel"><h2>Opening buyers</h2>${openersTable(l)}</article>`;
  }

  function memeToken(l) {
    const cooked = l.status === "cooked", p = l.pool;
    const metrics = [];
    if (cooked && p && p.price) {
      const supply = l.total_supply ? Number(BigInt(l.total_supply) / 10n ** BigInt(Math.max(0, (l.decimals || 18) - 6))) / 1e6 : 0;
      metrics.push(["Price", (p.price >= 0.01 ? p.price.toFixed(4) : p.price.toPrecision(2)) + " NEAR"]);
      if (supply) metrics.push(["Market cap", L.num(p.price * supply) + " NEAR"]);
      metrics.push(["Liquidity", L.num(p.wnear) + " wNEAR"]);
    }
    metrics.push(["Raised", L.num(l.raised) + " N"]);
    const tr = l.trace, n = tr.n || (l.t ? L.openers(l.owner, l.t, OPENING).length : 0);
    const nf = (tr.rows || []).filter((r) => r.funded).length;
    metrics.push(["Opening buyers", tr.kind === "clean" || tr.kind === "funded" ? `${n}, creator-funded ${nf}` : tr.kind === "unread" ? `${n}, unread` : n ? `${n}, tracing` : "Reading"]);
    const buy = cooked ? { href: `https://dex.rhea.finance/pool/${l.pool_id}`, label: "Buy $" + l.symbol.toUpperCase() } : { href: `https://meme.cooking/meme/${l.id}`, label: l.status === "cooking" ? "Deposit on meme.cooking" : "Open on meme.cooking" };
    const v = tr.kind;
    const verdict = v === "clean" ? `<p class="res clean">None of the first ${tr.n} openers took money from ${esc(L.short(l.owner, 22))}.</p><p>Read ${L.age(Date.now() - tr.at)}.</p>`
      : v === "funded" ? (() => { const r = tr.rows.find((x) => x.funded); return `<p class="res funded">${esc(L.short(r.account, 22))} got NEAR from ${esc(L.short(l.owner, 22))} before depositing ${L.near(r.amount)} N.</p><p>${nbM(r.funded, "funding tx")}</p>`; })()
      : v === "unread" ? `<p>The chain did not answer.</p><button class="ghost" type="button" data-trace="${esc(l.key)}">Trace again</button>`
      : `<p>${v === "tracing" ? "Tracing opener " + tr.i + " of " + tr.n : "Queued behind earlier launches"}</p>`;
    view.innerHTML = `<section class="tok-head"><a class="back" href="#/">Board</a>${pic(l, "big")}
        <div class="tok-id"><h1>${esc(l.name)} <span class="tk">$${esc(l.symbol.toUpperCase())}</span></h1><p class="by mono">meme.cooking #${l.id} · by <b>${esc(l.owner)}</b> · <span data-age="${l.created_ms}">${L.age(Date.now() - l.created_ms)}</span> · <a href="https://meme.cooking/meme/${l.id}" target="_blank" rel="noreferrer">meme.cooking ↗</a></p></div>
        <dl class="metrics">${metrics.map(([k, v2]) => `<div><dt>${k}</dt><dd>${v2}</dd></div>`).join("")}</dl></section>
      <div class="tok-layout"><section class="tok-main">
        <article class="panel"><h2>Raise</h2><div class="chartbox">${l.t ? chartSvg(l) : `<p class="dim" style="margin-top:10px">Reading deposits</p>`}</div></article>
        ${pathPanel(l)}
        ${v === "funded" ? `<article class="panel"><h2>Opening buyers</h2>${openersTable(l)}</article>` : ""}
      </section>
      <aside class="act">
        <div class="buybox"><h2>Buy $${esc(l.symbol.toUpperCase())}</h2><p class="px">${p && p.price ? (p.price >= 0.01 ? p.price.toFixed(4) : p.price.toPrecision(2)) + " NEAR · " + L.num(p.wnear) + " wNEAR liquidity" : cooked ? "Reading the Rhea pool" : l.status === "cooking" ? L.left(l.end_ms - Date.now()) : "Ended under the soft cap"}</p><a class="buybtn" href="${buy.href}" target="_blank" rel="noreferrer">${buy.label}</a><a class="alt" href="https://meme.cooking/meme/${l.id}" target="_blank" rel="noreferrer">meme.cooking page ↗</a></div>
        <div class="cbox"><h2>Customs check</h2>${verdict}${v === "clean" || v === "funded" ? `<button class="ghost" type="button" data-trace="${esc(l.key)}">Trace again</button>` : ""}</div>
      </aside></div>`;
  }

  function customsToken() {
    const r = S.replay, st = S.stamps;
    const funded = r && r.buyers.find((b) => b.path && b.path.length), clean = r && r.buyers.find((b) => !b.path || !b.path.length);
    const metrics = [["Opening buyers", r ? r.opening_buyers : "Reading"], ["Buyers the creator paid", r ? r.funded : "Reading"], ["Bond at stake", st ? L.num(bondSum()) + " NEAR" : "Reading"], ["Paid to hunters", st ? L.num(st.paid) + " NEAR" : "Reading"]];
    const path = funded ? track([{ label: r.creator, role: "launch creator", cls: "hot" }, { label: funded.wallet, role: "paid by the creator" }, { label: "dclv2.ref-dev.testnet", role: "opening buy" }], [`<span>creator pays the wallet</span>${nbT(funded.path[0].tx)}`, `<span>wallet buys at open</span>${nbT(funded.first_tx)}`], "proof") : "";
    const lastPaid = S.paid[0];
    const bond = lastPaid ? `<h3 class="sub">The bond moving</h3><div class="bondline"><span class="end"><b>${esc(lastPaid.contract)}</b><small>creator bond plus filing bond</small></span><span class="rail-line"><span class="block">+${L.num(lastPaid.paid)} NEAR</span></span><span class="end right"><b>${esc(L.short(lastPaid.payout_to, 28))}</b><small>stamp reads Broken at block ${C.lastBlock().toLocaleString("en-US")}</small></span></div>` : "";
    const table = r ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Wallet</th><th>First deposit</th><th>Receipt</th><th>Result</th></tr></thead><tbody>${r.buyers.map((b) => `<tr><td class="mono">${esc(b.wallet)}${b.wallet === r.creator ? "<em>creator</em>" : ""}</td><td class="mono">${L.num(b.near)} N</td><td>${nbT(b.first_tx)}</td><td>${b.path && b.path.length ? `<span class="res-funded">Creator-funded ${nbT(b.path[0].tx)}</span>` : `<span class="res-clean">clean</span>`}</td></tr>`).join("")}</tbody></table></div>` : "";
    const key = S.key, hunter = hunterOfBest();
    const others = st ? st.live.filter((s) => !st.best || s.contract !== st.best.contract).map((s) => `<li><span class="mono nw">slot ${esc((s.contract.match(/customs(\d+)/) || [])[1])}</span><span>${s.stamp.state === "Standing" ? L.num(L.nearNum(s.stamp.bond)) + " NEAR standing" : s.stamp.state.Broken ? "broken, paid " + L.num(L.nearNum(s.stamp.state.Broken.paid)) + " NEAR" : "released"}</span></li>`).join("") : "";
    view.innerHTML = `<section class="tok-head"><a class="back" href="#/">Board</a><img class="pic big" src="img/customs.svg" alt="" width="72" height="72">
        <div class="tok-id"><h1>Customs coin <span class="tk">$CUSTOMS</span></h1><p class="by mono">customs26-token.testnet · NEAR testnet · by <b>customs26-creator.testnet</b></p></div>
        <dl class="metrics">${metrics.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl></section>
      <div class="tok-layout"><section class="tok-main">
        <article class="panel"><h2>The insider path</h2>${path}${bond}</article>
        <article class="panel"><h2>Opening buyers</h2>${table}${clean ? "" : ""}</article>
        <article class="panel log" id="log"><h2>Hunts on $CUSTOMS</h2><ul class="log">${[...S.session.filter((x) => ["paid", "rejected"].includes(x.phase)).map(sessionRow), ...S.paid.map(paidRow)].join("") || `<li class="dim">No hunt yet.</li>`}</ul></article>
      </section>
      <aside class="act"><div class="huntcard"><h2>Hunt this launch</h2><p class="small mono">${hunter ? esc(S.stamps.best.contract) + " · standing" : "Reading the stamps"}</p>
        <dl class="lines"><div><dt>Creator bond</dt><dd>${st ? L.num(bondOfBest()) + " NEAR" : "Reading"}</dd></div><div><dt>You file with</dt><dd>${st ? L.num(filingBond()) + " NEAR filing bond" : "Reading"}</dd></div><div><dt>Path proven: you receive</dt><dd>${st ? L.num(payNum()) + " NEAR" : "Reading"}</dd></div><div><dt>Path refused: you lose</dt><dd>${st ? L.num(filingBond()) + " NEAR" : "Reading"}</dd></div></dl>
        <div class="hunt-slot">${huntBody()}</div>
        <p class="small">${key && hunter ? `The agent signs with <b class="mono">${esc(key.account)}</b>, whose only key is a function-call key for <b class="mono">${esc(key.methods.join(", "))}</b> on this stamp.` : ""}</p></div>
        <div class="cbox"><h2>Other stamps</h2><ul class="log">${others || `<li class="dim">No other stamp.</li>`}</ul></div></aside></div>`;
  }

  function renderToken() {
    const id = hash();
    document.body.dataset.view = "token"; setTabs("token");
    const err = $("#page-error"); if (err) err.hidden = true;
    if (id === C.LAUNCH) { customsToken(); return; }
    const l = S.launches.find((x) => x.key === id);
    if (!l) { if (S.launches.length || S.feedError) { location.hash = "#/"; return; } view.innerHTML = `<section class="tok-head"><a class="back" href="#/">Board</a><div class="tok-id"><h1>Reading the launch</h1></div></section>`; return; }
    memeToken(l);
    loadTrades(l).then(() => { if (hash() === l.key) memeToken(l); if (l.trace.kind === "queued") trace(l); }).catch(() => {});
    readPool(l).then(() => { if (hash() === l.key) memeToken(l); });
  }

  function route() {
    if (hash()) renderToken(); else renderBoard();
  }

  /* ------------------------------------------------------------ events */
  async function startHunt(kind) {
    const input = $("#payout"), v = (input.value || "").trim(), hint = $("#payout-hint");
    hint.hidden = true; input.removeAttribute("aria-invalid");
    if (!C.payoutOk(v)) { hint.textContent = "That is not a NEAR account id. Use something like you.testnet, or leave it empty."; hint.hidden = false; input.setAttribute("aria-invalid", "true"); openPop(true); input.focus(); return; }
    try { localStorage.setItem("customs.payout", v); } catch { /* private mode */ }
    markPayout();
    S.h = { phase: "filing", kind, t0: Date.now() };
    paintHunt();
    document.querySelectorAll("[data-hunt],[id^=break-]").forEach((b) => { b.disabled = true; });
    const end = await C.hunt(kind, { payout: v, stamps: S.stamps, emit: (st) => { S.h = st; paintHunt(); } });
    if (end && ["paid", "rejected"].includes(end.phase)) S.session.unshift(end);
    await loadStamps();
    paintHunt(); paintBonded(); if (hash() === C.LAUNCH) customsToken();
    const steps = $("#stage-steps"); if (steps) steps.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function openPop(on) { const p = $("#payout-pop"), b = $("#payout-btn"); p.hidden = !on; b.setAttribute("aria-expanded", String(on)); }
  function markPayout() { const v = ($("#payout").value || "").trim(), b = $("#payout-btn"); b.classList.toggle("set", !!v && C.payoutOk(v)); b.firstChild.textContent = v && C.payoutOk(v) ? L.short(v, 14) : "Payout"; }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t.closest("#payout-pop") && !t.closest("#payout-btn")) openPop(false);
    if (t.closest("#payout-btn")) { openPop($("#payout-pop").hidden); return; }
    const jump = t.closest("[data-jump]");
    if (jump) { e.preventDefault(); if (document.body.dataset.view !== "board") location.hash = "#/"; setTimeout(() => { const n = document.getElementById(jump.dataset.jump); if (n) n.scrollIntoView({ behavior: "smooth" }); document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a === jump)); }, 40); return; }
    const hunt = t.closest("[data-hunt]");
    if (hunt) { startHunt(hunt.dataset.hunt); return; }
    const f = t.closest("[data-f]");
    if (f) { S.filter = f.dataset.f; paintGridOnly(); return; }
    if (t.closest("[data-clear]")) { S.term = ""; $("#q").value = ""; const m = $("#qm"); if (m) m.value = ""; paintGridOnly(); return; }
    if (t.closest("[data-reload-feed]")) { reload(); return; }
    if (t.closest("[data-reload-stamps]")) { loadStamps().then(() => { paintBonded(); }); return; }
    const tr = t.closest("[data-trace]");
    if (tr) { const l = S.launches.find((x) => x.key === tr.dataset.trace); if (l) { l.trace = { kind: "queued" }; trace(l); } return; }
    if (t.closest("a")) return;
    const open = t.closest("[data-open]");
    if (open) location.hash = "#/t/" + open.dataset.open;
  });
  const onSearch = (v) => { S.term = v.trim().toLowerCase(); if (document.body.dataset.view === "board") paintGridOnly(); };
  $("#q").addEventListener("input", (e) => { onSearch(e.target.value); const m = $("#qm"); if (m) m.value = e.target.value; });
  document.addEventListener("input", (e) => { if (e.target.id === "qm") { onSearch(e.target.value); $("#q").value = e.target.value; } if (e.target.id === "payout") { $("#payout-hint").hidden = true; markPayout(); } });
  addEventListener("hashchange", () => { route(); scrollTo(0, 0); });
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { const l = S.launches.find((x) => x.key === hash()); if (l && l.t) memeToken(l); }, 200); });
  try { const saved = localStorage.getItem("customs.payout"); if (saved) $("#payout").value = saved; } catch { /* no storage */ }
  markPayout();

  setInterval(() => {
    document.querySelectorAll("[data-age]").forEach((n) => { n.textContent = L.age(Date.now() - Number(n.dataset.age)); });
    document.querySelectorAll("[data-left]").forEach((n) => { n.textContent = L.left(Number(n.dataset.left) - Date.now()); });
    const c = $("#clock"); if (c) c.textContent = clockText();
  }, 1000);

  /* ------------------------------------------------------------ start */
  async function reload() {
    renderBoardOrToken();
    await loadLaunches();
    route();
    kick();
  }
  const renderBoardOrToken = () => route();
  function kick() {
    runQueue();
    /* deposits first so every card names who is in its raise, then the Rhea pools */
    (async () => {
      let next = 0;
      const workers = Array.from({ length: 3 }, async () => { while (next < S.launches.length) { const l = S.launches[next++]; try { await loadTrades(l); } catch { /* the trace retries */ } if (!hash()) paintCard(l); } });
      await Promise.all(workers);
      for (const l of S.launches) { if (l.status === "cooked") { await readPool(l); if (!hash()) paintCard(l); await sleep(150); } }
    })();
  }
  (async () => {
    route();
    await Promise.all([loadLaunches(), loadReplay(), loadStamps()]);
    route();
    kick();
  })();
  window.CustomsLaunchpad = { S };
})();
