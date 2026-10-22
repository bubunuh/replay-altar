#!/usr/bin/env python3
# Research: plots each recorded player-game's average army value error before and after the
# selection-list fix (scripts/observer/batch-compare.py writes before-*.json / after-*.json).
# Writes an SVG; convert with `magick -density 144 in.svg out.png`.
#
#   python3 scripts/observer/plot-errors.py <observer folder> <out.svg>
import json
import os
import sys

src, out = sys.argv[1], sys.argv[2]
BATCHES = ["proof", "batch1", "batch2"]
before = sum((json.load(open(os.path.join(src, f"before-{b}.json"))) for b in BATCHES), [])
after = {(r["batch"], r["file"], r["player"]): r["today"] for b in BATCHES for r in json.load(open(os.path.join(src, f"after-{b}.json")))}
ME = "Pedrovisk"


def group(r):
    if r["batch"] == "batch2":
        return "Pro players (16 tournament games)"
    return "You (9 games)" if r["player"] == ME else "Your opponents (9 games)"


GROUPS = ["Pro players (16 tournament games)", "You (9 games)", "Your opponents (9 games)"]
rows = [(group(r), r["today"], after[(r["batch"], r["file"], r["player"])], f'{r["file"][:2]} {r["player"]}') for r in before]
rows.sort(key=lambda x: (GROUPS.index(x[0]), -x[1]))

# Light theme from the dataviz reference palette (slots 1–2, validated).
SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
BEFORE, AFTER = "#eb6834", "#2a78d6"
W, H = 1600, 860
L, R, T, B = 110, 40, 150, 150
pw, ph = W - L - R, H - T - B
ymax = -(-max(max(r[1], r[2]) for r in rows) // 200) * 200
gap = 18  # space between groups
n = len(rows)
step = (pw - gap * (len(GROUPS) - 1)) / n
xs = []
x = L + step / 2
prev = rows[0][0]
for g, *_ in rows:
    if g != prev:
        x += gap
        prev = g
    xs.append(x)
    x += step
y = lambda v: T + ph - min(v, ymax) / ymax * ph

avg_b = sum(r[1] for r in rows) / n
avg_a = sum(r[2] for r in rows) / n
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Inter, Helvetica, Arial, sans-serif">',
       f'<rect width="{W}" height="{H}" fill="{SURFACE}"/>',
       f'<text x="{L}" y="52" font-size="28" font-weight="600" fill="{INK}">Army value error per game, before and after the selection-list fix</text>',
       f'<text x="{L}" y="86" font-size="18" fill="{INK2}">Average gap between the estimated and the real army value (gold + lumber) over each game, 50 player-games recorded with Warcraft III\'s observer data.</text>',
       f'<text x="{L}" y="112" font-size="18" fill="{INK2}">Average over all 50: {avg_b:.0f} before → {avg_a:.0f} after ({(avg_a - avg_b) / avg_b * 100:+.0f}%). Lower is better.</text>']
# Grid and y axis
for v in range(0, ymax + 1, 200):
    yy = y(v)
    svg.append(f'<line x1="{L}" x2="{W - R}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{GRID}" stroke-width="1"/>')
    svg.append(f'<text x="{L - 12}" y="{yy + 6:.1f}" font-size="16" fill="{INK2}" text-anchor="end">{v:,}</text>')
svg.append(f'<text transform="translate(34 {T + ph / 2}) rotate(-90)" font-size="17" fill="{INK2}" text-anchor="middle">Average army value error</text>')
# Dumbbells
for (g, b, a, label), xx in zip(rows, xs):
    svg.append(f'<line x1="{xx:.1f}" x2="{xx:.1f}" y1="{y(b):.1f}" y2="{y(a):.1f}" stroke="#b9b8b2" stroke-width="2"/>')
    svg.append(f'<circle cx="{xx:.1f}" cy="{y(b):.1f}" r="6" fill="{SURFACE}" stroke="{BEFORE}" stroke-width="2.5"><title>{label}: before {b}</title></circle>')
    svg.append(f'<circle cx="{xx:.1f}" cy="{y(a):.1f}" r="6" fill="{AFTER}" stroke="{SURFACE}" stroke-width="2"><title>{label}: after {a}</title></circle>')
    if b > ymax:
        svg.append(f'<text x="{xx:.1f}" y="{T - 6}" font-size="13" fill="{INK2}" text-anchor="middle">{b:,}↑</text>')
# Group labels and per-group averages under the x axis
for g in GROUPS:
    gx = [xx for (gg, *_), xx in zip(rows, xs) if gg == g]
    gr = [r for r in rows if r[0] == g]
    x0, x1 = gx[0] - step / 2, gx[-1] + step / 2
    svg.append(f'<line x1="{x0:.1f}" x2="{x1:.1f}" y1="{T + ph + 16}" y2="{T + ph + 16}" stroke="{INK2}" stroke-width="1.5"/>')
    svg.append(f'<text x="{(x0 + x1) / 2:.1f}" y="{T + ph + 42}" font-size="17" font-weight="600" fill="{INK}" text-anchor="middle">{g}</text>')
    gb = sum(r[1] for r in gr) / len(gr)
    ga = sum(r[2] for r in gr) / len(gr)
    svg.append(f'<text x="{(x0 + x1) / 2:.1f}" y="{T + ph + 66}" font-size="16" fill="{INK2}" text-anchor="middle">average {gb:.0f} → {ga:.0f}</text>')
svg.append(f'<text x="{L + pw / 2}" y="{H - 30}" font-size="16" fill="{INK2}" text-anchor="middle">Each column is one player in one recorded game, sorted by the error before the fix within each group</text>')
# Legend (top right)
lx = W - R - 330
svg.append(f'<circle cx="{lx}" cy="132" r="6" fill="{SURFACE}" stroke="{BEFORE}" stroke-width="2.5"/><text x="{lx + 14}" y="138" font-size="17" fill="{INK}">Before (WC3V alone)</text>')
svg.append(f'<circle cx="{lx + 190}" cy="132" r="6" fill="{AFTER}"/><text x="{lx + 204}" y="138" font-size="17" fill="{INK}">After the fix</text>')
svg.append("</svg>")
open(out, "w").write("\n".join(svg))
print(f"{n} player-games; average {avg_b:.0f} → {avg_a:.0f}")
