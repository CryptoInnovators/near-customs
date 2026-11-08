"use strict";

if (typeof module === "undefined") globalThis.CustomsRule = {};

/* Funding edges read from a parsed FastNEAR transaction . Shared by the page and its tests. */

function events(log) {
  if (!log.startsWith("EVENT_JSON:")) return null;
  try {
    return JSON.parse(log.slice("EVENT_JSON:".length));
  } catch {
    return null;
  }
}

function edgesAll(tx) {
  const withdraws = [];
  for (const r of tx.receipts) {
    /* only a successful receipt received by intents.near can name an Intents withdrawal: any contract can print the same log line */
    if (r.recv !== "intents.near" || !r.ok) continue;
    for (const log of r.logs) {
      const e = events(log);
      if (!e || e.standard !== "dip4" || e.event !== "native_withdraw") continue;
      for (const d of (Array.isArray(e.data) ? e.data : [])) {
        withdraws.push({
          tx: tx.hash,
          from: String(d.account_id || ""),
          to: String(d.receiver_id || ""),
          yocto: BigInt(d.amount || 0),
          ts: r.ts,
          height: r.height,
          kind: "IntentsWithdraw",
        });
      }
    }
  }
  const out = withdraws.slice();
  for (const r of tx.receipts) {
    if (r.pred === "system") continue;
    for (const y of r.transfers) {
      if (r.pred === "intents.near" && withdraws.some((w) => w.to === r.recv)) continue;
      out.push({
        tx: tx.hash,
        from: r.pred,
        to: r.recv,
        yocto: y,
        ts: r.ts,
        height: r.height,
        kind: "Transfer",
      });
    }
  }
  return out;
}

function edgesInto(tx, account) {
  return edgesAll(tx).filter((e) => e.to === account);
}

function parseTx(raw) {
  const receipts = Array.isArray(raw.receipts) ? raw.receipts.map((r) => {
    const rc = r.receipt || {};
    const actions = (rc.receipt && rc.receipt.Action && rc.receipt.Action.actions) || [];
    const transfers = Array.isArray(actions)
      ? actions.map((a) => (a && a.Transfer ? a.Transfer.deposit : null)).filter(Boolean)
      : [];
    const status = r.execution_outcome && r.execution_outcome.outcome
      ? r.execution_outcome.outcome.status
      : null;
    const ok = !(status && status.Failure !== undefined && status.Failure !== null);
    return {
      pred: String(rc.predecessor_id || ""),
      recv: String(rc.receiver_id || ""),
      ts: BigInt(rc.block_timestamp || 0),
      height: Number(rc.block_height) || 0,
      ok,
      transfers: ok ? transfers.map((v) => BigInt(v)) : [],
      logs: (r.execution_outcome && r.execution_outcome.outcome
        && Array.isArray(r.execution_outcome.outcome.logs))
        ? r.execution_outcome.outcome.logs.map(String)
        : [],
    };
  }) : [];
  return {
    hash: String((raw.transaction && raw.transaction.hash) || ""),
    signer: String((raw.transaction && raw.transaction.signer_id) || ""),
    receipts,
  };
}

function traceFixture({ txs, creator, wallet, buyTs, buyCost, busy = [] }) {
  const edges = txs.flatMap((raw) => edgesAll(parseTx(raw)));
  const floor = BigInt(buyCost) / 2n;
  let frontier = [{ account: wallet, path: [] }];
  const seen = new Set([wallet]);
  for (let depth = 0; depth < 3; depth += 1) {
    const next = [];
    for (const node of frontier) {
      for (const edge of edges) {
        if (edge.to !== node.account || edge.ts >= BigInt(buyTs) || edge.yocto < floor) continue;
        if (node.path.length && edge.ts >= node.path[0].ts) continue;
        const path = [edge, ...node.path];
        if (edge.from === creator) return { verdict: "linked", path };
        if (busy.includes(edge.from) || seen.has(edge.from)) continue;
        seen.add(edge.from);
        next.push({ account: edge.from, path });
      }
    }
    frontier = next;
  }
  return { verdict: "unlinked", path: [] };
}

function challengeVerdict(transferTs, vestEndTs) {
  return BigInt(transferTs) < BigInt(vestEndTs) ? "challengeable" : "not-challengeable";
}

const api = { events, edgesAll, edgesInto, parseTx, traceFixture, challengeVerdict };
if (typeof module !== "undefined") module.exports = api;
else Object.assign(globalThis.CustomsRule, api);
