"use strict";
/* ALLOW / WARN / BLOCK for one launch, with reasons. Input: buyers [{near, status}] where status is the trace status
   ("linked" = creator money reached the buyer, "creator" = the creator's own wallet, "unlinked", "unpriced", or null/"not_traced" = unread).
   Returns null until every buyer has a final trace: a partial trace never yields a verdict. */
const BLOCK_BUYER_SHARE = 0.2;
const BLOCK_NEAR_SHARE = 0.25;
const WARN_OWN_SHARE = 0.1;
const FINAL = new Set(["linked", "creator", "unlinked", "unpriced"]);

function verdictOf(buyers) {
  const list = Array.isArray(buyers) ? buyers : [];
  if (!list.length || list.some((b) => !b || !FINAL.has(b.status))) return null;
  const sum = (f) => list.filter(f).reduce((n, b) => n + (Number(b.near) || 0), 0);
  const total = sum(() => true);
  const paid = list.filter((b) => b.status === "linked");
  const own = list.filter((b) => b.status === "creator");
  const paidNear = sum((b) => b.status === "linked");
  const ownNear = sum((b) => b.status === "creator");
  const fmt = (n) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toPrecision(2)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const buyersWord = (n) => n + (n === 1 ? " opening buyer" : " opening buyers");
  const reasons = [];
  let kind = "ALLOW";
  if (paid.length) {
    reasons.push("Creator money paid " + paid.length + " of " + buyersWord(list.length) + ".");
    reasons.push(fmt(paidNear) + " NEAR of " + fmt(total) + " NEAR in opening buys came from the creator.");
    kind = paid.length / list.length >= BLOCK_BUYER_SHARE || (total > 0 && paidNear / total >= BLOCK_NEAR_SHARE) ? "BLOCK" : "WARN";
  }
  if (own.length) {
    reasons.push("The creator bought " + fmt(ownNear) + " NEAR of the opening from their own wallet.");
    if (kind === "ALLOW" && total > 0 && ownNear / total >= WARN_OWN_SHARE) kind = "WARN";
  }
  if (!paid.length) reasons.push("No opening buyer traces back to the creator within 3 transfers.");
  return { kind, reasons, buyers: list.length, funded: paid.length, own: own.length, near: total, fundedNear: paidNear, ownNear };
}

if (typeof module !== "undefined") module.exports = { verdictOf, BLOCK_BUYER_SHARE, BLOCK_NEAR_SHARE, WARN_OWN_SHARE };
