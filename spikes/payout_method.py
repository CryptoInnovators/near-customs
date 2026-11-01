#!/usr/bin/env python3
"""How does the market pay an opening buyer: ft_transfer or ft_transfer_call?
The token's hold refuses ft_transfer_call from the market during the opening window, so every real
opening buy must be paid with ft_transfer. Reads each launch's first buy transaction from FastNEAR
and counts, per token receipt whose predecessor is the market, the method called.
Positive control: the same parse run on the buyer's own wrap.near call must see ft_transfer_call,
otherwise the parser cannot tell the two apart and the count of zero means nothing.
usage: spikes/payout_method.py launch.json ...   (writes spikes/replay/payout-method.json)"""
import json, sys, time, urllib.request, collections

TX = "https://tx.main.fastnear.com/v0/transactions"
MARKET = "dclv2.ref-labs.near"


def fetch(hashes):
    for i in range(8):
        try:
            req = urllib.request.Request(TX, json.dumps({"tx_hashes": hashes}).encode(), {"content-type": "application/json"})
            return json.load(urllib.request.urlopen(req, timeout=40))["transactions"]
        except Exception:
            time.sleep(2 + 2 * i)
    raise SystemExit("fastnear failed")


def methods(tx, pred, recv):
    out = []
    for r in tx["receipts"]:
        rc = r["receipt"]
        if rc["predecessor_id"] == pred and (recv is None or rc["receiver_id"] == recv):
            for a in rc["receipt"].get("Action", {}).get("actions", []):
                if "FunctionCall" in a:
                    out.append(a["FunctionCall"]["method_name"])
    return out


def main():
    out, total = {}, collections.Counter()
    for path in sys.argv[1:]:
        d = json.load(open(path))
        token = d["token"]
        buys = [(row["wallet"], row["first_buy_tx"]) for row in d["rows"] if row.get("first_buy_tx") and row["wallet"] != d["creator"]]
        c = collections.Counter()
        control = 0
        for i in range(0, len(buys), 20):
            chunk = buys[i:i + 20]
            for tx in fetch([h for _, h in chunk]):
                c.update(methods(tx, MARKET, token))
                if "ft_transfer_call" in methods(tx, tx["transaction"]["signer_id"], "wrap.near"):
                    control += 1
        out[token] = {"buys_read": len(buys), "market_to_token_methods": dict(c), "buyer_wrap_calls_seen_with_ft_transfer_call": control}
        total.update(c)
        print(token, len(buys), dict(c), "control", control)
    out["_total"] = dict(total)
    json.dump(out, open("spikes/replay/payout-method.json", "w"), indent=1)
    print("total", dict(total))


main()
