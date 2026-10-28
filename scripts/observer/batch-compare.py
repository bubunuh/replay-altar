#!/usr/bin/env python3
# Research: for every observer recording in a batch (scripts/observer/record.py <folder>), the real army
# value over time against today's estimate (the app's army value from WC3V's units) and the new one
# (units trained minus deaths seen in the replay's own selection lists).
#
#   python3 scripts/observer/batch-compare.py <batch folder with manifest.json and recordings/> [skip: 10,12]
import glob
import gzip
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
import importlib.util

spec = importlib.util.spec_from_file_location("check", os.path.join(os.path.dirname(__file__), "check-official.py"))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

DATA = os.path.expanduser("~/.local/share/replay-altar")
BAL = check.BALANCE
cost = lambda ty: ((BAL.get(ty) or {}).get("goldCost") or 0) + ((BAL.get(ty) or {}).get("lumberCost") or 0)
mmss = lambda t: f"{t // 60000}:{t // 1000 % 60:02d}"


def record_of(key):
    """The game's record, from whichever folder holds a simulated copy."""
    for f in glob.glob(f"{DATA}/games/{key}.json") + glob.glob(f"{DATA}/reference/*/games/{key}.json"):
        r = json.load(open(f))
        if (r.get("sim") or {}).get("status") == "ok" and os.path.exists(r["sim"].get("outputPath", "")):
            return r


METHOD = os.environ.get("DEATHS", "groups")


def hybrid_estimate(units, acts):
    """WC3V where it followed the unit; the selection lists only for the units it never saw move after
    training (today those count as dead the moment they are trained)."""
    buildings = {u["itemId"] for u in units if u.get("isBuilding")}
    deaths, htype, snaps = check.selection_deaths(acts, buildings, None)
    army = [u for u in units if check.is_army(u["itemId"]) and u["itemId"] != "hmil" and u.get("trainedTime") is not None and not u.get("isIllusion")]
    tracked = [u for u in army if len(u.get("path") or []) > 2]
    untracked = [u for u in army if len(u.get("path") or []) <= 2]
    known = {(u.get("objectId1"), u.get("objectId2")) for u in tracked if u.get("objectId1") is not None}
    seen = defaultdict(list)
    for t, s in snaps:
        for h in s:
            seen[h].append(t)
    first = {h: ts[0] for h, ts in seen.items()}
    types = {u["itemId"] for u in untracked}
    assigned = defaultdict(int)
    dtimes = defaultdict(list)
    for h in sorted((h for h in deaths if h not in known and METHOD != "alive"), key=lambda h: first.get(h, 0)):
        ty = htype.get(h)
        if not ty:
            avail = {k: sum(1 for u in untracked if u["itemId"] == k and u["trainedTime"] <= first[h]) - assigned[k] for k in types}
            ty = max(avail, key=avail.get) if avail and max(avail.values()) > 0 else None
        if not ty or ty not in types:
            continue
        assigned[ty] += 1
        dtimes[ty].append(sum(deaths[h]) / 2)

    # hybrid2: a followed unit the selection lists show dead dies then, even if WC3V thinks it lives.
    sel_death = {}
    if METHOD == "hybrid2":
        for u in tracked:
            h = (u.get("objectId1"), u.get("objectId2"))
            if h in deaths:
                sel_death[id(u)] = sum(deaths[h]) / 2

    def at(t):
        v = 0
        for u in tracked:
            ls = u.get("lostState") or {}
            dead_at = ls.get("since", 1e12) if ls.get("state") in ("lost", "possiblyLost") else 1e12
            dead_at = min(dead_at, sel_death.get(id(u), 1e12))
            if u["trainedTime"] <= t and dead_at > t:
                v += cost(u["itemId"])
        for k in types:
            alive = sum(1 for u in untracked if u["itemId"] == k and u["trainedTime"] <= t) - sum(1 for d in dtimes[k] if d <= t)
            v += max(0, alive) * cost(k)
        return v

    return at


