#!/usr/bin/env python3
"""Shared-key probe. For each replayed launch, list the access keys of the creator and of every opening
buyer at one pinned final block, and report buyers that hold a public key the creator holds.
A shared full-access key proves one party controls both accounts, which a chain of receipts cannot.
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
    raise SystemExit("rpc failed")


def keys(account, block):
    r = rpc({"request_type": "view_access_key_list", "block_id": block, "account_id": account})
    if "error" in r or "result" not in r or "keys" not in r["result"]:
        return None
    time.sleep(0.2)
    return {k["public_key"] for k in r["result"]["keys"]}


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
            elif ck and ck & bk:
                shared.append({"wallet": row["wallet"], "keys": sorted(ck & bk)})
        out["launches"][d["token"]] = {
            "creator": d["creator"], "creator_keys": sorted(ck) if ck else None,
            "buyers_checked": len(d["rows"]) - 1, "unreadable": unreadable, "sharing_a_key_with_creator": shared,
        }
        print(d["token"], "buyers", len(d["rows"]) - 1, "sharing", len(shared), "unreadable", unreadable)
    json.dump(out, open("spikes/replay/key-check.json", "w"), indent=1)


main()
