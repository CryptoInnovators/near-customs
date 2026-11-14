"use strict";
/* Pure helpers for the launchpad board: amounts, ages, the insider fact read from a launch's trades, the raise chart series.
   No DOM and no network, so web/test/lp-lib.test.mjs can run every rule against real-shaped trades. */
(() => {
  const Y = 10n ** 24n;
  const yocto = (v) => { try { return BigInt(v == null || v === "" ? "0" : v); } catch { return 0n; } };
  const nearNum = (v) => Number(yocto(v) / 10n ** 18n) / 1e6;
  const num = (n) => {
    if (n >= 100) return n.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    if (n >= 1) return n.toFixed(2);
    if (n >= 0.01) return n.toFixed(3);
    if (n === 0) return "0";
    return n.toPrecision(2);
  };
  const near = (v) => num(nearNum(v));
  /* an account name is never cut mid-word: only a 64-hex implicit account or a name over 40 characters is abbreviated */
  const short = (a) => (/^[0-9a-f]{64}$/.test(a) || a.length > 40 ? a.slice(0, 8) + "…" + a.slice(-8) : a);
  const shortTx = (t) => t.slice(0, 6) + "…" + t.slice(-4);
  const age = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d >= 2) return d + "d ago";
    if (d) return d + "d " + h + "h ago";
    if (h) return h + "h " + String(m).padStart(2, "0") + "m ago";
    return m + "m " + String(s % 60).padStart(2, "0") + "s ago";
  };
  const left = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? d + "d " + h + "h left" : h ? h + "h " + m + "m left" : m + "m left";
  };
  const clock = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

  /* distinct depositors in order of their first deposit, with each account's net (deposits minus withdrawals) */
  function accountsOf(t) {
    const order = [], net = new Map(), first = new Map();
    for (const d of t.deposits || []) {
      if (!net.has(d.account)) { order.push(d.account); net.set(d.account, 0n); first.set(d.account, d); }
      net.set(d.account, net.get(d.account) + yocto(d.amount));
    }
    for (const w of t.withdrawals || []) if (net.has(w.account)) net.set(w.account, net.get(w.account) - yocto(w.amount));
    return { order, net, first };
  }
  const pct = (part, whole) => (whole > 0n ? Number((part * 1000n) / whole) / 10 : 0);

  /* One concrete fact about who is in a raise, no click needed. First match wins:
     the creator's own account among the openers, the creator's own deposit, a wallet holding a large share, the first depositor. */
  function insiderFact(owner, t) {
    const { order, net, first } = accountsOf(t);
    if (!order.length) return { text: "No deposit yet", acct: null };
    let total = 0n;
    for (const v of net.values()) total += v > 0n ? v : 0n;
    const n = order.indexOf(owner) + 1;
    const own = net.get(owner) || 0n;
    if (n && own > 0n) {
      if (n <= 6) return { text: "Creator's own account is opener " + n + ", " + num(nearNum(own)) + " N, " + Math.round(pct(own, total)) + "% of the raise", acct: null, own: true };
      return { text: "Creator deposited " + num(nearNum(own)) + " N into its own raise", acct: null, own: true };
    }
    let top = order[0];
    for (const a of order) if (net.get(a) > net.get(top)) top = a;
    const share = pct(net.get(top), total);
    if (share >= 15) return { text: "Top wallet {acct} holds " + Math.round(share) + "% of the raise", acct: top };
    return { text: "First in: {acct}, " + num(nearNum(first.get(order[0]).amount)) + " N", acct: order[0] };
  }

  /* the first `n` distinct non-creator wallets to deposit, with their first deposit: the wallets Customs traces */
  function openers(owner, t, n) {
    const seen = new Set([owner]), out = [];
    for (const d of t.deposits || []) { if (seen.has(d.account)) continue; seen.add(d.account); out.push(d); if (out.length === n) break; }
    return out;
  }

  /* raise-chart series: cumulative net NEAR over time, one point per deposit or withdrawal */
  function raiseSeries(t) {
    const ev = [...(t.deposits || []).map((d) => ({ ...d, sign: 1n })), ...(t.withdrawals || []).map((d) => ({ ...d, sign: -1n }))].sort((a, b) => a.ts - b.ts);
    let sum = 0n;
    return ev.map((e) => { sum += e.sign * yocto(e.amount); return { ts: e.ts, y: nearNum(sum.toString()), account: e.account, deposit: e.sign > 0n, receipt: e.receipt }; });
  }

  function meterCells(raised, cap, cells = 20) {
    if (!(cap > 0)) return 0;
    const f = Math.min(1, raised / cap);
    return raised > 0 ? Math.max(1, Math.round(f * cells)) : 0;
  }

  /* price of one token in wNEAR from a Ref pool: both sides scaled to whole units */
  function rheaPrice(pool, wnear, tokenDecimals) {
    const w = pool.token_account_ids.indexOf(wnear);
    if (w < 0) return null;
    const t = 1 - w;
    const wAmt = Number(yocto(pool.amounts[w]) / 10n ** 18n) / 1e6;
    const tAmt = Number(yocto(pool.amounts[t])) / 10 ** (tokenDecimals || 18);
    if (!(tAmt > 0)) return null;
    return { price: wAmt / tAmt, wnear: wAmt, tokens: tAmt };
  }

  const status = (l, now) => (l.pool_id ? "cooked" : l.end_ms && l.end_ms > now ? "cooking" : "spoiled");

  /* The headline count is a verdict. It is stated only when every launch on the board has been traced: a partial trace reads "tracing n of m". */
  function traceHeadline(launches) {
    const total = launches.length, read = launches.filter((l) => l.fact), n = read.length;
    if (total === 0 || n < total) return { settled: false, n, total, own: 0 };
    return { settled: true, n, total, own: read.filter((l) => l.fact.own).length };
  }

  const api = { traceHeadline, yocto, nearNum, num, near, short, shortTx, age, left, clock, accountsOf, insiderFact, openers, raiseSeries, meterCells, rheaPrice, status, Y };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.LPLib = api;
})();
