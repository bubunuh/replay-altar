#!/usr/bin/env python3
# Research: one game's army value and food used, as Replay Altar simulated them and as Warcraft III
# showed them (a recording from record.py), both players on the same figure. Writes an SVG; convert
# with `magick -density 144 in.svg out.png`.
#
#   python3 scripts/observer/plot-game.py <recording.jsonl> <game record.json> <out.svg>
#
# Real army value: gold + lumber of the army units alive (no workers, heroes or Militia), the same
# definition as the simulation's army value (packages/sim/src/army.ts, armyValueFn).
import json
import os
import sys

rec_file, game_file, out = sys.argv[1:4]
import glob
balance = json.load(open(sorted(glob.glob(os.path.expanduser("~/.local/share/replay-altar/sim/gamedata/*/UnitBalance.json")))[-1]))["output"]
NOT_ARMY = {"hmil"}
snaps = [json.loads(l) for l in open(rec_file)]
# A sample where no player has any unit after the first minute is a glitch of the reading (the
# game's block caught between updates), not the game: left out.
snaps = [s for s in snaps if s["game"]["t"] < 60000 or any(p.get("units") for p in s["players"])]
game = json.load(open(game_file))


def cost(code):
    b = balance.get(code) or {}
    return (b.get("goldCost") or 0) + (b.get("lumberCost") or 0), b.get("foodUsed") or 0


players = []  # (label, real series, simulated series)
for p in game["players"]:
    name = p["name"].split("#")[0]
    sim = next(s for s in game["sim"]["players"] if s["playerId"] == p["playerId"])
    real = []
    for s in snaps:
        op = next((x for x in s["players"] if x["name"] == name), None)
        if not op or not s["game"].get("in_game"):
            continue
        value = 0
        for u in op["units"]:
            c, food = cost(u["id"])
            if not u.get("worker") and u["id"] not in NOT_ARMY and food > 0 and not u["id"][0].isupper():
                value += c * u["alive"]
        real.append((s["game"]["t"] / 60000, value, op["food"]))
    simulated = [(x["t"] / 60000, x.get("armyValue") or 0, x["foodUsed"]) for x in sim["series"]]
    players.append(("You" if p.get("isMe") else name, p["race"], real, simulated))

# Error summary (printed): mean |sim - real| at the recording's times.
for label, race, real, simulated in players:
    def at(t):
        best = simulated[0]
        for x in simulated:
            if x[0] <= t:
                best = x
        return best
    ev = [abs(at(t)[1] - v) for t, v, _ in real]
    ef = [abs(at(t)[2] - f) for t, _, f in real]
    print(f"{label} ({race}): army value off by {sum(ev) / len(ev):.0f} on average; food used off by {sum(ef) / len(ef):.1f}; real peak army {max(v for _, v, _ in real)} / simulated {max(v for _, v, _ in simulated)}; real peak food {max(f for *_, f in real)} / simulated {max(f for *_, f in simulated)}")

# ---- SVG ------------------------------------------------------------------------------------
W, PANEL_H, LEFT, RIGHT, TOP = 1100, 300, 70, 30, 70
H = TOP + 2 * (PANEL_H + 60) + 20
COLORS = ["#2a78d6", "#eb6834"]  # reference categorical slots 1 and 2
INK, MUTED, GRID = "#1f1f1e", "#6b6a63", "#e4e3dd"
tmax = max(max(t for t, *_ in r) for *_, r, s in players)
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="sans-serif" font-size="13">',
       f'<rect width="{W}" height="{H}" fill="#fcfcfb"/>',
       f'<text x="{LEFT}" y="28" font-size="17" fill="{INK}">{game["players"][0]["name"].split("#")[0]} vs {game["players"][1]["name"].split("#")[0]}, {game["game"]["map"]["file"].split("_")[-1].replace(".w3x", "")}: simulated (dashed) against the game\'s own numbers (solid)</text>']
# legend
lx = LEFT
for i, (label, race, *_) in enumerate(players):
    svg.append(f'<line x1="{lx}" y1="50" x2="{lx + 28}" y2="50" stroke="{COLORS[i]}" stroke-width="2.5"/><text x="{lx + 34}" y="54" fill="{INK}">{label} ({race}), recorded</text>')
    lx += 200
    svg.append(f'<line x1="{lx}" y1="50" x2="{lx + 28}" y2="50" stroke="{COLORS[i]}" stroke-width="2.5" stroke-dasharray="6 4"/><text x="{lx + 34}" y="54" fill="{INK}">{label} ({race}), simulated</text>')
    lx += 210

for k, (title, idx) in enumerate((("Army value (gold + lumber of army units alive)", 1), ("Food used", 2))):
    y0 = TOP + k * (PANEL_H + 60) + 30
    vmax = max(max(x[idx] for x in r + s) for *_, r, s in players)
    step = 500 if idx == 1 and vmax > 2000 else 250 if idx == 1 else 10
    vmax = (int(vmax / step) + 1) * step
    sx = lambda t: LEFT + (W - LEFT - RIGHT) * t / tmax
    sy = lambda v: y0 + PANEL_H - PANEL_H * v / vmax
    svg.append(f'<text x="{LEFT}" y="{y0 - 10}" font-size="14" fill="{INK}">{title}</text>')
    v = 0
    while v <= vmax:
        svg.append(f'<line x1="{LEFT}" y1="{sy(v):.1f}" x2="{W - RIGHT}" y2="{sy(v):.1f}" stroke="{GRID}"/><text x="{LEFT - 8}" y="{sy(v) + 4:.1f}" text-anchor="end" fill="{MUTED}">{v}</text>')
        v += step
    for m in range(0, int(tmax) + 1, 5):
        svg.append(f'<text x="{sx(m):.1f}" y="{y0 + PANEL_H + 18}" text-anchor="middle" fill="{MUTED}">{m}:00</text>')
    for i, (label, race, real, simulated) in enumerate(players):
        for series, dash in ((real, ""), (simulated, ' stroke-dasharray="6 4"')):
            pts = " ".join(f"{sx(x[0]):.1f},{sy(x[idx]):.1f}" for x in series if x[0] <= tmax)
            svg.append(f'<polyline points="{pts}" fill="none" stroke="{COLORS[i]}" stroke-width="2"{dash}/>')
svg.append("</svg>")
open(out, "w").write("\n".join(svg))
print("wrote", out)
