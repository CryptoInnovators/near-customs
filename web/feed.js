"use strict";
/* The launch feed: real launches from meme.cooking, NEAR's official memecoin launchpad (api.meme.cooking, read through /mc on this origin).
   Each card carries Customs' verdict as one inline line. The verdict is traced live from mainnet: did the creator fund any of the first
   opening depositors? Launches that finalized show their Rhea pool, read live from the pool contract. Mainnet is read only. */
(() => {
  const root = document.querySelector("#feed-cards");
  if (!root) return;
  const clock = document.querySelector("#feed-clock");
  const EXPLORER = "https://nearblocks.io/";
  const WNEAR = "wrap.near", REF = "v2.ref-finance.near";
  const OPENING = 6;
  const cards = [];
  let readAt = 0, total = 0;

  const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const link = (href, text, cls) => { const n = h("a", cls, text); n.href = href; n.target = "_blank"; n.rel = "noopener"; return n; };
  const near = (yocto) => { const n = Number(BigInt(yocto || "0") / 10n ** 20n) / 10000; return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)); };
  const age = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? d + "d " + hr + "h" : hr ? hr + "h " + String(m).padStart(2, "0") + "m" : m + "m " + String(s % 60).padStart(2, "0") + "s";
  };
  const hue = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getJSON(url, body, tries = 4) {
    for (let i = 0; i < tries; i++) {
      const shared = /^\/fastnear\//.test(url) && window.FastnearLimiter;
      if (shared) await window.FastnearLimiter.take();
      const r = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
      if (shared) window.FastnearLimiter.response(r.status);
      if (r.ok) return r.json();
      if (r.status !== 429 && r.status < 500) throw Error("HTTP " + r.status);
      await sleep(600 * 2 ** i);
    }
    throw Error("The read did not complete");
  }
  const mainTx = (path, body) => getJSON("/fastnear/tx-main" + path, body);
  const mainView = async (account, method, args) => {
    const j = await getJSON("/fastnear/rpc-main", { jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args)) } });
    if (!j.result) throw Error("view failed");
    return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
  };

  /* one verdict line: a glyph and one word in colour, no outline */
  const VERDICT = {
    tracing: ["◌", "Tracing", "Reading the first opening depositors"],
    clean: ["✓", "Clean opening", "No creator money reached an opening depositor"],
    funded: ["⚠", "Creator-funded", "The creator funded an opening depositor"],
    unread: ["·", "Not traced", "The chain did not answer, open the card to trace again"],
  };
  function setVerdict(c, kind, detail) {
    const [glyph, word, note] = VERDICT[kind];
    c.verdict.dataset.kind = kind;
    c.verdictWord.textContent = glyph + " " + word;
    c.verdictNote.textContent = detail || note;
  }

  function build(m) {
    const art = h("article", "mcard mc");
    art.dataset.meme = m.id;
    const pic = h("div", "mc-pic");
    pic.style.setProperty("--h", hue(m.symbol + m.name));
    pic.append(h("span", "", (m.symbol || "?").slice(0, 1).toUpperCase()));
    const img = new Image();
    img.alt = m.name + " token image";
    img.onload = () => { pic.textContent = ""; pic.append(img); };
    img.src = "/mc/img/" + m.image;
    const head = h("div", "mc-head");
    head.append(h("h3", "ticker", "$" + m.symbol.toUpperCase()), h("p", "mc-name", m.name));
    const cap = BigInt(m.hard_cap || "0") > 0n ? BigInt(m.hard_cap) : BigInt(m.soft_cap || "0");
    const pct = cap > 0n ? Math.min(100, Number((BigInt(m.deposit || "0") * 10000n) / cap) / 100) : 0;
    const meter = h("div", "meter"), fill = h("i"); fill.style.width = Math.max(pct, 1.5) + "%"; meter.append(fill);
    meter.setAttribute("role", "img"); meter.setAttribute("aria-label", near(m.deposit) + " NEAR raised" + (cap > 0n ? " of " + near(cap.toString()) : ""));
    const raised = h("p", "mc-raised");
    raised.append(h("b", "", near(m.deposit) + " NEAR"), document.createTextNode(cap > 0n ? " raised of " + near(cap.toString()) + " cap" : " raised"));
    const meta = h("p", "mc-meta");
    const ageEl = h("span", "", age(Date.now() - m.created_ms));
    meta.append(h("span", "", m.stakers + " stakers"), ageEl, link("https://meme.cooking/meme/" + m.id, "by " + m.owner));
    const verdict = h("p", "mc-verdict");
    verdict.setAttribute("aria-live", "polite");
    const verdictWord = h("b"), verdictNote = h("span");
    verdict.append(verdictWord, verdictNote);
    const rhea = h("p", "mc-rhea");
    rhea.append(document.createTextNode("Rhea pool "), link("https://dex.rhea.finance/pool/" + m.pool_id, "#" + m.pool_id), h("span", "", " reading liquidity"));
    const open = h("button", "link-btn mc-open", "Show the funding graph");
    open.type = "button";
    open.setAttribute("aria-expanded", "false");
    const graph = h("div", "mc-graph");
    graph.hidden = true;
    art.append(pic, head, meter, raised, meta, verdict, rhea, open, graph);
    root.append(art);
    const c = { m, art, ageEl, verdict, verdictWord, verdictNote, rhea, graph, open, trace: null, state: "idle" };
    setVerdict(c, "tracing");
    open.addEventListener("click", () => {
      const show = graph.hidden;
      graph.hidden = !show;
      open.setAttribute("aria-expanded", String(show));
      open.textContent = show ? "Hide the funding graph" : "Show the funding graph";
      if (show && c.state === "unread") run(c);
    });
    return c;
  }

  /* the creator-funded opening buyer check on real deposits: a depositor is creator-funded when one of its first three transactions is signed by the creator */
  async function traceOne(owner, account) {
    const list = await mainTx("/v0/account", { account_id: account, limit: 3, desc: false });
    const hashes = [...new Set((list.account_txs || []).map((t) => t.transaction_hash))];
    if (!hashes.length) return { account, funded: null, seen: 0 };
    const txs = await mainTx("/v0/transactions", { tx_hashes: hashes });
    const byCreator = (txs.transactions || []).map((t) => t.transaction).filter((t) => t && t.signer_id === owner);
    return { account, funded: byCreator.length ? byCreator[0].hash : null, seen: hashes.length };
  }

  async function run(c) {
    if (c.state === "running") return;
    c.state = "running";
    setVerdict(c, "tracing");
    try {
      const t = await getJSON("/mc/trades?meme_id=" + c.m.id);
      const seen = new Set([c.m.owner]);
      const opening = [];
      for (const d of t.deposits) { if (seen.has(d.account)) continue; seen.add(d.account); opening.push(d); if (opening.length === OPENING) break; }
      const rows = [];
      for (const d of opening) {
        let r;
        try { r = await traceOne(c.m.owner, d.account); } catch { r = { account: d.account, funded: null, seen: 0, failed: true }; }
        rows.push({ ...d, ...r });
        await sleep(250);
      }
      c.trace = { rows, creatorDeposits: t.deposits.filter((d) => d.account === c.m.owner), trades: t.trades };
      const bad = rows.filter((r) => r.funded);
      const unread = rows.filter((r) => r.failed).length;
      if (bad.length) setVerdict(c, "funded", "Creator " + c.m.owner + " funded " + bad.length + " of " + rows.length + " opening depositors");
      else if (unread === rows.length && rows.length) setVerdict(c, "unread");
      else setVerdict(c, "clean", "None of the first " + rows.length + " opening depositors was creator-funded");
      c.state = unread === rows.length && rows.length ? "unread" : "done";
      paintGraph(c);
    } catch {
      c.state = "unread";
      setVerdict(c, "unread");
    }
  }

  function paintGraph(c) {
    if (!c.trace) return;
    const { rows, creatorDeposits } = c.trace;
    const ul = h("ul", "mc-rows");
    const top = h("li", "mc-row mc-creator");
    top.append(h("span", "mc-role", "Creator"), h("code", "", c.m.owner), h("span", "mc-amt", creatorDeposits.length ? "deposited " + near(creatorDeposits.reduce((s, d) => s + BigInt(d.amount), 0n).toString()) + " NEAR" : "no own deposit"));
    ul.append(top);
    if (!rows.length) ul.append(h("li", "mc-row", "No other account deposited in this launch."));
    for (const r of rows) {
      const li = h("li", "mc-row" + (r.funded ? " mc-hot" : ""));
      li.append(h("span", "mc-role", r.funded ? "Funded by creator" : "Opening depositor"), h("code", "", r.account), h("span", "mc-amt", near(r.amount) + " NEAR"));
      const a = link(EXPLORER + "txns/" + r.receipt, "receipt");
      li.append(a);
      if (r.funded) li.append(link(EXPLORER + "txns/" + r.funded, "funding tx"));
      ul.append(li);
    }
    c.graph.replaceChildren(ul, h("p", "mc-foot", "Read from the meme.cooking trades and the first three transactions of each depositor on NEAR mainnet."));
  }

  async function readRhea(c) {
    try {
      const p = await mainView(REF, "get_pool", { pool_id: c.m.pool_id });
      const i = p.token_account_ids.indexOf(WNEAR);
      const span = c.rhea.querySelector("span:last-child");
      span.textContent = i >= 0 ? " holds " + near(p.amounts[i]) + " NEAR of liquidity" : " live";
      c.rhea.dataset.live = "on";
    } catch { c.rhea.querySelector("span:last-child").textContent = ""; }
  }

  setInterval(() => {
    cards.forEach((c) => { c.ageEl.textContent = age(Date.now() - c.m.created_ms); });
    if (clock) clock.textContent = readAt ? "meme.cooking, " + total.toLocaleString("en-US") + " launches, read " + Math.max(0, Math.round((Date.now() - readAt) / 1000)) + " s ago" : "Reading meme.cooking";
  }, 1000);

  getJSON("/mc/launches").then(async (d) => {
    total = d.total; readAt = Date.now();
    d.launches.slice(0, 6).forEach((m) => cards.push(build(m)));
    root.dataset.live = "on";
    /* the cards trace one after another so the shared read budget serves every visitor */
    cards.forEach((c) => readRhea(c));
    for (const c of cards) { while (window.CustomsHunting) await sleep(1000); await run(c); await sleep(300); }
  }).catch(() => { if (clock) clock.textContent = "meme.cooking did not answer. Reload to read it again."; });

  window.CustomsFeed = { cards };
})();
