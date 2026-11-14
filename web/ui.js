"use strict";

/* Shared view helpers: escaping, number and time formats, stamps, account and hash references, the chain strip.
   Classic script, loaded before customs.js and app.js. The pure helpers are exported for the node tests. */

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

const EXPLORERS = { mainnet: "https://nearblocks.io", testnet: "https://testnet.nearblocks.io" };

/* head 6, tail 4, as the design brief fixes it; the full value stays in the title */
function shorten(value, head = 6, tail = 4) {
  const v = String(value || "");
  return v.length > head + tail + 3 ? v.slice(0, head) + "…" + v.slice(-tail) : v;
}

/* Account ids are shown whole until they pass 30 characters; a 64 hex implicit account is always shortened. */
function shortAccount(id) {
  const v = String(id || "");
  return v.length > 30 ? shorten(v, 8, 6) : v;
}

function group(digits) {
  return String(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/* raw: integer string or BigInt of the smallest unit. Returns { amount, raw } with amount to two places. */
function amountParts(raw, decimals) {
  let n;
  try { n = BigInt(raw); } catch { return { amount: "?", raw: "?" }; }
  const d = BigInt(decimals);
  const unit = 10n ** d;
  const whole = n / unit;
  const frac = ((n % unit) * 100n) / unit;
  return { amount: group(whole.toString()) + "." + frac.toString().padStart(2, "0"), raw: group(n.toString()) };
}

function utc(seconds) {
  const d = new Date(Number(seconds) * 1000);
  const p = (x) => String(x).padStart(2, "0");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return p(d.getUTCDate()) + " " + month + " " + d.getUTCFullYear() + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + " UTC";
}

/* "29 d 11 h" above a day, "14 h 02 m" under it, "now" at zero */
function countdown(untilS, nowS) {
  let left = Math.floor(Number(untilS) - Number(nowS));
  if (!(left > 0)) return null;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  if (d > 0) return d + " d " + h + " h";
  return h + " h " + String(m).padStart(2, "0") + " m";
}

const STAMPS = {
  pass: { word: "Cleared", ink: "green" },
  vested: { word: "Vested", ink: "green" },
  no_link: { word: "No link", ink: "green" },
  fail: { word: "Refused", ink: "red" },
  seized: { word: "Seized", ink: "red", angle: -8 },
  upheld: { word: "Upheld", ink: "red" },
  linked: { word: "Linked", ink: "red" },
  returned: { word: "Returned", ink: "red" },
  rejected: { word: "Rejected", ink: "ink" },
  unread: { word: "Unread", ink: "ink" },
  incomplete: { word: "Incomplete", ink: "ink" },
  bonded: { word: "Bonded", ink: "ink" },
};

/* A stamp is applied only to a result. kind picks word, ink and angle; sub is the second typed line; delay staggers the landing. */
function stampHtml(kind, sub, opts) {
  const s = STAMPS[kind];
  const o = opts || {};
  const attrs = ' data-stamp="' + kind + '" data-ink="' + s.ink + '"' + (o.view ? ' data-land="view"' : "") +
    ' style="--r:' + (s.angle !== undefined ? s.angle : -4) + "deg;--d:" + (o.delay || 0) + 'ms"';
  return "<span class=\"stamp\"" + attrs + "><span class=\"stamp-word\">" + esc(s.word) + "</span>" +
    (sub ? "<span class=\"stamp-sub\">" + esc(sub) + "</span>" : "") + "</span>";
}

/* the empty frame a stamp lands in: dashed, muted, still */
function emptyStampHtml(label) {
  return '<span class="stamp stamp-empty" data-stamp="empty" aria-hidden="true"><span class="stamp-word">' + esc(label || "") + "</span></span>";
}

function refHtml(kind, id, net, text) {
  const base = EXPLORERS[net] || EXPLORERS.mainnet;
  const href = base + (kind === "tx" ? "/txns/" : "/address/") + encodeURIComponent(id);
  return '<span class="ref"><a href="' + href + '" title="' + esc(id) + '">' + esc(text || (kind === "tx" ? shorten(id) : shortAccount(id))) + "</a>" +
    '<button type="button" class="copy" data-copy="' + esc(id) + '" aria-label="Copy ' + esc(id) + '"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5.5 5.5h7v8h-7zM3.5 10.5v-8h7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button></span>';
}

function wireCopy(root) {
  root.addEventListener("click", (event) => {
    const btn = event.target.closest && event.target.closest("button.copy");
    if (!btn) return;
    const done = () => {
      btn.dataset.done = "1";
      setTimeout(() => { delete btn.dataset.done; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(btn.dataset.copy).then(done, () => {});
  });
}

/* Land stamps flagged data-land="view" the first time 60% of them is on screen. */
function watchStamps(root) {
  const marks = root.querySelectorAll('[data-land="view"]:not([data-watching])');
  if (!marks.length) return;
  if (!("IntersectionObserver" in window)) {
    marks.forEach((m) => m.classList.add("landed"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("landed");
      io.unobserve(e.target);
    }
  }, { threshold: 0.6 });
  marks.forEach((m) => { m.dataset.watching = "1"; io.observe(m); });
  /* a reader who never scrolls here (a full-page capture, a print) still gets the stamp */
  setTimeout(() => marks.forEach((m) => { if (!m.classList.contains("landed")) { m.classList.add("landed"); io.unobserve(m); } }), 15000);
}

/* The chain strip: final block of the route's network, re-read every 12 s, changed digits roll. */
function chainStrip(net, urls) {
  const label = document.querySelector("[data-network]");
  const out = document.querySelector("[data-block]");
  if (!label || !out) return;
  label.textContent = "NEAR " + net.toUpperCase();
  let shown = "";
  function paint(height) {
    const text = group(String(height));
    if (text === shown) return;
    const prev = shown;
    shown = text;
    const rolling = prev.length === text.length;
    out.innerHTML = [...text].map((ch, i) => {
      if (rolling && prev[i] !== ch && /\d/.test(ch)) {
        return '<span class="dg roll"><i class="old">' + esc(prev[i]) + '</i><i class="new">' + esc(ch) + "</i></span>";
      }
      return '<span class="dg">' + esc(ch) + "</span>";
    }).join("");
    out.setAttribute("aria-label", "block " + text);
  }
  async function read() {
    for (const url of rpcOrder(net, urls)) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "strip", method: "block", params: { finality: "final" } }) });
        if (!res.ok) continue;
        const json = await res.json();
        const h = json && json.result && json.result.header && json.result.header.height;
        if (h) { rpcWorked(net, urls, url); return h; }
      } catch { /* the next endpoint, then the next tick */ }
    }
    return null;
  }
  async function tick() {
    let h = null;
    if (!document.hidden) {
      h = await read();
      if (h) paint(h);
    }
    setTimeout(tick, document.hidden ? 2500 : 12000);
  }
  tick();
}

