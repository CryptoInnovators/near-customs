#!/usr/bin/env python3
"""Shared-key probe. For each replayed launch, list the access keys of the creator and of every opening
buyer at one pinned final block, and report buyers that hold a public key the creator holds.
A shared FullAccess key proves one party controls both accounts, which a chain of receipts cannot. A shared
FunctionCall key proves nothing about control: apps hand the same limited key to every account they onboard.
Reads only. usage: spikes/keys.py <block_height> launch.json ..."""
import json, sys, time, urllib.request

RPC = "https://archival-rpc.mainnet.fastnear.com"


def rpc(params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "query", "params": params}).encode()
    for i in range(10):
        try:
            req = urllib.request.Request(RPC, body, {"content-type": "application/json"})
            return json.load(urllib.request.urlopen(req, timeout=30))
        except Exception:
            time.sleep(2 + 2 * i)
    return None


def keys(account, block):
    r = rpc({"request_type": "view_access_key_list", "block_id": block, "account_id": account})
    if r is None or "error" in r or "result" not in r or "keys" not in r["result"]:
        return None
    time.sleep(0.2)
    return {k["public_key"]: k["access_key"]["permission"] == "FullAccess" for k in r["result"]["keys"]}


def main():
    block = int(sys.argv[1])
    out = {"block": block, "launches": {}}
    for path in sys.argv[2:]:
        d = json.load(open(path))
        ck = keys(d["creator"], block)
        shared, unreadable = [], 0
        for row in d["rows"]:
            if row["wallet"] == d["creator"]:
                continue
            bk = keys(row["wallet"], block)
            if bk is None:
                unreadable += 1
            elif ck:
                both = sorted(set(ck) & set(bk))
                if both:
                    shared.append({"wallet": row["wallet"],
                                   "full_access_on_both": [k for k in both if ck[k] and bk[k]],
                                   "function_call_on_either": [k for k in both if not (ck[k] and bk[k])]})
        out["launches"][d["token"]] = {
            "creator": d["creator"], "creator_keys": sorted(ck) if ck else None,
            "wallets_with_a_full_access_key_shared": sum(1 for x in shared if x["full_access_on_both"]),
            "buyers_checked": len(d["rows"]) - 1, "unreadable": unreadable, "sharing_a_key_with_creator": shared,
        }
        print(d["token"], "buyers", len(d["rows"]) - 1, "sharing", len(shared), "unreadable", unreadable)
    json.dump(out, open("spikes/replay/key-check.json", "w"), indent=1)


main()
