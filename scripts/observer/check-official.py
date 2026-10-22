#!/usr/bin/env python3
# Research: checks unit-death estimates against W3Champions' official end-of-game numbers, on every
# game that has them. A player's official "units killed" counts the opponent's units it killed plus
# the creeps it killed, so for each player A with opponent B:
#     official kills of B  ~  a * (A's units that died) + b * (creeps in camps B's side cleared)
# The better a death estimate, the better that fits. Compared: WC3V's lost units (what the app uses
# today) and the deaths inferred from the replay's own selection lists (scripts/observer/compare.py).
#
#   python3 scripts/observer/check-official.py
#
# Result (2026-10-22, 182 player-games from 91 W3Champions games): no real difference. Both explain
# about 60% of the official kills (R² 0.587 today, 0.596 new); creeps and summons dominate the totals,
# so end-of-game numbers can't tell the two apart. The official "largest army" is no help either: it
# matches neither peak army food nor peak food used closely. Testing needs time series (observer).
import glob
import gzip
import json
import os
import subprocess
import sys
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(__file__), "../..")
DATA = os.path.expanduser("~/.local/share/replay-altar")
WORKERS = {"hpea", "opeo", "uaco", "ewsp"}
BALANCE = json.load(open(os.path.join(DATA, "sim/gamedata/current/UnitBalance.json")))["output"]
food = lambda ty: (BALANCE.get(ty) or {}).get("foodUsed") or 0
is_army = lambda ty: bool(ty) and ty[:1].islower() and ty not in WORKERS and food(ty) > 0 and (BALANCE.get(ty) or {}).get("armorType") != "hero"


def actions(replay):
    out = subprocess.run(["node", os.path.join(ROOT, "scripts/observer/actions.cjs"), replay], capture_output=True, text=True, timeout=300).stdout
    by = defaultdict(list)
    for line in out.splitlines():
        a = json.loads(line)
        by[str(a["p"])].append(a)
    return by


def snapshots(acts):
    """Whole selections the game itself listed: a deselect followed at once by a select, or a group assignment."""
    snaps = []
    for i, a in enumerate(acts):
        nxt = acts[i + 1] if i + 1 < len(acts) else None
        if a["id"] == 22 and a.get("selectMode") == 2 and nxt and nxt["id"] == 22 and nxt.get("selectMode") == 1 and nxt["t"] == a["t"]:
            snaps.append((a["t"], frozenset(map(tuple, a.get("units", [])))))
        elif a["id"] == 23:
            snaps.append((a["t"], frozenset(map(tuple, a.get("units", [])))))
    return snaps


def army_food_series(units, deaths, htype, snaps, end):
    """Army food every 10 s, three ways: WC3V's alive units (today's army value), and trained units minus
    selection-list deaths (handles typed by the game's subgroup focus, else by the trained type with room)."""
    trained = [u for u in units if is_army(u["itemId"]) and u.get("trainedTime") is not None and not u.get("isIllusion")]
    def wc3v_at(t):
        n = 0
        for u in trained:
            ls = u.get("lostState") or {}
            dead = ls.get("state") in ("lost", "possiblyLost") and ls.get("since", 1e12) <= t
            if u["trainedTime"] <= t and not dead:
                n += food(u["itemId"])
        return n
    seen = defaultdict(list)
    for t, s in snaps:
        for h in s:
            seen[h].append(t)
    first = {h: ts[0] for h, ts in seen.items()}
    assigned = defaultdict(int)
    dtimes = defaultdict(list)
    types = {u["itemId"] for u in trained}
    for h in sorted(deaths, key=lambda h: first.get(h, 0)):
        ty = htype.get(h)
        if not ty:
            avail = {k: sum(1 for u in trained if u["itemId"] == k and u["trainedTime"] <= first[h]) - assigned[k] for k in types}
            ty = max(avail, key=avail.get) if avail and max(avail.values()) > 0 else None
        if not ty or not is_army(ty):
            continue
        assigned[ty] += 1
        dtimes[ty].append(sum(deaths[h]) / 2)
    def new_at(t):
        n = 0
        for k in types:
            alive = sum(1 for u in trained if u["itemId"] == k and u["trainedTime"] <= t) - sum(1 for d in dtimes[k] if d <= t)
            n += max(0, alive) * food(k)
        return n
    grid = range(0, end, 10_000)
    return max((wc3v_at(t) for t in grid), default=0), max((new_at(t) for t in grid), default=0)


def selection_deaths(acts, buildings, heroes_types):
    """Handles that stop appearing in later lists of the group they were last in: {handle: (last seen, gone by)}."""
    snaps = snapshots(acts)
    htype = {}
    for a in acts:
        if a["id"] == 25 and a.get("objectId1") is not None:
            htype.setdefault((a["objectId1"], a["objectId2"]), a["itemId"])
    seen = defaultdict(list)
    for t, s in snaps:
        for h in s:
            seen[h].append(t)
    deaths = {}
    for h, ts in seen.items():
        ty = htype.get(h)
        if ty and (ty in buildings or ty[0].isupper()):
            continue  # buildings and heroes are counted elsewhere by the game
        last = ts[-1]
        base = next(s for t, s in snaps if t == last and h in s)
        for t, s in snaps:
            if t <= last or h in s:
                continue
            if len(s & base) >= max(2, 0.5 * len(base - {h})):
                deaths[h] = (last, t)
                break
    return deaths, htype, snaps