/* The endpoint that answered last is tried first, so a throttled one is not hit again for every call. */
const RPC_PREF = {};
function rpcOrder(key, urls) {
  const p = RPC_PREF[key] || 0;
  return urls.map((_, i) => urls[(p + i) % urls.length]);
}
function rpcWorked(key, urls, url) {
  RPC_PREF[key] = Math.max(0, urls.indexOf(url));
}

/* funded = buyers whose funding path traces to the creator (status "linked"), devBuys = the creator's own buys (status "creator"). Costs are BigInt sums of b.cost; a missing or unreadable cost counts as 0n. */
function fundedSummary(buyers, traceStatus) {
  const list = Array.isArray(buyers) ? buyers : [];
  const costOf = (b) => {
    const c = b && b.cost;
    if (c === null || c === undefined) return 0n;
    try { return typeof c === "bigint" ? c : BigInt(c); } catch { return 0n; }
  };
  const funded = [], devBuys = [];
  let fundedCost = 0n, devBuyCost = 0n, totalCost = 0n;
  for (const b of list) {
    const cost = costOf(b);
    totalCost += cost;
    const status = traceStatus(b);
    if (status === "linked") { funded.push(b); fundedCost += cost; }
    else if (status === "creator") { devBuys.push(b); devBuyCost += cost; }
  }
  return { funded, fundedCost, devBuys, devBuyCost, totalCost };
}

/* A verdict exists only when every opening buyer has a final trace. Until then figures is null and the page prints progress. */
const RESOLVED = new Set(["linked", "creator", "unlinked", "unpriced"]);
function traceVerdict(buyers) {
  const list = Array.isArray(buyers) ? buyers : [];
  const done = list.filter((b) => b && b.trace && RESOLVED.has(b.trace.status)).length;
  const complete = list.length > 0 && done === list.length;
  return { done, total: list.length, complete, figures: complete ? fundedSummary(list, (b) => b.trace.status) : null };
}

function setField(color) {
  document.body.dataset.field = color;
}

if (typeof module !== "undefined") module.exports = { esc, shorten, shortAccount, group, amountParts, utc, countdown, stampHtml, STAMPS, fundedSummary, traceVerdict };
