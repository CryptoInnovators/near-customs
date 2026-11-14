"use strict";
/* Chain reads and the hunt for the launchpad. Mainnet reads (launch trades, openers, the Rhea pool) are read only; the hunt runs on testnet:
   POST /stamp/break files through the hunter's function-call key, then the stamp contract's challenge_of is polled until the checker's verdict lands. */
(() => {
  const L = window.LPLib;
  const LAUNCH = "customs26-token.testnet";
  const SLOTS = ["customs28-stamp.testnet", "customs29-stamp.testnet", "customs30-stamp.testnet", "customs31-stamp.testnet", "customs32-stamp.testnet", "customs33-stamp.testnet", "customs34-stamp.testnet", "customs35-stamp.testnet", "customs36-stamp.testnet", "customs37-stamp.testnet", "customs38-stamp.testnet", "customs39-stamp.testnet", "customs40-stamp.testnet", "customs41-stamp.testnet", "customs42-stamp.testnet", "customs43-stamp.testnet", "customs44-stamp.testnet", "customs45-stamp.testnet"];
  const FUNDED = { wallet: "customs26-buyer1.testnet", path: ["23atwS3gdX11c1r7o3UBZK1w7UAuskk7VofmoaZiP5HU", "75sREratSM2pa3iGJBx61hbwPSx3Wfa8bseN3g6CmR2T"] };
  const CLEAN = { wallet: "customs26-buyer2.testnet", path: ["23atwS3gdX11c1r7o3UBZK1w7UAuskk7VofmoaZiP5HU", "GuTXDmdNSsSosDHgjHJLLxgQH1VwXR1Z5jSfxy1TThV5"] };
  const ACCOUNT = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
  const WNEAR = "wrap.near", REF = "v2.ref-finance.near";
  const LATE_BLOCKS_S = 1200; /* the stamp accepts a late enclave answer for 1200 blocks, about 20 minutes */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hunterOf = (contract) => contract.replace("-stamp.", "-hunter.");

  async function getJSON(url, body, tries = 4) {
    for (let i = 0; i < tries; i++) {
      const shared = /^\/fastnear\//.test(url) && window.FastnearLimiter;
      if (shared) await window.FastnearLimiter.take();
      const r = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
      if (shared) window.FastnearLimiter.response(r.status);
      if (r.ok) return r.json();
      if (r.status !== 429 && r.status < 500) { const e = Error("HTTP " + r.status); e.status = r.status; throw e; }
      if (i < tries - 1) await sleep(600 * 2 ** i);
    }
    throw Error("The read did not complete");
  }
  const mainTx = (path, body) => getJSON("/fastnear/tx-main" + path, body);
  const query = (account, method, args) => ({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args || {})) } });
  let lastBlock = 0;
  const decode = (j) => (j.result.result.length ? JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) : null);
  async function mainView(account, method, args) {
    const j = await getJSON("/fastnear/rpc-main", query(account, method, args));
    if (!j.result) throw Error("view failed");
    return decode(j);
  }
  /* testnet reads: a contract error is final, a transport error is retried */
  async function testView(contract, method, args) {
    let last;
    for (let i = 0; i < 4; i++) {
      try {
        const res = await fetch("/fastnear/drpc-test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(query(contract, method, args)) });
        const j = await res.json();
        if (j.error) { const e = Error(JSON.stringify(j.error).slice(0, 120)); e.final = /HANDLER_ERROR|ExecutionError|CodeDoesNotExist/.test(JSON.stringify(j.error)); throw e; }
        if (j.result.error) throw Object.assign(Error(String(j.result.error).slice(0, 120)), { final: true });
        lastBlock = j.result.block_height || lastBlock;
        return decode(j);
      } catch (e) { last = e; if (e.final) break; await sleep(1200 * (i + 1)); }
    }
    throw last;
  }

  /* the opening-buyer check on real deposits: a depositor is creator-funded when one of its first three transactions is signed by the creator */
  async function traceOne(owner, account) {
    const list = await mainTx("/v0/account", { account_id: account, limit: 3, desc: false });
    const hashes = [...new Set((list.account_txs || []).map((t) => t.transaction_hash))];
    if (!hashes.length) return { account, funded: null, seen: 0 };
    const txs = await mainTx("/v0/transactions", { tx_hashes: hashes });
    const byCreator = (txs.transactions || []).map((t) => t.transaction).filter((t) => t && t.signer_id === owner);
    return { account, funded: byCreator.length ? byCreator[0].hash : null, seen: hashes.length };
  }

  async function readPool(poolId) {
    const p = await mainView(REF, "get_pool", { pool_id: poolId });
    return p;
  }

  /* every stamp slot on $CUSTOMS: its state, and for a standing one the hunter's prepaid credit */
  let need = null, filing = null;
  async function readStamps() {
    if (need === null) {
      const p = await testView(SLOTS[0], "stamp_params", {}).catch(() => null);
      need = p ? BigInt(p.min_bond) + BigInt(p.exec_fee) : 0n;
      filing = p ? BigInt(p.min_bond) : 0n;
    }
    const all = await Promise.all(SLOTS.map(async (contract) => {
      const stamp = await testView(contract, "stamp_of", { launch: LAUNCH }).catch(() => null);
      const credit = stamp && stamp.state === "Standing" ? await testView(contract, "credit_of", { account: hunterOf(contract) }).then(BigInt).catch(() => 0n) : 0n;
      return { contract, stamp, credit };
    }));
    const live = all.filter((s) => s.stamp);
    const standing = live.filter((s) => s.stamp.state === "Standing");
    const broken = live.filter((s) => s.stamp.state && s.stamp.state.Broken);
    const bond = standing.reduce((a, s) => a + L.nearNum(s.stamp.bond), 0);
    const paid = broken.reduce((a, s) => a + L.nearNum(s.stamp.state.Broken.paid), 0);
    const best = pickSlot(live, standing, null);
    return { all, live, standing, broken, bond, paid, filing: Number(filing) / 1e24, need, best, failed: !live.length };
  }
  /* a hunt is filed from the hunter's prepaid credit: the newest standing stamp whose hunter can still pay and has no open challenge */
  function pickSlot(live, standing, used) {
    const newest = [...standing].reverse(), funded = newest.filter((s) => s.credit >= need);
    return funded.find((s) => s.stamp.open === 0) || funded[0] || newest.find((s) => s.stamp.open === 0) || newest[0] || live.find((s) => s.contract === used) || live[live.length - 1] || null;
  }

  /* what the hunter key can do, read from the chain: the permission the pitch rests on */
  async function readHunterKey(contract) {
    const account = hunterOf(contract);
    const res = await fetch("/fastnear/drpc-test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_access_key_list", finality: "final", account_id: account } }) });
    const keys = (await res.json()).result.keys;
    const fc = keys.map((k) => k.access_key.permission.FunctionCall).filter(Boolean).find((p) => p.receiver_id === contract);
    return { account, methods: fc ? fc.method_names : [], full: keys.some((k) => k.access_key.permission === "FullAccess") };
  }

  /* each paid hunt on a Broken stamp: who proved which wallet, read from stamp_of then challenge_of */
  async function readPaidHunts(brokenSlots) {
    const out = await Promise.all(brokenSlots.map(async (s) => {
      const b = s.stamp.state.Broken;
      const ch = await testView(s.contract, "challenge_of", { challenge_id: b.challenge_id }).catch(() => null);
      return { slot: Number((s.contract.match(/customs(\d+)/) || [])[1]), contract: s.contract, hunter: b.prover, wallet: b.wallet, paid: L.nearNum(b.paid), challenge_id: b.challenge_id, payout_to: ch ? ch.payout_to : b.prover, block: ch ? ch.created_block : 0, creator: s.stamp.creator };
    }));
    return out.sort((a, b) => b.block - a.block);
  }

  const payoutOk = (v) => !v || (v.length <= 64 && ACCOUNT.test(v));

  async function postBreak(body) {
    const res = await fetch("/stamp/break", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(50000) });
    let j = {};
    try { j = await res.json(); } catch { /* reported by status */ }
    return { status: res.status, retry: Number(res.headers.get("retry-after")) || 0, body: j };
  }

  /* nothing standing: the creator account posts the next spare bond through the worker */
  async function arm() {
    const res = await fetch("/stamp/arm", { method: "POST", signal: AbortSignal.timeout(50000) });
    let j = {};
    try { j = await res.json(); } catch { /* reported by status */ }
    return { status: res.status, retry: Number(res.headers.get("retry-after")) || 0, body: j };
  }

  async function postRelay(body) {
    const res = await fetch("/stamp/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    let j = {};
    try { j = await res.json(); } catch { /* reported by status */ }
    return { status: res.status, body: j };
  }

  /* The hunt. kind "funded" files the creator-funded buyer; "clean" files a clean buyer (the checker rejects it).
     emit(state) is called on every change: phase filing, checking, late, paid, rejected, refused, busy, unavailable, unanswered, timeout, error. */
  let busy = false;
  async function hunt(kind, { payout, stamps, emit }) {
    if (busy) return null;
    busy = true; window.CustomsHunting = true;
    const t0 = Date.now();
    const target = kind === "clean" ? CLEAN : FUNDED;
    const st = { kind, t0, wallet: target.wallet, phase: "filing" };
    const out = (patch) => { Object.assign(st, patch); emit({ ...st }); };
    try {
      out({});
      let info = stamps;
      /* another visitor may have spent this hunter's credit since the page loaded: re-pick before filing */
      const cur = info && info.best;
      if (!cur || (await testView(cur.contract, "credit_of", { account: hunterOf(cur.contract) }).then(BigInt).catch(() => need)) < need) info = await readStamps();
      const slot = info.best && info.best.stamp && info.best.stamp.state === "Standing" ? info.best : null;
      if (!slot) { out({ phase: "unavailable", text: "No funded stamp right now." }); return st; }
      out({ stamp: slot.contract, hunter: hunterOf(slot.contract), bond: L.nearNum(slot.stamp.bond) });
      let r = await postBreak({ stamp: slot.contract, launch: LAUNCH, wallet: target.wallet, path: target.path, payout_to: payout || undefined });
      /* the filing key takes one filing at a time: a second visitor waits its turn (up to 3 tries) instead of being turned away */
      for (let tries = 0; r.status === 429 && r.retry && r.retry <= 20 && tries < 3; tries++) {
        out({ wait: r.retry });
        await new Promise((ok) => setTimeout(ok, (r.retry + 1) * 1000));
        out({ wait: 0 });
        r = await postBreak({ stamp: slot.contract, launch: LAUNCH, wallet: target.wallet, path: target.path, payout_to: payout || undefined });
      }
      if (r.status === 429) { out({ phase: "busy", retry: r.retry || 20, text: "Another visitor is hunting. Free again in " + (r.retry || 20) + " s." }); return st; }
      if (r.status === 503) { out({ phase: "unavailable", text: "No funded stamp right now." }); return st; }
      if (r.status !== 200) { out({ phase: "error", text: (r.body && r.body.error) || "The filing did not complete (HTTP " + r.status + ")." }); return st; }
      const f = r.body;
      if (f.status === "refused") { out({ phase: "refused", tx: f.tx, text: "Refused by the contract: " + String(f.reason || "").replace(/^stamp: /, "").replace(/^./, (c) => c.toLowerCase()) + "." }); return st; }
      const filedS = Math.round((Date.now() - t0) / 1000);
      out({ phase: "checking", tx: f.tx, challenge: f.challenge_id, filedS });
      let ch = null, relay = null, relayAt = 0, relayTx = null;
      const tick = setInterval(() => emit({ ...st, secs: Math.floor((Date.now() - t0) / 1000) }), 1000);
      try {
        /* OutLayer's worker queue can answer after the 200 block yield window: the stamp then reads Unanswered and the enclave's signed answer
           is delivered through /stamp/relay, which the contract verifies against the pinned key before it moves anything. */
        const budgetMs = (LATE_BLOCKS_S + 120) * 1000;
        while (Date.now() - t0 < budgetMs) {
          /* the first minute is the fast path; after it the page reads the chain every 10 s, the cap the shared worker budget allows */
          await sleep(Date.now() - t0 < 60000 ? 5000 : 10000);
          ch = await testView(f.stamp, "challenge_of", { challenge_id: f.challenge_id }).catch(() => null);
          const name = ch ? (typeof ch.state === "string" ? ch.state : Object.keys(ch.state)[0]) : "Pending";
          if (name === "Pending") continue;
          if (name !== "Unanswered" || (relay && ["closed", "refused"].includes(relay.status))) break;
          if (st.phase !== "late") out({ phase: "late", tx: f.tx, challenge: f.challenge_id, filedS });
          if (Date.now() - relayAt >= 8000) {
            relayAt = Date.now();
            relay = (await postRelay({ stamp: f.stamp, challenge_id: f.challenge_id }).catch(() => ({ body: {} }))).body;
            if (relay.status === "relayed") relayTx = relay.tx;
          }
        }
      } finally { clearInterval(tick); }
      const secs = Math.round((Date.now() - t0) / 1000);
      const state = ch ? (typeof ch.state === "string" ? ch.state : Object.keys(ch.state)[0]) : "Pending";
      const after = await testView(f.stamp, "stamp_of", { launch: LAUNCH }).catch(() => null);
      const paid = after && after.state && after.state.Broken ? after.state.Broken.paid : null;
      if (state === "Upheld" && paid) out({ phase: "paid", secs, paid: L.nearNum(paid), who: ch.payout_to, relayTx });
      else if (state === "Rejected") out({ phase: "rejected", secs, filingBond: L.nearNum(ch.bond), relayTx });
      else if (state === "Unanswered") out({ phase: "unanswered", secs });
      else out({ phase: "timeout", secs });
      return st;
    } catch (e) {
      out({ phase: "error", text: e && e.name === "TimeoutError" ? "The chain did not confirm the filing within 50 s." : "The filing could not be sent: " + String(e.message || e).slice(0, 120) + "." });
      return st;
    } finally { busy = false; window.CustomsHunting = false; }
  }

  window.LPChain = { LAUNCH, SLOTS, FUNDED, CLEAN, getJSON, mainTx, mainView, testView, traceOne, readPool, readStamps, pickSlot, readHunterKey, readPaidHunts, payoutOk, arm, hunt, hunterOf, sleep, WNEAR, isBusy: () => busy, lastBlock: () => lastBlock };
})();
