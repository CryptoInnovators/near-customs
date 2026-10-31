#!/usr/bin/env python3
"""Prints the SPIKE.md result table from spikes/replay/*.json. Every cell is read from a replay file."""
import json, time
NAMES = ['phire', 'clearline', 'justai', 'wmark', 'mob', 'drita', 'nearvember', 'celadon', 'doljabi', 'ss', 'grlant']
rows = []
tot = {"buyers": 0, "placebo": 0, "placebo_linked": 0}
print("| Launch | Opening (UTC) | Buyers | Opening tokens sold within 24h | Creator's own wallet | Creator-linked at 1 / 2 / 3 hops | Wallets the creator paid | Placebo creator linked | Replay head block |")
print("|---|---|---|---|---|---|---|---|---|")
for n in NAMES:
    d = json.load(open(f'spikes/replay/{n}.json'))
    sb, h, p = d['shares_bps'], d['creator_linked_bps_by_hops'], d['placebo']
    tot["buyers"] += d['buyers']; tot["placebo"] += p['buyers_tested']
    print(f"| {n}.nearlytrade.near | {time.strftime('%m-%d %H:%M', time.gmtime(d['opening_starts_ns']/1e9))} | {d['buyers']} | {sb['sold_within_vest']/100:.2f}% | {sb['creator_direct']/100:.2f}% | {h['1']/100:.2f}% / {h['2']/100:.2f}% / {h['3']/100:.2f}% | {d['creator_funding_of_buyers']['wallets_funded_before_first_buy']} | {('0 of ' + str(p['buyers_tested'])) if p['linked_tokens'] == '0' else str(p['linked_bps'] / 100) + '% of tokens'} | {d['head']['height']} |")
print()
print(f"buyers {tot['buyers']}, placebo wallets tested {tot['placebo']}")
