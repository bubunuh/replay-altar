#!/usr/bin/env python3
# Research: splits a batch of recorded games into development and holdout before anyone scores them.
# The rule looks at nothing but the game key: within each skill band and matchup the games are ordered
# by sha256(key) and go alternately to the two sets; which set gets the first one is the parity of the
# first key's hash, so a cell with one game isn't always development. Only games with a usable
# recording (recordings/<file>.jsonl) take part.
#
#   python3 scripts/observer/split.py <batch folder with manifest.json and recordings/>
#
# Writes split.json ({"rule", "dev": [numbers], "holdout": [numbers]}) and prints the export-lab.py
# arguments for each set (the other set's numbers as the skip list).
import hashlib
import json
import os
import sys
from collections import defaultdict


def main():
    batch = os.path.expanduser(sys.argv[1]).rstrip("/")
    manifest = json.load(open(os.path.join(batch, "manifest.json")))
    digest = lambda e: hashlib.sha256(e["key"].encode()).hexdigest()
    number = lambda e: e["file"].split("_")[0][2:]
    cells = defaultdict(list)
    for e in manifest:
        if os.path.exists(os.path.join(batch, "recordings", e["file"][:-4] + ".jsonl")):
            cells[(e["band"], e["mu"])].append(e)
    sets = {"dev": [], "holdout": []}
    for cell in sorted(cells):
        games = sorted(cells[cell], key=digest)
        first = int(digest(games[0])[-1], 16) % 2
        for i, e in enumerate(games):
            sets["holdout" if (i + first) % 2 else "dev"].append(number(e))
    for s in sets.values():
        s.sort()
    json.dump({"rule": "within band x matchup, by sha256(key), alternating; first by the parity of the first hash", **sets},
              open(os.path.join(batch, "split.json"), "w"), indent=1)
    name = os.path.basename(batch)
    left_out = sorted(number(e) for e in manifest if number(e) not in sets["dev"] + sets["holdout"])
    for s, other in (("dev", "holdout"), ("holdout", "dev")):
        print(f"{s}: {len(sets[s])} games; export-lab.py <out> {name}:{','.join(sets[other] + left_out)}")
    bands = defaultdict(lambda: [0, 0])
    for e in manifest:
        for i, s in enumerate(("dev", "holdout")):
            bands[e["band"]][i] += number(e) in sets[s]
    print("by band (dev, holdout):", dict(bands), "| no recording:", left_out)


if __name__ == "__main__":
    main()
