#!/usr/bin/env python3
"""Independent check of the replay's sold-share: current ft_balance_of of every opening buyer, read at one pinned
block over the node RPC (not the transaction API the walker uses). usage: spikes/balances.py <block> launch.json ..."""
import base64, json, sys, time, urllib.request

RPC = "https://archival-rpc.mainnet.fastnear.com"


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for i in range(10):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(RPC, body, {"content-type": "application/json"}), timeout=30))
        except Exception:
            time.sleep(2 + 2 * i)
    raise SystemExit("rpc failed")


block = int(sys.argv[1])
hh = rpc("block", {"block_id": block})["result"]["header"]["hash"]
out = {}
for path in sys.argv[2:]:
    d = json.load(open(path))
    held = bought = zero = 0
    for r in d["rows"]:
        a = base64.b64encode(json.dumps({"account_id": r["wallet"]}).encode()).decode()
        x = rpc("query", {"request_type": "call_function", "block_id": block, "account_id": d["token"],
                          "method_name": "ft_balance_of", "args_base64": a})
        b = int(bytes(x["result"]["result"]).decode().strip('"'))
        held += b; bought += int(r["tokens"]); zero += b == 0
        time.sleep(0.2)
    out[d["token"]] = {"wallets": len(d["rows"]), "zero_balance": zero, "held_share_bps": held * 10000 // bought,
                       "sold_share_bps_replay": d["shares_bps"]["sold_within_vest"]}
    print(d["token"], out[d["token"]], flush=True)
json.dump({"method": "ft_balance_of via call_function", "rpc": RPC, "block": block, "block_hash": hh, "launches": out},
          open("spikes/replay/balance-check.json", "w"), indent=1)
