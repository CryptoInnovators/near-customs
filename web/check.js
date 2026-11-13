"use strict";
/* The check screen. A feed of the newest Nearly launches, each tagged ALLOW / WARN / BLOCK by verdictOf (verdict.js);
   the open launch shows its reasons, the funding graph and the agent buy gate. Reads go through CustomsInspector (app.js),
   so no verdict prints until every opening buyer has a final trace (traceVerdict in ui.js). */
(() => {
  const API = "https://nearly.trade/api";
  const FEED_ROWS = 8;
  const BACKGROUND_ROWS = 10;
  const GATE = "customs-gate.testnet";
  const q = (s) => document.querySelector(s);
  const el = {
    form: q("#check-form"), input: q("#check-input"), go: q("#check-go"), hint: q("#check-hint"),
    verdict: q("#verdict"), name: q("#v-name"), account: q("#v-account"), copy: q("#v-copy"), creator: q("#v-creator"), nearly: q("#v-nearly"),
    stamp: q("#v-stamp"), line: q("#v-line"), sub: q("#v-sub"), actions: q("#v-actions"),
    total: q("#v-total"), bar: q("#v-bar"), legend: q("#v-legend"), read: q("#v-read"),
    buyers: q("#s-buyers"), traced: q("#s-traced"), block: q("#s-block"),
    cap: q("#ledger-cap"), ledger: q("#ledger"), graph: q("#graph"), graphCap: q("#graph-cap"),
    list: q("#launch-list"), more: q("#launch-more"), note: q("#feed-note"),
    agentGo: q("#agent-go"), agentSteps: q("#agent-steps"),
  };

  let run = 0;
  let userBusy = false;
  const snapshots = new Map();
  let anchors = {};
  const live = new Map();
  const attempts = new Map();
  let launches = [];
  let sort = "new";
  let expanded = false;
  let current = null;
  let finalBlock = null;
  let replayRow = [];

  const fmtNear = (n) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toPrecision(2)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const acct = (a) => shortAccount(a);
  const age = (ms) => {
    const m = Math.max(0, Math.floor((Date.now() - Number(ms)) / 60000));
    return m < 1 ? "under a minute" : m < 60 ? m + " min" : m < 1440 ? Math.floor(m / 60) + " h" : Math.floor(m / 1440) + " days";
  };
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tidyError = (e) => String((e && e.message) || e).replace(/\s+/g, " ").slice(0, 200);
  const txUrl = (hash, net = current && current.net) => (net === "testnet" ? "https://testnet.nearblocks.io/txns/" : "https://nearblocks.io/txns/") + encodeURIComponent(hash);
  const link = (href, text, label) => '<a href="' + esc(href) + '" target="_blank" rel="noreferrer"' + (label ? ' aria-label="' + esc(label) + '"' : "") + ">" + text + "</a>";

  /* ---------------------------------------------------------------- model */

  const KIND = { linked: "paid", creator: "own", unlinked: "none", unpriced: "none", not_traced: "unchecked", incomplete: "unchecked" };
  const kindOf = (b) => (b.status ? KIND[b.status] || "unchecked" : "tracing");
  const BUYER_STAMP = { paid: ["red", "Creator paid"], own: ["red", "Creator buy"], none: ["green", "No link"], tracing: ["amber", "Tracing"], unchecked: ["grey", "Not checked"] };
  const VERDICT_INK = { ALLOW: "green", WARN: "amber", BLOCK: "red" };
  const stampHtmlLocal = (ink, word) => '<span class="stamp" data-ink="' + ink + '">' + esc(word) + "</span>";

  function fromSnapshot(x) {
    return {
      token: x.token, name: x.name, symbol: x.symbol, creator: x.creator, created: x.created_at_ms, net: x.net,
      block: x.read_block, at: Date.parse(x.computed_at), live: false,
      buyers: x.buyers.map((b) => ({ wallet: b.wallet, near: b.near, status: b.status, tx: b.first_tx, path: b.path })),
    };
  }

  function fromRaw(meta, list, block) {
    return {
      token: meta.token, name: meta.name, symbol: meta.symbol, creator: meta.creator, created: meta.created,
      block, at: Date.now(), live: true,
      buyers: list.map((b) => ({
        wallet: b.wallet, near: Number(b.cost || 0n) / 1e24, status: b.trace ? b.trace.status : null, tx: b.firstTx,
        path: ((b.trace && b.trace.path) || []).map((h) => ({ from: h.from, to: h.to, near: Number(h.yocto || 0n) / 1e24, tx: h.tx })),
      })),
    };
  }

  function figures(buyers) {
    const f = { paid: 0, own: 0, none: 0, tracing: 0, unchecked: 0, near: { paid: 0, own: 0, none: 0, tracing: 0, unchecked: 0 }, total: 0 };
    for (const b of buyers) {
      const k = kindOf(b);
      f[k]++;
      f.near[k] += b.near;
      f.total += b.near;
    }
    f.done = f.paid + f.own + f.none;
    f.complete = buyers.length > 0 && f.done === buyers.length;
    return f;
  }

  function known(token) {
    return live.get(token) || (snapshots.has(token) ? fromSnapshot(snapshots.get(token)) : null);
  }

  /* ---------------------------------------------------------------- detail */

  function setStamp(ink, word, land) {
    el.stamp.dataset.ink = ink;
    el.stamp.firstElementChild.textContent = word;
    el.stamp.classList.remove("land");
    if (land) { void el.stamp.offsetWidth; el.stamp.classList.add("land"); }
  }

  function renderIdentity(m) {
    el.name.innerHTML = esc(m.name || m.token) + (m.symbol ? "<small>$" + esc(m.symbol) + "</small>" : "");
    el.account.textContent = m.token;
    el.copy.hidden = false;
    el.creator.textContent = m.creator ? "Creator " + acct(m.creator) + (m.created ? " · launched " + age(m.created) + " ago" : m.net === "testnet" ? " · NEAR testnet replay" : "") : "";
    el.nearly.hidden = m.net === "testnet";
    el.nearly.href = "https://nearly.trade/t/" + encodeURIComponent(m.token);
    document.title = (m.name || m.token) + ": ALLOW, WARN or BLOCK | Customs";
  }

  function renderSplit(f) {
    const parts = [["paid", f.near.paid, "Creator-funded"], ["own", f.near.own, null], ["none", f.near.none, "No link"], ["tracing", f.near.tracing, "Tracing"], ["unchecked", f.near.unchecked, "Not checked"]];
    el.total.textContent = fmtNear(f.total) + " NEAR total";
    el.bar.innerHTML = parts.filter((p) => p[1] > 0).map((p) => '<i data-k="' + p[0] + '" style="flex:0 0 ' + (p[1] / (f.total || 1) * 100).toFixed(2) + '%"></i>').join("");
    el.bar.setAttribute("aria-label", "Opening buys by source: " + parts.filter((p) => p[1] > 0).map((p) => (p[2] || "Creator's own buy") + " " + fmtNear(p[1]) + " NEAR").join(", "));
    el.legend.innerHTML = parts.filter((p) => p[2] || p[1] > 0).map((p) => '<li><i data-k="' + p[0] + '"></i>' + esc(p[2] || "Creator's own buy") + " <b>" + (p[0] === "tracing" || p[0] === "unchecked" ? f[p[0]] : fmtNear(p[1]) + " NEAR") + "</b></li>").join("");
  }

  function hopHtml(h) {
    return '<span class="hop">' + esc(acct(h.from)) + " → " + esc(acct(h.to)) + " · " + fmtNear(h.near) + " NEAR " + link(txUrl(h.tx), "↗", "Transaction " + h.tx) + "</span>";
  }

  function renderLedger(m, f) {
    const rank = { paid: 0, own: 1, tracing: 2, unchecked: 3, none: 4 };
    const rows = m.buyers.slice().sort((a, b) => rank[kindOf(a)] - rank[kindOf(b)] || b.near - a.near);
    const n = m.buyers.length;
    el.cap.innerHTML = f.complete
      ? "<b>" + f.paid + " of " + plural(n, "opening buyer", "opening buyers") + "</b> received money from the creator before they bought."
      : "Following the money for " + plural(n, "opening buyer", "opening buyers") + ". The count prints when every one is traced.";
    el.ledger.innerHTML = rows.map((b) => {
      const k = kindOf(b);
      let path;
      if (k === "paid") path = b.path.map(hopHtml).join("");
      else if (k === "own") path = "Bought from the creator's own wallet.";
      else if (k === "none") path = b.status === "unpriced" ? "The buy moved no NEAR into the market, so it cannot be priced." : "No transfer from the creator within 3 hops.";
      else if (k === "tracing") path = 'Tracing<span class="skel"></span>';
      else path = "Not read. Retry reads it again.";
      return '<li data-kind="' + k + '"><span class="l-buyer">' + link((m.net === "testnet" ? "https://testnet.nearblocks.io" : "https://nearblocks.io") + "/address/" + encodeURIComponent(b.wallet), esc(acct(b.wallet))) + "</span>" +
        '<span class="l-bought"><span class="lab">Bought </span>' + fmtNear(b.near) + " NEAR</span>" +
        '<span class="l-path">' + path + "</span>" + '<span class="l-verdict">' + stampHtmlLocal(...BUYER_STAMP[k]) + "</span></li>";
    }).join("");
  }

  /* The funding graph: creator on the left, intermediate wallets in the middle, flagged buyers on the right.
     Buyers with no link collapse into one dashed node. Every edge is a link to the transfer. */
  function renderGraph(m, f) {
    const paid = m.buyers.filter((b) => kindOf(b) === "paid");
    const own = m.buyers.filter((b) => kindOf(b) === "own");
    const quiet = m.buyers.length - paid.length - own.length;
    if (!f.complete) { el.graph.innerHTML = '<p class="graph-empty">The graph draws when every opening buyer is traced.</p>'; el.graphCap.textContent = ""; return; }
    const buyerIds = new Set(m.buyers.map((b) => b.wallet));
    const mids = [];
    for (const b of paid) for (const h of b.path) for (const id of [h.from, h.to]) if (id !== m.creator && !buyerIds.has(id) && !mids.includes(id)) mids.push(id);
    const rightNodes = [...paid.map((b) => ({ id: b.wallet, kind: "paid", near: b.near })), ...own.map((b) => ({ id: b.wallet, kind: "own", near: b.near }))];
    if (quiet > 0) rightNodes.push({ id: "__quiet", kind: "none", count: quiet });
    const ROW = 52, W = 780, NODE_H = 36, X = { c: 16, m: 300, b: 566 }, NW = { c: 190, m: 190, b: 198 };
    const rows = Math.max(rightNodes.length, mids.length, 1);
    const H = rows * ROW + 20;
    const ycenter = (i, n) => 10 + (H - 20) / n * (i + 0.5);
    const pos = { [m.creator]: { x: X.c, w: NW.c, y: H / 2, kind: "creator" } };
    mids.forEach((id, i) => { pos[id] = { x: X.m, w: NW.m, y: ycenter(i, mids.length), kind: "mid" }; });
    rightNodes.forEach((n, i) => { pos[n.id] = { x: X.b, w: NW.b, y: ycenter(i, rightNodes.length), kind: n.kind }; });
    const edges = [];
    for (const b of paid) for (const h of b.path) {
      const a = pos[h.from], z = pos[h.to];
      if (!a || !z) continue;
      const x1 = a.x + a.w, x2 = z.x, mx = (x1 + x2) / 2;
      edges.push('<a href="' + esc(txUrl(h.tx)) + '" target="_blank" rel="noreferrer" aria-label="' + esc(acct(h.from) + " to " + acct(h.to) + ", " + fmtNear(h.near) + " NEAR, transaction " + h.tx) + '"><path class="edge" d="M' + x1 + " " + a.y + " C" + mx + " " + a.y + " " + mx + " " + z.y + " " + x2 + " " + z.y + '"/><path class="edge-hit" d="M' + x1 + " " + a.y + " C" + mx + " " + a.y + " " + mx + " " + z.y + " " + x2 + " " + z.y + '"/><text class="edge-label" x="' + mx + '" y="' + ((a.y + z.y) / 2 - 6) + '" text-anchor="middle">' + fmtNear(h.near) + " NEAR</text></a>");
    }
    for (const b of own) {
      const a = pos[m.creator], z = pos[b.wallet];
      if (a && z && b.wallet !== m.creator) edges.push('<path class="edge own" d="M' + (a.x + a.w) + " " + a.y + " C" + (X.m + 60) + " " + a.y + " " + (X.m + 60) + " " + z.y + " " + z.x + " " + z.y + '"/>');
    }
    const node = (id, p, label, sub, cls) => '<g class="node ' + cls + '"><rect x="' + p.x + '" y="' + (p.y - NODE_H / 2) + '" width="' + p.w + '" height="' + NODE_H + '" rx="4"/><text x="' + (p.x + 12) + '" y="' + (p.y - (sub ? 2 : -4)) + '">' + esc(label) + "</text>" + (sub ? '<text class="sub" x="' + (p.x + 12) + '" y="' + (p.y + 12) + '">' + esc(sub) + "</text>" : "") + "</g>";
    const nodes = [node(m.creator, pos[m.creator], acct(m.creator), "Creator", "creator")];
    mids.forEach((id) => nodes.push(node(id, pos[id], acct(id), "Passed it on", "mid")));
    rightNodes.forEach((n) => nodes.push(n.id === "__quiet"
      ? node(n.id, pos[n.id], plural(n.count, "other buyer", "other buyers"), "No transfer from the creator", "none")
      : node(n.id, pos[n.id], acct(n.id), (n.kind === "own" ? "Creator's own buy " : "Bought ") + fmtNear(n.near) + " NEAR", n.kind)));
    const summary = paid.length ? paid.length + " of " + plural(m.buyers.length, "opening buyer", "opening buyers") + " traced back to the creator" : "no opening buyer traced back to the creator";
    el.graph.innerHTML = '<div class="graph-scroll"><svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Funding graph: ' + esc(summary) + '">' + edges.join("") + nodes.join("") + "</svg></div>";
    el.graphCap.textContent = paid.length
      ? "Each line is a transfer from the creator's wallet that reached an opening buyer before it bought. Select a line to open the transaction."
      : "No transfer from the creator's wallet reached any opening buyer within 3 hops, each before the buy and at least half its cost.";
  }

  function render(m, state) {
    current = m;
    const f = figures(m.buyers);
    renderIdentity(m);
    renderSplit(f);
    renderLedger(m, f);
    renderGraph(m, f);
    const n = m.buyers.length;
    el.buyers.textContent = String(n);
    el.traced.textContent = f.done + " of " + n;
    el.block.textContent = m.block ? group(String(m.block)) : "reading";
    el.verdict.dataset.state = state;
    el.actions.innerHTML = "";
    const v = f.complete ? verdictOf(m.buyers) : null;
    if (!v) return null;
    setStamp(VERDICT_INK[v.kind], v.kind, state === "live");
    el.line.textContent = v.reasons[0];
    el.sub.textContent = v.reasons.slice(1).join(" ");
    return v;
  }

  function renderRead(m) {
    if (m.net === "testnet") { el.read.textContent = "Read from the chain at block " + group(String(m.block)) + ". Every transfer links to the testnet explorer."; return; }
    const at = m.live ? "Read at block " + group(String(m.block || "")) + ", " + (Date.now() - m.at < 60000 ? "just now" : age(m.at) + " ago") + "." : "Last checked at block " + group(String(m.block)) + ", " + age(m.at) + " ago.";
    el.read.innerHTML = esc(at) + ' <button type="button" class="link" id="again">Check again live</button>';
    q("#again").addEventListener("click", () => check(m.token));
  }

  /* ---------------------------------------------------------------- live reads */

  async function launchMeta(token) {
    const r = await fetch(API + "/launch/" + encodeURIComponent(token));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("Nearly answered HTTP " + r.status + " for " + token + ".");
    const d = await r.json();
    return { token, name: d.name || token, symbol: d.symbol || "", creator: d.creator || "", created: d.created_at_ms || null };
  }

  async function readBlock() {
    try {
      const base = await fastnearBase("mainnet", "rpc");
      const r = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "block", params: { finality: "final" } }) });
      return (await r.json()).result.header.height;
    } catch { return finalBlock; }
  }

  function setBusy(busy) {
    userBusy = busy;
    el.go.disabled = busy;
    el.go.textContent = busy ? "Checking…" : "Check opening buyers";
  }

  function showLoading(token, meta) {
    el.verdict.dataset.state = "loading";
    setStamp("amber", "Checking");
    el.line.textContent = "Reading the first 10 minutes of sales…";
    el.sub.textContent = "";
    el.actions.innerHTML = "";
    el.read.innerHTML = "";
    el.bar.innerHTML = "";
    el.legend.innerHTML = "";
    el.total.textContent = "";
    el.ledger.innerHTML = "";
    el.cap.textContent = "";
    el.graph.innerHTML = '<p class="graph-empty">The graph draws when every opening buyer is traced.</p>';
    el.graphCap.textContent = "";
    el.buyers.textContent = "0";
    el.traced.textContent = "0 of 0";
    el.block.textContent = "reading";
    resetAgent();
    if (meta) renderIdentity(meta);
    else { el.name.textContent = token; el.account.textContent = ""; el.creator.textContent = ""; el.copy.hidden = true; el.nearly.hidden = true; }
  }

  function showFailure(headline, sub, retry) {
    el.verdict.dataset.state = "error";
    setStamp("grey", "Not checked");
    el.line.textContent = headline;
    el.sub.textContent = sub || "";
    el.actions.innerHTML = retry ? '<button type="button" class="ghost" id="retry">Try again</button>' : "";
    if (retry) q("#retry").addEventListener("click", retry);
    el.read.innerHTML = "";
  }

  async function check(token) {
    const id = ++run;
    el.hint.hidden = true;
    el.input.removeAttribute("aria-invalid");
    el.input.value = token;
    setBusy(true);
    showLoading(token, null);
    history.replaceState(null, "", "?t=" + encodeURIComponent(token));
    let meta;
    try {
      meta = await launchMeta(token);
    } catch (e) {
      if (id === run) { showFailure(tidyError(e), "", () => check(token)); setBusy(false); }
      return;
    }
    if (id !== run) return;
    if (!meta) {
      showFailure(token + " is not a Nearly launch.", "Customs reads the creator from the launch, so it checks launches made on Nearly. Pick one from the feed.", null);
      setBusy(false);
      return;
    }
    showLoading(token, meta);
    let raw = [];
    let frame = 0;
    const paint = () => {
      frame = 0;
      if (id !== run || !raw.length) return;
      render(fromRaw(meta, raw, finalBlock), "loading");
      setStamp("amber", "Checking");
      el.line.textContent = el.line.dataset.step || "Reading the first 10 minutes of sales…";
      el.sub.textContent = "";
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const hooks = { onBuyers: (ctx) => { raw = ctx.list; schedule(); }, onTrace: schedule };
    CustomsInspector.setProgress((msg) => {
      if (id !== run) return;
      const t = /^Tracing (\d+) of (\d+): (.+)$/.exec(msg);
      const text = t ? "Following the money for buyer " + t[1] + " of " + t[2] + ": " + acct(t[3]) : msg;
      el.line.dataset.step = text;
      if (el.verdict.dataset.state === "loading") el.line.textContent = text;
    });
    let data;
    try {
      data = await CustomsInspector.inspect(token, meta.creator, hooks);
    } catch (e) {
      if (id === run) { showFailure(tidyError(e), "", () => check(token)); setBusy(false); }
      return;
    }
    if (id !== run || !data) return;
    finalBlock = (await readBlock()) || finalBlock;
    finish(meta, data, id, hooks);
  }

  function finish(meta, data, id, hooks) {
    if (id !== run) return;
    const v = traceVerdict(data.list);
    const m = fromRaw(meta, data.list, finalBlock);
    setBusy(false);
    if (v.complete) {
      render(m, "live");
      renderRead(m);
      live.set(meta.token, m);
      renderFeed();
      return;
    }
    render(m, "partial");
    const left = v.total - v.done;
    const throttled = data.list.some((b) => b.trace && /429|rate|Too Many/i.test(b.trace.note || ""));
    setStamp("grey", "Not finished");
    el.line.textContent = "Traced " + v.done + " of " + plural(v.total, "opening buyer", "opening buyers") + ". " + left + " could not be read.";
    el.sub.textContent = throttled ? "The NEAR transaction API refused some reads (rate limit)." : "The funding reads for the rest did not finish.";
    el.actions.innerHTML = '<button type="button" class="ghost" id="retry">Retry the ' + left + " untraced</button>";
    q("#retry").addEventListener("click", async () => {
      const rid = ++run;
      setBusy(true);
      setStamp("amber", "Checking");
      el.line.textContent = "Reading the " + left + " untraced buyers again…";
      el.sub.textContent = "";
      el.actions.innerHTML = "";
      try {
        const again = await CustomsInspector.retry(data, hooks);
        if (again) finish(meta, again, rid, hooks);
      } catch (e) { if (rid === run) { setBusy(false); showFailure(tidyError(e), "", () => check(meta.token)); } }
    });
  }

  /* ---------------------------------------------------------------- feed */

  const RANK = { BLOCK: 0, WARN: 1, ALLOW: 2 };
  function feedStatus(l) {
    const m = known(l.token);
    if (!m) return { kind: "UNCHECKED", rank: 3, m: null, v: null };
    const v = verdictOf(m.buyers);
    return v ? { kind: v.kind, rank: RANK[v.kind], m, v } : { kind: "UNCHECKED", rank: 3, m, v: null };
  }

  function shortReason(s) {
    if (!s.v) return "";
    if (s.v.funded) return "Creator funded " + s.v.funded + " of " + plural(s.v.buyers, "buyer", "buyers");
    if (s.v.own) return "Creator bought " + fmtNear(s.v.ownNear) + " NEAR in the opening";
    return plural(s.v.buyers, "buyer", "buyers") + ", none funded";
  }

  let checking = "";
  function renderFeed() {
    if (!launches.length) return;
    const rows = launches.map((l) => ({ l, s: feedStatus(l) }));
    if (sort === "flag") rows.sort((a, b) => a.s.rank - b.s.rank);
    const shown = expanded ? rows : rows.slice(0, FEED_ROWS);
    el.list.innerHTML = shown.map(({ l, s }) => {
      const busy = checking === l.token;
      const ink = busy ? "amber" : s.kind === "UNCHECKED" ? "grey" : VERDICT_INK[s.kind];
      const word = busy ? "Checking" : s.kind === "UNCHECKED" ? "Not checked" : s.kind;
      const meta = (l.replay ? "testnet replay" : l.created_at_ms ? age(l.created_at_ms) + " old" : "new") + (s.v ? " · " + shortReason(s) : busy ? " · reading the opening buyers" : " · queued");
      return '<li' + (current && current.token === l.token ? ' aria-current="true"' : "") + '><button type="button" class="row" data-token="' + esc(l.token) + '"><span class="r-name">' + esc(l.name || l.token) + '</span><span class="r-meta">' + esc(meta) + "</span>" + stampHtmlLocal(ink, word) + "</button></li>";
    }).join("");
    el.more.hidden = rows.length <= FEED_ROWS;
    el.more.textContent = expanded ? "Show fewer" : "View all " + rows.length + " launches";
    const real = rows.filter((r) => !r.l.replay);
    el.note.textContent = real.filter((r) => r.s.v).length + " of " + real.length + " launches checked" + (finalBlock ? " · mainnet block " + group(String(finalBlock)) : "");
  }

  async function loadFeed() {
    try {
      const r = await fetch(API + "/launches?sort=new&limit=40");
      if (!r.ok) throw new Error("Nearly launches answered HTTP " + r.status + ".");
      const b = await r.json();
      launches = [...replayRow, ...(Array.isArray(b) ? b : b.launches || b.data || []).map((x) => ({ ...x, token: x.token || x.account_id || x.contract || x.token_id })).filter((x) => x.token)];
      renderFeed();
    } catch (e) {
      el.list.innerHTML = '<li class="launch-empty">Launches could not be read (' + esc(tidyError(e)) + '). <button type="button" class="link" id="relist">Try again</button></li>';
      q("#relist").addEventListener("click", () => { el.list.innerHTML = '<li class="launch-empty">Reading launches…</li>'; loadFeed(); });
    }
  }

  /* The newest launches without a stored check are read in the background, one at a time, so every visible row ends up tagged.
     A visitor's own check takes the shared inspector first; a cancelled read is retried later, twice at most. */
  async function backgroundChecks() {
    for (;;) {
      await sleep(1500);
      if (userBusy) continue;
      const next = launches.slice(0, BACKGROUND_ROWS).find((l) => !known(l.token) && (attempts.get(l.token) || 0) < 2);
      if (!next) { if (!launches.length || launches.slice(0, BACKGROUND_ROWS).every((l) => known(l.token) || (attempts.get(l.token) || 0) >= 2)) return; continue; }
      attempts.set(next.token, (attempts.get(next.token) || 0) + 1);
      checking = next.token;
      renderFeed();
      CustomsInspector.setProgress(() => {});
      try {
        const data = await CustomsInspector.inspect(next.token, next.creator, {});
        if (data && !userBusy) {
          const meta = { token: next.token, name: next.name || next.token, symbol: next.symbol || "", creator: next.creator || "", created: next.created_at_ms };
          if (!traceVerdict(data.list).complete) await CustomsInspector.retry(data, {});
          if (traceVerdict(data.list).complete) live.set(next.token, fromRaw(meta, data.list, finalBlock || (await readBlock())));
        }
      } catch { /* the launch stays unchecked and is retried once */ }
      checking = "";
      renderFeed();
    }
  }

  /* ---------------------------------------------------------------- agent buy gate */

  const stepHtml = (state, text) => '<li data-state="' + state + '">' + text + "</li>";
  function resetAgent() { el.agentSteps.innerHTML = ""; el.agentGo.disabled = false; el.agentGo.textContent = "Let an agent buy it"; }

  async function gateView(token) {
    const base = await fastnearBase("testnet", "rpc");
    const args = btoa(JSON.stringify({ token }));
    const r = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: GATE, method_name: "verdict_of", args_base64: args } }) });
    const j = await r.json();
    if (j.error || !j.result || j.result.error) throw new Error("The gate contract could not be read.");
    return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
  }

  async function txOutcome(hash, signer) {
    const base = await fastnearBase("testnet", "rpc");
    for (let i = 0; i < 20; i++) {
      const r = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" } }) });
      const j = await r.json();
      if (j.result && j.result.final_execution_status === "FINAL") return j.result;
      await sleep(1500);
    }
    throw new Error("The transaction did not reach a final state in 30 seconds.");
  }

  async function agentBuy() {
    const m = current;
    if (!m) return;
    const token = m.token;
    el.agentGo.disabled = true;
    el.agentGo.textContent = "Agent working…";
    const steps = [stepHtml("run", "The agent asks the Customs gate for the verdict on " + esc(token) + "…")];
    const paintSteps = () => { el.agentSteps.innerHTML = steps.join(""); };
    paintSteps();
    try {
      const anchored = await gateView(token);
      steps[0] = stepHtml("done", "The agent asked the Customs gate for the verdict on " + esc(token) + ".");
      steps.push(anchored
        ? stepHtml("done", "The gate holds <b>" + esc(anchored.verdict) + "</b>, anchored on testnet" + (anchors[token] ? " " + link(txUrl(anchors[token].tx, "testnet"), "↗", "Anchor transaction") : "") + ": " + esc(anchored.reason))
        : stepHtml("done", "The gate holds no verdict for this launch."));
      steps.push(stepHtml("run", "The agent calls <code>buy</code> with its spend-only key…"));
      paintSteps();
      const res = await fetch("/agent/buy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.tx) throw new Error(body.error || "The agent service answered HTTP " + res.status + ".");
      const out = await txOutcome(body.tx, body.signer);
      const failure = out.status && out.status.Failure;
      const text = failure ? JSON.stringify(failure) : "";
      const reason = /(?:BLOCK|WARN|NO VERDICT)[^"\\]*/.exec(text);
      steps.pop();
      if (failure && reason) steps.push(stepHtml("refused", "<b>The gate refused the buy.</b> " + esc(reason[0]) + " No NEAR moved. " + link(txUrl(body.tx, "testnet"), "Open the refused transaction ↗")));
      else if (!failure) steps.push(stepHtml("cleared", "<b>The gate cleared the buy.</b> It released " + esc(body.released || "the payment") + " from the agent's vault. " + link(txUrl(body.tx, "testnet"), "Open the transaction ↗")));
      else steps.push(stepHtml("error", "The buy failed for a reason other than a verdict: " + esc(text.slice(0, 160)) + " " + link(txUrl(body.tx, "testnet"), "Open the transaction ↗")));
    } catch (e) {
      steps.pop();
      steps.push(stepHtml("error", esc(tidyError(e)) + ' <button type="button" class="link" id="agent-retry">Try again</button>'));
    }
    paintSteps();
    el.agentGo.disabled = false;
    el.agentGo.textContent = "Run it again";
    const again = q("#agent-retry");
    if (again) again.addEventListener("click", agentBuy);
  }
  el.agentGo.addEventListener("click", agentBuy);

  /* ---------------------------------------------------------------- input */

  /* Accepts a token account or a Nearly URL (nearly.trade/t/<account>). Returns "" when it is neither. */
  function parseToken(text) {
    let v = String(text || "").trim().toLowerCase();
    if (/^https?:\/\//.test(v)) {
      try { v = new URL(v).pathname.split("/").filter(Boolean).pop() || ""; } catch { return ""; }
    }
    return /^(?:[a-z0-9]+[-_.])*[a-z0-9]+$/.test(v) && v.length >= 2 && v.length <= 64 && v.includes(".") ? v : "";
  }

  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const token = parseToken(el.input.value);
    if (!token) {
      el.input.setAttribute("aria-invalid", "true");
      el.hint.hidden = false;
      el.hint.textContent = "Enter a token account such as nearly.nearlytrade.near.";
      el.input.focus();
      return;
    }
    select(token);
  });

  /* A launch with a stored check shows it at once and offers a live re-check; any other launch is checked live. */
  function select(token, { fresh } = {}) {
    const m = !fresh && known(token);
    if (m) {
      run++;
      setBusy(false);
      el.input.value = token;
      history.replaceState(null, "", "?t=" + encodeURIComponent(token));
      resetAgent();
      render(m, m.live ? "live" : "snapshot");
      renderRead(m);
      renderFeed();
      return;
    }
    check(token);
  }

  el.list.addEventListener("click", (e) => {
    const b = e.target.closest("button.row");
    if (!b) return;
    select(b.dataset.token);
    if (window.matchMedia("(max-width:1100px)").matches) q("#verdict").scrollIntoView({ block: "start", behavior: "smooth" });
  });
  el.more.addEventListener("click", () => { expanded = !expanded; renderFeed(); });
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    sort = b.dataset.sort;
    expanded = false;
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderFeed();
  }));
  el.copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.origin + location.pathname + "?t=" + encodeURIComponent(current.token)); el.copy.textContent = "Link copied"; setTimeout(() => { el.copy.textContent = "Copy link"; }, 1500); } catch { /* clipboard blocked */ }
  });
  const menu = q(".menu");
  menu.addEventListener("click", () => { const open = menu.getAttribute("aria-expanded") === "true"; menu.setAttribute("aria-expanded", String(!open)); q("#nav").classList.toggle("open", !open); });

  /* ---------------------------------------------------------------- start */

  (async function start() {
    fastnearBase("mainnet", "rpc").then((base) => chainStrip("mainnet", [base]));
    const want = parseToken(new URLSearchParams(location.search).get("t"));
    try {
      const r = await fetch("data/verdicts.json");
      if (r.ok) for (const x of (await r.json()).items || []) if (x.complete && x.buyers) snapshots.set(x.token, x);
    } catch { /* no snapshot: launches are checked live below */ }
    try {
      const r = await fetch("data/anchors.json");
      if (r.ok) anchors = await r.json();
    } catch { /* anchors are optional links */ }
    try {
      const r = await fetch("data/replay.json");
      if (r.ok) { const x = await r.json(); snapshots.set(x.token, x); replayRow = [{ token: x.token, name: x.name + " (testnet)", replay: true }]; }
    } catch { /* the replay row is optional */ }
    readBlock().then((b) => { finalBlock = b; renderFeed(); });
    await loadFeed();
    if (want) select(want);
    else {
      const flagged = launches.map((l) => ({ l, s: feedStatus(l) })).filter((r) => r.s.v).sort((a, b) => a.s.rank - b.s.rank)[0];
      if (flagged) select(flagged.l.token);
      else if (launches.length) select(launches[0].token, { fresh: true });
      else showFailure("Launches could not be read.", "Paste a token account above to check one directly.", null);
    }
    /* the background reads are many requests to a rate-limited public API: they start when the visitor reaches the launch list, never during the first screen */
    if (typeof IntersectionObserver === "function") {
      const watch = new IntersectionObserver((hits) => { if (hits.some((h) => h.isIntersecting)) { watch.disconnect(); backgroundChecks(); } });
      watch.observe(el.list);
    } else backgroundChecks();
  })();
})();