def wc3v_lost(units):
    return [u for u in units if not u.get("isBuilding") and not u.get("isIllusion") and u["itemId"][:1].islower()
            and (u.get("lostState") or {}).get("state") in ("lost", "possiblyLost")]


def games():
    for f in glob.glob(f"{DATA}/games/*.json") + glob.glob(f"{DATA}/reference/*/games/*.json"):
        r = json.load(open(f))
        off = r.get("official") or {}
        sim = r.get("sim") or {}
        if off.get("status") != "ok" or sim.get("status") != "ok" or len(r["players"]) != 2:
            continue
        out = sim.get("outputPath")
        if not out or not os.path.exists(out) or not os.path.exists(r["provenance"]["archivePath"]):
            continue
        yield r


def fit(rows, key):
    """Least squares: kills ~ a*deaths + b*creeps (no intercept). Returns a, b, R^2, mean abs error."""
    sxx = sum(r[key] ** 2 for r in rows); sxy = sum(r[key] * r["creeps"] for r in rows); syy = sum(r["creeps"] ** 2 for r in rows)
    tx = sum(r[key] * r["kills"] for r in rows); ty = sum(r["creeps"] * r["kills"] for r in rows)
    det = sxx * syy - sxy * sxy
    a = (tx * syy - ty * sxy) / det
    b = (sxx * ty - sxy * tx) / det
    mean = sum(r["kills"] for r in rows) / len(rows)
    res = sum((r["kills"] - a * r[key] - b * r["creeps"]) ** 2 for r in rows)
    tot = sum((r["kills"] - mean) ** 2 for r in rows)
    mae = sum(abs(r["kills"] - a * r[key] - b * r["creeps"]) for r in rows) / len(rows)
    return a, b, 1 - res / tot, mae


def main():
    rows = []
    seen_keys = set()
    for r in games():
        if r["gameKey"] in seen_keys:
            continue
        seen_keys.add(r["gameKey"])
        o = json.load(gzip.open(r["sim"]["outputPath"]))
        acts = actions(r["provenance"]["archivePath"])
        groups = (o.get("world") or {}).get("neutralGroups") or {}
        off = {p["playerId"]: p for p in r["official"]["players"]}
        for a_p in r["players"]:
            b_p = next(p for p in r["players"] if p["playerId"] != a_p["playerId"])
            if b_p["playerId"] not in off:
                continue
            wa = o["players"].get(str(a_p["playerId"]))
            if not wa:
                continue
            units = wa.get("units", [])
            buildings = {u["itemId"] for u in units if u.get("isBuilding")}
            lost = wc3v_lost(units)
            # The ones WC3V never saw move after training: counted dead the moment they were trained.
            ghosts = [u for u in lost if (u.get("lostState") or {}).get("source") == "pathSilence" and len(u.get("path") or []) <= 2]
            sel, htype, snaps = selection_deaths(acts.get(str(a_p["playerId"]), []), buildings, None)
            army_wc3v, army_new = army_food_series(units, sel, htype, snaps, r["game"]["durationMs"])
            sp = next((x for x in r["sim"]["players"] if x["playerId"] == a_p["playerId"]), None)
            army_supply = max((x.get("armyFood") or 0 for x in (sp or {}).get("series", [])), default=0)
            creeps = sum(len(g.get("units") or []) for g in groups.values() if g.get("claimState") == 2 and g.get("claimOwnerId") == b_p["teamId"])
            rows.append({
                "game": r["gameKey"][:8], "kills": off[b_p["playerId"]]["unitsKilled"], "creeps": creeps,
                "wc3v": len(lost), "wc3v_no_ghosts": len(lost) - len(ghosts), "selection": len(sel),
                "produced": off[a_p["playerId"]]["unitsProduced"],
                "largest": off[a_p["playerId"]]["largestArmy"], "army_wc3v": army_wc3v, "army_new": army_new, "army_supply": army_supply,
            })
        print(f"{len(seen_keys)} games", file=sys.stderr, flush=True)
    print(f"{len(rows)} player-games from {len(seen_keys)} games with official numbers\n")
    print("| Deaths from | a (per death) | b (per creep) | R² | Mean abs error (kills) |")
    print("|---|---|---|---|---|")
    for key, name in [("wc3v", "WC3V lost units (today)"), ("wc3v_no_ghosts", "WC3V, without units never seen moving"), ("selection", "Selection lists (new)")]:
        a, b, r2, mae = fit(rows, key)
        print(f"| {name} | {a:.2f} | {b:.2f} | {r2:.3f} | {mae:.1f} |")
    json.dump(rows, open(os.path.join(DATA, "observer/check-official.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
