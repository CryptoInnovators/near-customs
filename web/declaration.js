"use strict";

/* The Declaration route: reads one Customs coin and fills the form as each read resolves.
   Pure reads and checks live in customs.js; the helpers (esc, stampHtml, refHtml, ...) in ui.js. */

(function declaration() {
  const query = new URLSearchParams(location.search);
  const net = query.get("network") === "mainnet" ? "mainnet" : "testnet";
  const token = (query.get("coin") || LIVE_TESTNET_COIN).trim().toLowerCase();
  const pub = PUBLISHED[net];
  const DEC = 24;
  const $ = (id) => document.getElementById(id);
  const sheet = $("sheet");
  const NETLABEL = "NEAR " + net.toUpperCase();
  let lastLand = -1000;

  /* a stamp never lands sooner than 140 ms after the previous one */
  function nextDelay() {
    const now = performance.now();
    const at = Math.max(now, lastLand + 140);
    lastLand = at;
    return Math.round(at - now);
  }

  const setBox = (key, html, prov) => {
    const box = document.querySelector('[data-box="' + key + '"]');
    if (!box) return;
    const val = box.querySelector(".val");
    val.classList.remove("blank");
    val.innerHTML = html;
    if (prov) box.querySelector(".prov").textContent = prov;
  };
  const boxNum = (text) => '<span class="numeral">' + esc(text) + "</span>";
  const blk = (n) => (n ? "block " + group(String(n)) : "block read");

  /* ---- the consignee is known from the address, before any read */
  const consignee = $("consignee");
  consignee.textContent = token;
  consignee.href = pub.explorer + "/address/" + encodeURIComponent(token);
  consignee.title = token;
  $("consignee-copy").dataset.copy = token;
  $("examine-net").value = net;
  $("lede").textContent = "Reading " + token + " on " + NETLABEL + ".";
  chainStrip(net, pub.rpc);
  wireCopy(document);
  document.title = token + " | Declaration of opening bags | Customs";

  /* ---- stage handlers */
  function onParams({ params: p }) {
    const vest = p.vest_s % 3600 === 0 ? p.vest_s / 3600 + " hour" : p.vest_s + " second";
    const lede = $("lede");
    lede.classList.remove("busy");
    lede.textContent = "This coin holds every opening buyer to a " + vest + " vest. A published judge on OutLayer decides who the creator paid.";
    setBox("creator", '<span class="key">' + refHtml("account", p.creator_id, net) + "</span>");
    setBox("market", refHtml("account", p.market_id, net));
    setBox("judge", refHtml("account", p.outlayer_id, net));
    setBox("seize", boxNum(p.seize_bps / 100 + "%"), "of the unvested bag, rest frozen " + Math.round(p.lock_s / 86400) + " days");
    const bond = amountParts(p.min_bond, DEC);
    setBox("bond", boxNum(bond.amount + " NEAR"), "call_function customs_params, exec fee " + amountParts(p.exec_fee, DEC).amount + " NEAR on top");
  }

  function onWindow({ win }) {
    setBox("opens", '<span class="key">' + esc(utc(win.start_s)) + "</span>");
    setBox("closes", '<span class="key">' + esc(utc(win.opening_ends_s)) + "</span>");
    setBox("vest", '<span class="key">' + esc(utc(win.vest_ends_s)) + "</span>");
  }

  function checkValue(c) {
    switch (c.id) {
      case "judge": return c.value;
      case "checker": return shorten(c.value, 8, 8);
      case "verdict_key": return typeof c.value === "string" && c.value ? shorten(c.value, 12, 5) : "not pinned";
      default: return c.value + (c.value === 1 ? " access key" : " access keys");
    }
  }

  function onCheck(c) {
    const el = document.querySelector('[data-check="' + c.id + '"]');
    if (!el) return;
    const state = c.ok === true ? "pass" : c.ok === false ? "fail" : "unread";
    const d = nextDelay();
    el.dataset.state = state;
    el.style.setProperty("--d", d + "ms");
    el.querySelector(".stamp-zone").innerHTML = stampHtml(state, blk(c.readBlock), { delay: d });
    const val = el.querySelector(".val");
    val.classList.remove("blank");
    val.textContent = checkValue(c);
    el.querySelector(".txt").textContent = c.text;
  }

  /* ---- bags */
  function noticeFor(wallet, challenges) {
    return challenges.find((c) => c.wallet === wallet && c.kind === "upheld") || challenges.find((c) => c.wallet === wallet);
  }

  const noticeLink = (n) => '<a href="#notice-' + n.id + '">N° ' + n.id + "</a> " + esc(n.title);
  function fillNoticeCells(challenges) {
    document.querySelectorAll("[data-notice-cell]").forEach((td) => {
      const n = noticeFor(td.dataset.noticeCell, challenges);
      td.innerHTML = n ? noticeLink(n) : "none";
    });
  }

  function renderBags(buyers, challenges, win) {
    const meta = $("bags-meta");
    const body = $("bags-body");
    if (!buyers.length) {
      meta.textContent = "0 lines";
      body.innerHTML = '<p class="empty-line">The market paid no wallets inside the opening window, ' + esc(utc(win.start_s)) + " to " + esc(utc(win.opening_ends_s)) + ".</p>";
      return;
    }
    const bought = buyers.reduce((s, b) => s + BigInt(b.opening.bought), 0n);
    const locked = buyers.reduce((s, b) => s + BigInt(b.opening.locked), 0n);
    meta.textContent = buyers.length + (buyers.length === 1 ? " line" : " lines") + ". Bought " + amountParts(bought, DEC).amount + ". Locked now " + amountParts(locked, DEC).amount + ".";
    const nowS = Date.now() / 1000;
    const rows = buyers.map((b, i) => {
      const o = b.opening;
      const st = bagState(o);
      const boughtP = amountParts(o.bought, DEC);
      const lockedP = amountParts(o.locked, DEC);
      const left = countdown(o.unlock_s, nowS);
      const n = noticeFor(b.wallet, challenges);
      const unlock = left
        ? '<span class="tok"><time data-until="' + o.unlock_s + '">' + esc(left) + '</time></span><span class="raw">' + esc(utc(o.unlock_s)) + "</span>"
        : '<span class="tok">Released</span><span class="raw">' + esc(utc(o.unlock_s)) + "</span>";
      const stamp = stampHtml(st.kind, st.sub, { view: st.kind === "seized", delay: Math.min(i, 12) * 45 + 220 });
      return '<tr class="line print-line" style="--i:' + Math.min(i, 12) + '" data-row data-bag="' + esc(o.state) + '">' +
        '<td class="n" data-label="No.">' + String(i + 1).padStart(2, "0") + "</td>" +
        '<td class="wallet-cell" data-label="Consignee wallet" data-wallet>' + refHtml("account", b.wallet, net) + "</td>" +
        '<td class="r" data-col="a" data-label="Bought"><span class="tok">' + esc(boughtP.amount) + '</span><span class="raw">' + esc(boughtP.raw) + "</span></td>" +
        '<td class="r" data-col="b" data-label="Locked now"><span class="tok">' + esc(lockedP.amount) + '</span><span class="raw">' + esc(lockedP.raw) + "</span></td>" +
        '<td data-col="c" data-label="Unlocks">' + unlock + "</td>" +
        '<td data-col="d" data-label="Notice" data-notice-cell="' + esc(b.wallet) + '">' + (n ? noticeLink(n) : "reading") + "</td>" +
        '<td class="stateCell" data-label="State">' + stamp + "</td></tr>";
    }).join("");
    body.innerHTML = '<table class="ledger"><thead><tr><th class="r">No.</th><th>Consignee wallet</th><th class="r">Bought</th><th class="r">Locked now</th><th>Unlocks</th><th>Notice</th><th>State</th></tr></thead><tbody>' + rows + "</tbody></table>";
    watchStamps(body);
  }

  function renderNotices(challenges) {
    const meta = $("notices-meta");
    const body = $("notices-body");
    if (!challenges.length) {
      meta.textContent = "0 notices";
      body.innerHTML = '<p class="empty-line">No challenge has been filed against this coin.</p>';
      return;
    }
    meta.textContent = challenges.length + (challenges.length === 1 ? " notice" : " notices");
    const slips = challenges.map((c) => {
      const bond = amountParts(c.bond, DEC);
      const seized = c.seized ? amountParts(c.seized, DEC) : null;
      const verdictLine = c.verdictTx && c.verdictTx !== c.filedTx
        ? "<dt>Verdict tx</dt><dd>" + refHtml("tx", c.verdictTx, net) + "</dd>" : "";
      const stamp = c.kind === "pending"
        ? '<span class="at">At OutLayer, filed at block ' + group(String(c.createdBlock || "")) + "</span>"
        : stampHtml(c.kind, c.title === "Upheld" ? "wallet seized" : c.title === "Rejected" ? "bond forfeited" : "no verdict", { view: true });
      return '<article class="slip" id="notice-' + c.id + '" data-notice data-state="' + esc(c.title) + '">' +
        '<div class="perf" aria-hidden="true"></div>' +
        '<div class="slip-top"><h3 class="serial">N° ' + c.id + '</h3><span class="sched-meta">filed at block ' + group(String(c.createdBlock || "")) + "</span></div>" +
        "<dl><dt>Wallet</dt><dd>" + refHtml("account", c.wallet, net) + "</dd>" +
        "<dt>Challenger</dt><dd>" + refHtml("account", c.challenger, net) + "</dd>" +
        "<dt>Bond</dt><dd>" + esc(bond.amount) + ' NEAR<span class="raw">' + esc(bond.raw) + "</span></dd>" +
        (seized ? "<dt>Seized to challenger</dt><dd><b>" + esc(seized.amount) + '</b><span class="raw">' + esc(seized.raw) + "</span></dd>" : "") +
        "<dt>" + (verdictLine ? "Filing tx" : "Filing and verdict tx") + "</dt><dd>" + (c.filedTx ? refHtml("tx", c.filedTx, net) : "not in the read") + "</dd>" +
        verdictLine + "</dl>" +
        '<div class="stamp-zone">' + stamp + "</div></article>";
    }).join("");
    body.innerHTML = '<div class="cells">' + slips + "</div>";
    watchStamps(body);
  }

  function onLatest({ latest }) {
    const box = $("latest");
    const val = $("latest-val");
    if (!latest) {
      val.className = "val";
      val.textContent = "no transaction in the read";
      return;
    }
    val.className = "val";
    val.innerHTML = '<span class="ref"><a data-latest-tx data-full="' + esc(latest.hash) + '" title="' + esc(latest.hash) + '" href="' + pub.explorer + "/txns/" + encodeURIComponent(latest.hash) + '">' + esc(shorten(latest.hash)) + "</a>" +
      '<button type="button" class="copy" data-copy="' + esc(latest.hash) + '" aria-label="Copy the transaction hash"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5.5 5.5h7v8h-7zM3.5 10.5v-8h7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button></span>';
    val.classList.add("key");
    $("latest-prov").innerHTML = '<span class="entry-sub"><span class="seal" aria-label="succeeded"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="#fff" stroke-width="2.2"/></svg></span><span>block ' + group(String(latest.height)) + ", " + esc(utc(latest.tsS)) + ", by " + esc(shortAccount(latest.signer)) + "</span></span>";
    box.dataset.state = "read";
  }

  function fillFoot(m) {
    const host = (u) => { try { return new URL(u).host; } catch { return u; } };
    $("read-from").innerHTML = "<dt>Account state</dt><dd>" + esc(host(pub.rpc[0])) + "</dd><dt>Receipts</dt><dd>" + esc(host(pub.txApi)) + "</dd>" +
      (m && m.params ? "<dt>Checker bytes</dt><dd>" + esc(host(m.params.module_url)) + "</dd>" : "");
    $("published").innerHTML = "<dt>Judge</dt><dd>" + esc(pub.outlayer) + "</dd><dt>Checker sha256</dt><dd>" + esc(pub.checker) + "</dd>";
    $("close-lines").innerHTML = "Reads: " + esc(host(pub.rpc[0])) + ", " + esc(host(pub.txApi)) + " on NEAR " + esc(net) + "<br>" +
      '<a href="https://github.com/CryptoInnovators/near-customs">Source</a> / <a href="' + pub.explorer + '">NEAR Blocks</a>';
  }

  function tickCountdowns() {
    const nowS = Date.now() / 1000;
    document.querySelectorAll("time[data-until]").forEach((t) => {
      const left = countdown(t.dataset.until, nowS);
      if (left) t.textContent = left;
    });
  }
  setInterval(tickCountdowns, 60000);

  /* ---- a token that is not a Customs token: the form comes back blank and returned */
  function renderReturned(m) {
    document.body.style.setProperty("--field-delay", "220ms");
    setField("red");
    $("lede").classList.remove("busy");
    $("lede").textContent = token + " does not answer customs_params on " + NETLABEL + ". Customs returns the declaration without a stamp.";
    document.querySelectorAll("[data-box] .val").forEach((v) => v.classList.add("blank"));
    const wrap = $("boxes-wrap");
    wrap.insertAdjacentHTML("beforeend", '<div class="returned-wrap" data-returned>' + stampHtml("returned", "not a customs token", {}) + "</div>");
    const reason = String(m.reason).replace(/\s+/g, " ");
    document.querySelectorAll("[data-check]").forEach((el) => {
      const id = el.dataset.check;
      el.querySelector(".val").classList.remove("blank");
      if (id === "judge") {
        el.dataset.state = "fail";
        el.querySelector(".stamp-zone").innerHTML = stampHtml("fail", blk(m.readBlock), { delay: nextDelay() });
        el.querySelector(".val").textContent = "no answer";
        el.querySelector(".txt").textContent = "customs_params on " + token + " answered: " + (reason.length > 150 ? reason.slice(0, 150) + "…" : reason);
      } else {
        el.dataset.state = "unread";
        el.querySelector(".val").textContent = "not read";
        el.querySelector(".txt").textContent = "There is no pinned value to compare this against.";
      }
    });
    $("bags-meta").textContent = "0 lines";
    $("bags-body").innerHTML = '<p class="empty-line">' + esc(token) + " has no opening bags to list.</p>";
    $("notices-meta").textContent = "0 notices";
    $("notices-body").innerHTML = '<p class="empty-line">' + esc(token) + " has no notices of seizure.</p>";
    fillFoot(null);
  }

  /* ---- run */
  const io = browserIo(net);
  let buyersLoaded = [];
  loadCoin(io, net, token, (stage, p) => {
    if (stage === "params") onParams(p);
    else if (stage === "window") onWindow(p);
    else if (stage === "check") onCheck(p);
    else if (stage === "latest") onLatest(p);
    else if (stage === "bags") { buyersLoaded = p.buyers; renderBags(p.buyers, [], p.win); }
    else if (stage === "notices") { renderNotices(p.challenges); fillNoticeCells(p.challenges); }
  }).then((m) => {
    if (m.kind === "not_customs") renderReturned(m);
    else {
      setField(m.checks.some((c) => c.ok === false) ? "red" : "green");
      fillFoot(m);
    }
  }).catch((err) => {
    $("lede").classList.remove("busy");
    $("lede").textContent = "The read of " + token + " stopped at the first failed call.";
    $("bags-body").innerHTML = '<div class="err-panel" data-error><code>' + esc(err && err.message || err) + "</code>Reload the page to read the coin again.</div>";
    fillFoot(null);
  }).finally(() => {
    sheet.removeAttribute("aria-busy");
    document.querySelectorAll(".busy").forEach((e) => e.classList.remove("busy"));
  });
})();