def new_estimate(units, acts):
    if METHOD in ("hybrid", "hybrid2", "alive"):  # alive: never-followed units counted alive, no deaths
        return hybrid_estimate(units, acts)
    """Army value at time t: trained army units minus deaths from the selection lists, by type."""
    buildings = {u["itemId"] for u in units if u.get("isBuilding")}
    if METHOD == "union":
        d1, htype, snaps = check.group_deaths(acts, buildings, None)
        d2, _, snaps2 = check.selection_deaths(acts, buildings, None)
        deaths = {**d2, **d1}
        snaps = snaps + snaps2
    else:
        deaths, htype, snaps = (check.group_deaths if METHOD == "groups" else check.selection_deaths)(acts, buildings, None)
    trained = [u for u in units if check.is_army(u["itemId"]) and u["itemId"] != "hmil" and u.get("trainedTime") is not None and not u.get("isIllusion")]
    seen = defaultdict(list)
    for t, s in snaps:
        for h in s:
            seen[h].append(t)
    first = {h: ts[0] for h, ts in seen.items()}
    types = {u["itemId"] for u in trained}
    assigned = defaultdict(int)
    dtimes = defaultdict(list)
    for h in sorted(deaths, key=lambda h: first.get(h, 0)):
        ty = htype.get(h)
        if not ty:
            avail = {k: sum(1 for u in trained if u["itemId"] == k and u["trainedTime"] <= first[h]) - assigned[k] for k in types}
            ty = max(avail, key=avail.get) if avail and max(avail.values()) > 0 else None
        if not ty or not check.is_army(ty):
            continue
        assigned[ty] += 1
        dtimes[ty].append(sum(deaths[h]) / 2)

    def at(t):
        v = 0
        for k in types:
            alive = sum(1 for u in trained if u["itemId"] == k and u["trainedTime"] <= t) - sum(1 for d in dtimes[k] if d <= t)
            v += max(0, alive) * cost(k)
        return v

    return at


def main():
    batch = sys.argv[1]
    manifest = json.load(open(os.path.join(batch, "manifest.json")))
    total = defaultdict(lambda: [0.0, 0.0, 0])
    rows = []
    skip = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else set()  # replays that played wrong in the game
    # Each recording to its game (map and players); a replay watched twice keeps its longest recording.
    best = {}
    for rec_file in sorted(glob.glob(os.path.join(batch, "recordings/*.jsonl"))):
        samples = [json.loads(line) for line in open(rec_file)]
        if not samples:
            continue
        mapname = samples[0]["game"]["map"].replace("\\", "/").split("/")[-1].lower()
        names = {p["name"] for p in samples[0]["players"]}
        matches = [e for e in manifest if os.path.basename(e["map"]).lower() == mapname and {n.split("#")[0] for n in e["names"]} == names]
        if not matches:
            print(f"{os.path.basename(rec_file)}: no matching game in the manifest")
            continue
        # Same players and map twice: tell them apart by length.
        entry = min(matches, key=lambda e: abs(e["dur"] * 60_000 - samples[-1]["game"]["t"]))
        if entry["file"][:2] in skip:
            continue
        if entry["file"] not in best or len(samples) > len(best[entry["file"]][1]):
            best[entry["file"]] = (entry, samples)
    for entry, samples in sorted(best.values(), key=lambda x: x[0]["file"]):
        r = record_of(entry["key"])
        if r["classification"].get("replayProblem"):
            print(f"{entry['file']}: damaged replay ({r['classification']['replayProblem']}), the game played it wrong; skipped")
            continue
        o = json.load(gzip.open(r["sim"]["outputPath"]))
        acts = check.actions(r["provenance"]["archivePath"])
        for p in r["players"]:
            name = p["name"].split("#")[0]
            units = o["players"][str(p["playerId"])].get("units", [])
            est = new_estimate(units, acts.get(str(p["playerId"]), []))
            series = next(sp for sp in r["sim"]["players"] if sp["playerId"] == p["playerId"])["series"]

            def today(t):
                best = series[0]
                for s in series:
                    if s["t"] <= t:
                        best = s
                return best.get("armyValue") or 0

            e_today = e_new = 0.0
            n = 0
            for s in samples:
                op = next((x for x in s["players"] if x["name"] == name), None)
                if not op:
                    continue
                t = s["game"]["t"]
                truth = sum(cost(u["id"]) * u["alive"] for u in op["units"] if check.is_army(u["id"]) and u["id"] != "hmil")
                e_today += abs(today(t) - truth)
                e_new += abs(est(t) - truth)
                n += 1
            if not n:
                continue
            rows.append((entry["file"], name, round(e_today / n), round(e_new / n), n))
            who = "you" if name == "Pedrovisk" else ("opponents" if any(n.startswith("Pedrovisk") for n in entry["names"]) else "pro players")
            total[who][0] += e_today / n
            total[who][1] += e_new / n
            total[who][2] += 1
    if os.environ.get("JSON_OUT"):
        json.dump([dict(batch=os.path.basename(batch.rstrip("/")), file=f, player=p, today=a, new=b, snapshots=n) for f, p, a, b, n in rows], open(os.environ["JSON_OUT"], "w"), indent=1)
    print("| Replay | Player | Army value error today | New | Snapshots |")
    print("|---|---|---|---|---|")
    for row in rows:
        print("| " + " | ".join(map(str, row)) + " |")
    print()
    for who, (a, b, n) in total.items():
        print(f"{who}: average error today {a / n:.0f}, new {b / n:.0f} ({n} player-games)")


if __name__ == "__main__":
    main()
