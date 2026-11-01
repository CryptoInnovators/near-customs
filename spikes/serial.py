#!/usr/bin/env python3
"""Wallets that bought the opening of several launches, from spikes/replay/*.json.
Usage: python3 spikes/serial.py [min_launches]   (default 3)"""
import json, sys
from collections import defaultdict
NAMES = ['phire', 'clearline', 'justai', 'wmark', 'mob', 'drita', 'nearvember', 'celadon', 'doljabi', 'ss', 'grlant']


def serial(replays, k=3):
    """replays: {launch: replay dict}. Returns [(wallet, launches, share_bps_total)] for wallets in >= k openings, most launches first."""
    seen = defaultdict(set)
    for launch, d in replays.items():
        for r in d['rows']:
            if r['class'] != 'creator':
                seen[r['wallet']].add(launch)
    hits = [(w, sorted(ls)) for w, ls in seen.items() if len(ls) >= k]
    return sorted(hits, key=lambda h: (-len(h[1]), h[0]))


def load(names=NAMES, root='spikes/replay'):
    out = {}
    for n in names:
        with open(f'{root}/{n}.json') as f:
            out[n] = json.load(f)
    return out


if __name__ == '__main__':
    k = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    rep = load()
    total = len({r['wallet'] for d in rep.values() for r in d['rows'] if r['class'] != 'creator'})
    print("| Wallet | Openings bought | Launches |")
    print("|---|---|---|")
    hits = serial(rep, k)
    for w, ls in hits:
        print(f"| {w} | {len(ls)} of {len(rep)} | {', '.join(ls)} |")
    print()
    print(f"{len(hits)} of {total} distinct opening buyers bought {k} or more of the {len(rep)} openings")
