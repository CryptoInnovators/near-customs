"use strict";

(() => {
  const tx = (hash, from, to, yocto, ts) => ({
    transaction: { hash, signer_id: from },
    receipts: [{
      receipt: {
        predecessor_id: from,
        receiver_id: to,
        block_timestamp: String(ts),
        block_height: Number(ts),
        receipt: { Action: { actions: [{ Transfer: { deposit: String(yocto) } }] } },
      },
      execution_outcome: { outcome: { status: { SuccessValue: "" }, logs: [] } },
    }],
  });

  const fixtures = {
    creator: "creator.near",
    buyCost: "100",
    buyTs: "30",
    exchange: {
      buyer: "buyer.exchange.near",
      txs: [tx("EXCHANGE-01", "exchange.near", "buyer.exchange.near", "80", "10")],
    },
    direct: {
      buyer: "buyer.direct.near",
      txs: [tx("DIRECT-01", "creator.near", "buyer.direct.near", "80", "10")],
    },
    twoHop: {
      buyer: "buyer.relay.near",
      txs: [
        tx("HOP-01", "creator.near", "relay.near", "80", "10"),
        tx("HOP-02", "relay.near", "buyer.relay.near", "70", "20"),
      ],
    },
    vesting: {
      transfer: { hash: "VEST-01", from: "holder.near", to: "recipient.near", amount: "25", ts: "86401" },
      vestEndTs: "86400",
    },
  };

  if (typeof module !== "undefined") module.exports = fixtures;
  else globalThis.AttackLabFixtures = fixtures;
})();
