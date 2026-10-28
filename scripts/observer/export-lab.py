#!/usr/bin/env python3
# Research: exports the observer-recorded games (scripts/observer/record.py batches) as self-contained
# folders for the WC3V lab (~/Projects/wc3v-lab, tools/score.js): replay.w3g, observer.jsonl (the
# recording, both players only) and meta.json (WC3V player ids, names, races, band, source and `bar`,
# Replay Altar's current army value error for each player, the number the lab has to beat).
#
#   python3 scripts/observer/export-lab.py <out folder> <batch>[:<skip,skip>] ...
#   e.g. export-lab.py ~/.local/share/replay-altar/observer/lab-all proof batch1:01,10,11,...,29 batch2:10,12
import glob
import gzip
import importlib.util
import json
import os
import shutil
import sys

HERE = os.path.dirname(__file__)
spec = importlib.util.spec_from_file_location("bc", os.path.join(HERE, "batch-compare.py"))
bc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bc)
OBS = os.path.join(bc.DATA, "observer")
ME = "Pedrovisk"


def recordings(batch, manifest, skip):
    """Each recording to its game (map and players); a replay watched twice keeps its longest one."""
    best = {}
    for rec_file in sorted(glob.glob(os.path.join(OBS, batch, "recordings/*.jsonl"))):
        samples = [json.loads(line) for line in open(rec_file)]
        if not samples:
            continue
        mapname = samples[0]["game"]["map"].replace("\\", "/").split("/")[-1].lower()
        names = {p["name"] for p in samples[0]["players"]}
        matches = [e for e in manifest if os.path.basename(e["map"]).lower() == mapname and {n.split("#")[0] for n in e["names"]} == names]
        if not matches:
            print(f"{batch}/{os.path.basename(rec_file)}: no matching game in the manifest")
            continue
        entry = min(matches, key=lambda e: abs(e["dur"] * 60_000 - samples[-1]["game"]["t"]))
        if entry["file"][:2] in skip:
            continue
        # A player who left (the last seconds of most games) or a glitched snapshot shows no units and
        # no heroes at all; those snapshots aren't the game's state. The first ones are the game start.
        samples = [s for i, s in enumerate(samples) if i < 5 or all(p["units"] or p["heroes"] for p in s["players"])]
        if entry["file"] not in best or len(samples) > len(best[entry["file"]][1]):
            best[entry["file"]] = (entry, samples)
    return sorted(best.values(), key=lambda x: x[0]["file"])


def bar_error(record, player_id, name, samples):
    series = next(sp for sp in record["sim"]["players"] if sp["playerId"] == player_id)["series"]

    def today(t):
        v = series[0]
        for s in series:
            if s["t"] <= t:
                v = s
        return v.get("armyValue") or 0

    err = n = 0
    for s in samples:
        op = next((x for x in s["players"] if x["name"] == name), None)
        if not op:
            continue
        truth = sum(bc.cost(u["id"]) * u["alive"] for u in op["units"] if bc.check.is_army(u["id"]) and u["id"] != "hmil")
        err += abs(today(s["game"]["t"]) - truth)
        n += 1
    return round(err / n) if n else None


def main():
    out = os.path.expanduser(sys.argv[1])
    os.makedirs(out, exist_ok=True)
    for spec_ in sys.argv[2:]:
        batch, _, skip = spec_.partition(":")
        manifest = json.load(open(os.path.join(OBS, batch, "manifest.json")))
        for entry, samples in recordings(batch, manifest, set(filter(None, skip.split(",")))):
            r = bc.record_of(entry["key"])
            if not r:
                print(f"{batch}/{entry['file']}: no simulated record, skipped")
                continue
            if r["classification"].get("replayProblem"):
                print(f"{batch}/{entry['file']}: damaged replay ({r['classification']['replayProblem']}), the game played it wrong; skipped")
                continue
            gid = f"{batch}-{entry['file'][:2]}"
            d = os.path.join(out, gid)
            os.makedirs(d, exist_ok=True)
            shutil.copyfile(r["provenance"]["archivePath"], os.path.join(d, "replay.w3g"))
            names = {p["name"].split("#")[0] for p in r["players"]}
            with open(os.path.join(d, "observer.jsonl"), "w") as f:
                for s in samples:
                    s = dict(s, players=[p for p in s["players"] if p["name"] in names])
                    f.write(json.dumps(s) + "\n")
            mine = any(n.split("#")[0] == ME for n in entry["names"])
            band = entry.get("band") or ("me" if mine else "pro")
            players = []
            for p in r["players"]:
                name = p["name"].split("#")[0]
                players.append({"wc3vId": p["playerId"], "name": name, "race": p["race"], "bar": bar_error(r, p["playerId"], name, samples)})
            meta = {"game": gid, "band": band, "source": entry.get("source") or ("mine" if mine else "w3info"), "matchup": entry.get("mu"), "map": os.path.basename(entry["map"]),
                    "minutes": entry.get("dur"), "mmr": entry.get("mmr"), "snapshots": len(samples), "players": players}
            json.dump(meta, open(os.path.join(d, "meta.json"), "w"), indent=1)
            print(gid, band, entry.get("mu"), [(p["name"], p["bar"]) for p in players])


if __name__ == "__main__":
    main()
