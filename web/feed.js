"use strict";
/* The launch feed: real NEAR mainnet launches whose opening buyers Customs has already traced, read live from Nearly every 8 s so buys, holders
   and market cap tick. "Hunt this launch" on a card sends the hunter after that launch's first buyer through the same stamp.js flow. */
(() => {
  const root = document.querySelector("#feed-cards");
  if (!root || !window.CustomsHunt) return;
  const API = "https://nearly.trade/api";
  const COUNT = 5, EVERY = 8000;
  const clock = document.querySelector("#feed-clock");
  const cards = [];
  let readAt = 0;

  const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const usd = (n) => (n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + Math.round(n));
  const age = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? d + "d " + hr + "h" : hr ? hr + "h " + String(m).padStart(2, "0") + "m" : m + "m " + String(s % 60).padStart(2, "0") + "s";
  };
  const hue = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };

  function build(item) {
    const art = h("article", "mcard");
    art.dataset.token = item.token;
    const sticker = h("div", "sticker");
    sticker.dataset.ink = "grey";
    sticker.setAttribute("role", "img");
    sticker.setAttribute("aria-label", "No stamp on this launch");
    sticker.append(h("span", "seal-kind", "Unstamped"), h("b", "", "No bond"), h("span", "", "nothing to take"));
    const avatar = h("span", "avatar", (item.symbol || item.name || "?").slice(0, 1).toUpperCase());
    avatar.style.setProperty("--h", hue(item.token));
    const head = h("header", "mcard-head");
    const id = h("div", "mcard-id");
    id.append(h("p", "ticker", "$" + (item.symbol || "").toUpperCase()), h("h3", "", item.name), h("p", "lcard-id", item.token));
    head.append(avatar, id);
    const stats = h("dl", "mstats");
    const cell = (label, v) => { const d = h("div"); const dd = h("dd", "", v); d.append(h("dt", "", label), dd); stats.append(d); return dd; };
    const mcap = cell("Mkt cap", "Reading"), buys = cell("Buys", "Reading"), ageEl = cell("Age", age(Date.now() - item.created_at_ms));
    const meter = h("div", "meter"), fill = h("i"); meter.append(fill);
    meter.setAttribute("role", "img"); meter.setAttribute("aria-label", "Bonding curve progress");
    const meterLabel = h("p", "meter-label", "Reading the bonding curve");
    const btn = h("button", "hunt", "Hunt this launch");
    btn.type = "button";
    const buyer = item.buyers[0];
    btn.addEventListener("click", () => window.CustomsHunt.hunt({ launch: item.token, wallet: buyer.wallet, tx: buyer.first_tx, name: item.name }));
    art.append(sticker, head, stats, meter, meterLabel, btn);
    root.append(art);
    return { item, art, sticker, avatar, mcap, buys, ageEl, fill, meterLabel };
  }

  const flash = (el, text) => { if (el.textContent === text) return; const first = el.textContent === "Reading"; el.textContent = text; if (!first) { el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick"); } };

  async function read(c) {
    const r = await fetch(API + "/launch/" + encodeURIComponent(c.item.token));
    if (!r.ok) throw Error("HTTP " + r.status);
    const d = await r.json();
    flash(c.mcap, usd(Number(d.fdv_usd) || 0));
    flash(c.buys, String(d.buys ?? 0));
    const span = Math.abs(Number(d.right_point) - Number(d.left_point)), start = Number(d.token_is_x) ? Number(d.left_point) : Number(d.right_point), pct = span > 0 ? Math.min(100, Math.abs(Number(d.current_point) - start) / span * 100) : 0;
    c.fill.style.width = Math.max(pct, 2.5) + "%";
    c.meterLabel.textContent = "Bonding curve " + (pct < 1 ? pct.toFixed(2) : pct.toFixed(1)) + "% · " + (d.holders ?? 0) + (Number(d.holders) === 1 ? " holder" : " holders");
    if (d.icon && !c.avatar.querySelector("img")) {
      const img = new Image();
      img.alt = "";
      img.onload = () => { c.avatar.textContent = ""; c.avatar.append(img); };
      img.src = d.icon;
    }
  }

  async function poll() {
    const results = await Promise.allSettled(cards.map(read));
    if (results.some((x) => x.status === "fulfilled")) readAt = Date.now();
    root.dataset.live = readAt ? "on" : "off";
  }

  setInterval(() => {
    cards.forEach((c) => { c.ageEl.textContent = age(Date.now() - c.item.created_at_ms); });
    if (clock) clock.textContent = readAt ? "Nearly market data, read " + Math.max(0, Math.round((Date.now() - readAt) / 1000)) + " s ago" : "Reading NEAR mainnet launches";
  }, 1000);

  document.addEventListener("hunt-result", (e) => {
    const c = cards.find((x) => x.item.token === e.detail.launch);
    if (!c) return;
    c.sticker.dataset.ink = "red";
    c.sticker.querySelector(".seal-kind").textContent = "Refused";
    c.sticker.children[1].textContent = "no bond";
    c.sticker.children[2].textContent = "contract said no";
    c.art.dataset.hunted = "refused";
  });

  fetch("data/verdicts.json").then((r) => r.json()).then((v) => {
    const picks = v.items
      .filter((x) => x.complete && x.buyers && x.buyers.length && !/pool|router/.test(x.buyers[0].wallet) && x.funded === 0 && x.creator_buys === 0 && /^[a-z0-9._-]+$/.test(x.token))
      .sort((a, b) => b.created_at_ms - a.created_at_ms)
      .slice(0, COUNT);
    picks.forEach((p) => cards.push(build(p)));
    poll();
    setInterval(poll, EVERY);
  }).catch(() => { if (clock) clock.textContent = "The traced launches did not load. Reload to read them again."; });
})();
