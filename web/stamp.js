"use strict";
/* The stamp screen: two launches, one carrying a bond and one carrying nothing. "Break this stamp" asks the worker to file the
   funding path Customs already walked, through a sponsored key; the stamp contract, the OutLayer enclave and the pinned checker
   decide. Every figure and state on this screen is read from the stamp contract; the result is polled until the contract says so. */
(() => {
  const LAUNCH = "customs26-token.testnet";
  const SLOTS = ["customs28-stamp.testnet", "customs29-stamp.testnet", "customs30-stamp.testnet"];
  const FUNDED = { wallet: "customs26-buyer1.testnet", path: ["23atwS3gdX11c1r7o3UBZK1w7UAuskk7VofmoaZiP5HU", "75sREratSM2pa3iGJBx61hbwPSx3Wfa8bseN3g6CmR2T"] };
  const CLEAN = { wallet: "customs26-buyer2.testnet", path: ["23atwS3gdX11c1r7o3UBZK1w7UAuskk7VofmoaZiP5HU", "GuTXDmdNSsSosDHgjHJLLxgQH1VwXR1Z5jSfxy1TThV5"] };
  const EXPLORER = "https://testnet.nearblocks.io/";
  const ACCOUNT = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
  const q = (s) => document.querySelector(s);
  const el = {
    card: q("#card-stamped"), seal: q("#seal"), amount: q("#seal-amount"), sealState: q("#seal-state"), facts: q("#stamped-facts"), path: q("#stamped-path"),
    go: q("#break-go"), clean: q("#break-clean"), bareGo: q("#bare-go"), bareName: q("#bare-name"), bareId: q("#bare-id"), bareFacts: q("#bare-facts"), barePath: q("#bare-path"),
    payout: q("#payout"), hint: q("#payout-hint"), steps: q("#stage-steps"),
  };
  if (!el.card) return;

  const near = (y) => { const n = Number(BigInt(y) / 10n ** 20n) / 1e4; return (n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")) + " NEAR"; };
  const a = (href, text) => { const x = document.createElement("a"); x.href = href; x.target = "_blank"; x.rel = "noreferrer"; x.textContent = text; return x; };
  const txLink = (hash, text) => a(EXPLORER + "txns/" + hash, text || "View the transaction");
  const short = (id) => (id.length > 26 ? id.slice(0, 12) + "…" + id.slice(-12) : id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function view(contract, method, args) {
    let last;
    for (let i = 0; i < 4; i++) {
      try {
        const res = await fetch("/fastnear/drpc-test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args || {})) } }) });
        const j = await res.json();
        if (j.error) { const e = Error(JSON.stringify(j.error).slice(0, 120)); e.final = /HANDLER_ERROR|ExecutionError|CodeDoesNotExist/.test(JSON.stringify(j.error)); throw e; }
        if (j.result.error) throw Object.assign(Error(String(j.result.error).slice(0, 120)), { final: true });
        return j.result.result.length ? JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) : null;
      } catch (e) { last = e; if (e.final) break; await sleep(1200 * (i + 1)); }
    }
    throw last;
  }

  /* the stamp to show: the first slot still standing with no open challenge, else any standing, else the one that was broken */
  let slot = null;
  async function readStamp() {
    const all = await Promise.all(SLOTS.map(async (contract) => ({ contract, stamp: await view(contract, "stamp_of", { launch: LAUNCH }).catch(() => null) })));
    const live = all.filter((s) => s.stamp);
    const standing = live.filter((s) => s.stamp.state === "Standing");
    slot = standing.find((s) => s.stamp.open === 0) || standing[0] || live[live.length - 1] || null;
    return { slot, standing: standing.length, total: live.length };
  }

  function paintStamp(info) {
    const s = info.slot && info.slot.stamp;
    el.seal.classList.remove("land"); void el.seal.offsetWidth; el.seal.classList.add("land");
    if (!s) {
      el.seal.dataset.ink = "grey"; el.amount.textContent = "None"; el.sealState.textContent = "not readable";
      el.facts.textContent = "The stamp contract did not answer. Reload to read it again.";
      el.go.disabled = true; el.clean.hidden = true;
      return;
    }
    const broken = typeof s.state === "object" && s.state.Broken;
    el.amount.textContent = near(broken ? broken.paid : s.bond);
    el.card.dataset.state = broken ? "broken" : s.state === "Standing" ? "standing" : "released";
    if (broken) {
      el.seal.dataset.ink = "red"; el.sealState.textContent = "broken";
      el.facts.replaceChildren(document.createTextNode("Broken. "), Object.assign(document.createElement("b"), { textContent: short(broken.prover) }), document.createTextNode(" proved " + short(broken.wallet) + " was funded by the creator and was paid " + near(broken.paid) + ". "), a(EXPLORER + "address/" + info.slot.contract, "Stamp contract"));
      el.go.hidden = true; el.clean.hidden = true;
    } else if (s.state === "Standing") {
      el.seal.dataset.ink = "green"; el.sealState.textContent = "standing";
      el.facts.replaceChildren(document.createTextNode("The creator staked "), Object.assign(document.createElement("b"), { textContent: near(s.bond) }), document.createTextNode(" that none of the 2 opening buyers was their money. " + info.standing + " of " + info.total + " stamps on this launch still stand."));
      el.go.hidden = false; el.clean.hidden = false; el.go.disabled = false;
    } else {
      el.seal.dataset.ink = "grey"; el.sealState.textContent = "released";
      el.facts.textContent = "The hold ended with no proof against it and the creator took the bond back.";
      el.go.hidden = true; el.clean.hidden = true;
    }
  }

  /* the funding path as nodes and labelled edges; the creator node is outlined hot, each edge links its transaction */
  function wbrCode(id) {
    const c = document.createElement("code");
    c.title = id;
    id.split(/(?<=[-.])/).forEach((seg, i) => { if (i) c.append(document.createElement("wbr")); c.append(seg); });
    return c;
  }
  function chain(parts) {
    const ol = document.createElement("div");
    ol.className = "chain";
    parts.forEach((p) => {
      const n = document.createElement(p.edge ? "a" : "div");
      if (p.edge) {
        n.className = "chain-edge"; n.href = p.tx.startsWith("http") ? p.tx : EXPLORER + "txns/" + p.tx; n.target = "_blank"; n.rel = "noopener";
        n.append(Object.assign(document.createElement("b"), { textContent: p.edge }), Object.assign(document.createElement("span"), { textContent: p.label }));
      } else {
        n.className = "chain-node" + (p.hot ? " hot" : "") + (p.dashed ? " dashed" : "");
        n.append(Object.assign(document.createElement("span"), { textContent: p.role }), wbrCode(p.id));
      }
      ol.append(n);
    });
    return ol;
  }

  function paintFundingPath(replay) {
    const funded = replay.buyers.find((b) => b.wallet === FUNDED.wallet);
    if (!funded || !funded.path.length) return;
    const hop = funded.path[0];
    const cap = q("#path-caption");
    if (cap) cap.replaceChildren(document.createTextNode("The stamp claims no creator money reached a buyer. The chain shows "), Object.assign(document.createElement("b"), { textContent: short(hop.from) }), document.createTextNode(" sent " + hop.near + " NEAR to "), Object.assign(document.createElement("b"), { textContent: short(funded.wallet) }), document.createTextNode(" before it bought. Break the stamp and the bond is yours."));
    el.path.replaceChildren(chain([
      { id: hop.from, role: "Creator", hot: true },
      { edge: hop.near + " NEAR", tx: hop.tx, label: "transfer" },
      { id: funded.wallet, role: "First buyer" },
      { edge: funded.near + " NEAR", tx: funded.first_tx, label: "buy" },
      { id: LAUNCH, role: "Launch" },
    ]));
  }

  /* the unstamped launch: a real mainnet launch whose opening buyers Customs has already traced, so there is a real first buyer to name */
  const proofHash = q("#proof-hash");
  if (proofHash) view(SLOTS[0], "stamp_params", {}).then((p) => { proofHash.textContent = "sha256 " + p.module_sha256.slice(0, 10) + "…" + p.module_sha256.slice(-8) + " pinned in the stamp contract"; }).catch(() => { proofHash.textContent = "pinned in the stamp contract"; });

  let bare = null;
  async function loadBare() {
    const v = await (await fetch("data/verdicts.json")).json();
    const pick = v.items.find((x) => x.complete && x.buyers && x.buyers.length && !/pool|router/.test(x.buyers[0].wallet) && x.funded === 0 && x.creator_buys === 0 && /^[a-z0-9._-]+$/.test(x.token));
    if (!pick) throw Error("no traced launch");
    bare = { launch: pick.token, wallet: pick.buyers[0].wallet, tx: pick.buyers[0].first_tx, name: pick.name };
    el.bareName.textContent = pick.name;
    el.bareId.textContent = pick.token;
    el.bareFacts.textContent = "Its creator posted no bond, so nothing backs the claim that its " + pick.opening_buyers + " opening " + (pick.opening_buyers === 1 ? "buyer was" : "buyers were") + " independent.";
    el.barePath.replaceChildren(chain([
      { id: pick.creator || "creator", role: "Creator", dashed: true, hot: false },
      { edge: "no bond", tx: "https://nearblocks.io/txns/" + pick.buyers[0].first_tx, label: "its first buy" },
      { id: pick.buyers[0].wallet, role: "First buyer" },
    ]));
  }

  /* ---------------------------------------------------------------- steps */
  function step(text, state, extra) {
    const li = document.createElement("li");
    li.dataset.state = state;
    li.append(text);
    if (extra) li.append(" ", extra);
    el.steps.append(li);
    return li;
  }
  const setState = (li, state) => { li.dataset.state = state; };

  function payoutTo() {
    const v = el.payout.value.trim();
    el.hint.hidden = true; el.payout.removeAttribute("aria-invalid");
    if (!v) return { ok: true, value: undefined };
    if (v.length > 64 || !ACCOUNT.test(v)) {
      el.hint.textContent = "That is not a NEAR account id. Use something like you.testnet, or leave it empty.";
      el.hint.hidden = false; el.payout.setAttribute("aria-invalid", "true");
      el.payout.focus();
      return { ok: false };
    }
    return { ok: true, value: v };
  }

  let busy = false;
  const buttons = () => [el.go, el.clean, el.bareGo];
  function lock(on) { busy = on; buttons().forEach((b) => { b.disabled = on; }); }

  async function postBreak(body) {
    const res = await fetch("/stamp/break", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(50000) });
    let j = {};
    try { j = await res.json(); } catch { /* a non-JSON failure is reported by its status below */ }
    return { status: res.status, retry: Number(res.headers.get("retry-after")) || 0, body: j };
  }

  function failed(li, kind, text) {
    setState(li, "error");
    const again = Object.assign(document.createElement("button"), { type: "button", className: "link-btn retry", textContent: "Try again" });
    again.addEventListener("click", () => { run(kind); });
    li.textContent = text + " ";
    li.append(again);
  }

  async function run(kind) {
    if (busy) return;
    const payout = payoutTo();
    if (!payout.ok) return;
    el.steps.replaceChildren();
    lock(true);
    el.steps.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const bareRun = kind === "bare";
    const target = bareRun ? { launch: bare.launch, wallet: bare.wallet, path: [bare.tx, bare.tx], label: bare.name } : { launch: LAUNCH, ...(kind === "clean" ? CLEAN : FUNDED), label: "Customs coin" };
    const stampContract = bareRun ? SLOTS[0] : slot && slot.contract;
    const filing = step("Filing the funding path against " + short(target.wallet) + "…", "run");
    const t0 = Date.now();
    try {
      const r = await postBreak({ stamp: stampContract, launch: target.launch, wallet: target.wallet, path: target.path, payout_to: payout.value });
      if (r.status === 429) {
        setState(filing, "error");
        const again = Object.assign(document.createElement("button"), { type: "button", className: "link-btn retry", textContent: "Try again" });
        again.addEventListener("click", () => { run(kind); });
        filing.textContent = "The sponsored key is filing for another visitor. It is free again in " + (r.retry || 20) + " s. ";
        filing.append(again);
        return;
      }
      if (r.status !== 200) {
        failed(filing, kind, (r.body && r.body.error) || "The filing did not complete (HTTP " + r.status + ").");
        return;
      }
      const f = r.body;
      if (f.status === "refused") {
        setState(filing, "refused");
        filing.textContent = (bareRun ? "Refused: " : "Refused by the contract: ") + f.reason.replace(/^stamp: /, "").replace(/^./, (c) => c.toUpperCase()) + ". ";
        filing.append(txLink(f.tx, "The refusal is on chain."));
        if (bareRun) step("Nothing moved. A launch with no stamp has no bond to take.", "done");
        return;
      }
      setState(filing, "done");
      filing.textContent = "Filed on chain as challenge " + f.challenge_id + ". ";
      filing.append(txLink(f.tx, "Filing transaction"));
      const wait = step("The pinned checker is replaying the path in an OutLayer enclave", "run");
      const clock = document.createElement("time"); wait.append(clock);
      const tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); clock.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }, 500);
      let ch = null;
      try {
        for (let i = 0; i < 180; i++) {
          await sleep(2000);
          ch = await view(f.stamp, "challenge_of", { challenge_id: f.challenge_id }).catch(() => null);
          if (ch && ch.state !== "Pending") break;
        }
      } finally { clearInterval(tick); }
      const secs = Math.round((Date.now() - t0) / 1000);
      const state = ch ? (typeof ch.state === "string" ? ch.state : Object.keys(ch.state)[0]) : "Pending";
      const who = ch ? ch.payout_to : "";
      const after = await view(f.stamp, "stamp_of", { launch: target.launch }).catch(() => null);
      const paid = after && typeof after.state === "object" && after.state.Broken ? after.state.Broken.paid : null;
      if (state === "Upheld" && paid) {
        setState(wait, "done"); wait.textContent = "The enclave signed its verdict and the contract verified the signature.";
        const up = step("Upheld. The stamp is broken and " + near(paid) + " moved to " + who + " in " + secs + " s.", "upheld", a(EXPLORER + "address/" + who, "See the account"));
        up.prepend(Object.assign(document.createElement("strong"), { className: "payoff", textContent: "+" + near(paid) }));
      } else if (state === "Rejected") {
        setState(wait, "done"); wait.textContent = "The enclave signed its verdict and the contract verified the signature.";
        step("Rejected. " + short(target.wallet) + " was not funded by the creator, so the stamp stands and the " + near(ch.bond) + " filing bond is forfeited (" + secs + " s).", "rejected");
      } else if (state === "Unanswered") {
        setState(wait, "error"); wait.textContent = "The checker could not read that path, so no verdict was applied and the filing bond can be reclaimed.";
      } else {
        setState(wait, "error"); wait.textContent = "No verdict yet after " + secs + " s. The challenge stays on chain; open the stamp contract to follow it.";
        wait.append(" ", a(EXPLORER + "address/" + f.stamp, "Stamp contract"));
      }
      const info = await readStamp().catch(() => null);
      if (info) paintStamp(info);
      el.steps.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {
      failed(filing, kind, e && e.name === "TimeoutError" ? "The chain did not confirm the filing within 50 s." : "The filing could not be sent: " + String(e.message || e).slice(0, 120) + ".");
    } finally { lock(false); if (el.card.dataset.state === "broken") { el.go.hidden = true; el.clean.hidden = true; } }
  }

  el.go.addEventListener("click", () => run("funded"));
  el.clean.addEventListener("click", () => run("clean"));
  el.bareGo.addEventListener("click", () => run("bare"));
  el.payout.addEventListener("input", () => { el.hint.hidden = true; el.payout.removeAttribute("aria-invalid"); });

  el.bareGo.disabled = true;
  Promise.all([
    readStamp().then(paintStamp).catch(() => paintStamp({ slot: null })),
    fetch("data/replay.json").then((r) => r.json()).then(paintFundingPath).catch(() => {}),
    loadBare().then(() => { el.bareGo.disabled = busy; }).catch(() => { el.bareName.textContent = "No launch loaded"; el.bareFacts.textContent = "The traced launches did not load. Reload to read them again."; }),
  ]);
})();
