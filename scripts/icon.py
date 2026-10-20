# Replay Altar's pixel-art icon (option E: twin altar pillars with a replay ring), drawn on a
# 32x32 grid and written as the app's icon files:
#
#   python3 -I scripts/icon.py             icon files in apps/desktop/assets/ (svg, ico, pngs)
#   python3 -I scripts/icon.py --options   the six options it was chosen from, with a contact
#                                          sheet, in apps/desktop/assets/icon-options/
import math, os, sys
from PIL import Image, ImageDraw

ASSETS = os.path.join(os.path.dirname(__file__), "../apps/desktop/assets")
OUT = os.path.join(ASSETS, "icon-options")
N = 32
OUTLINE = (20, 18, 24, 255)

def canvas():
    return Image.new("RGBA", (N, N), (0, 0, 0, 0))

def px(im, x, y, c):
    if 0 <= x < N and 0 <= y < N:
        im.putpixel((x, y), c)

def rect(im, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px(im, x, y, c)

def outline(im, color=OUTLINE):
    """1-pixel dark outline around everything drawn (the classic pixel-art edge)."""
    src = im.copy()
    for y in range(N):
        for x in range(N):
            if src.getpixel((x, y))[3]:
                continue
            if any(0 <= x + dx < N and 0 <= y + dy < N and src.getpixel((x + dx, y + dy))[3] and src.getpixel((x + dx, y + dy)) != color
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                im.putpixel((x, y), color)

def arc(im, cx, cy, r, w, a0, a1, c, c_hi=None):
    """Ring segment from angle a0 to a1 (degrees, 0 = right, counter-clockwise, y up)."""
    for y in range(N):
        for x in range(N):
            dx, dy = x + 0.5 - cx, cy - (y + 0.5)
            d = math.hypot(dx, dy)
            if r - w <= d <= r:
                a = math.degrees(math.atan2(dy, dx)) % 360
                if (a0 <= a <= a1) if a0 <= a1 else (a >= a0 or a <= a1):
                    px(im, x, y, c_hi if c_hi and d > r - w / 2 and dy > 0 else c)

def tri(im, pts, c):
    lo_y, hi_y = int(min(p[1] for p in pts)), int(max(p[1] for p in pts)) + 1
    lo_x, hi_x = int(min(p[0] for p in pts)), int(max(p[0] for p in pts)) + 1
    def inside(x, y):
        (x1, y1), (x2, y2), (x3, y3) = pts
        d1 = (x - x2) * (y1 - y2) - (x1 - x2) * (y - y2)
        d2 = (x - x3) * (y2 - y3) - (x2 - x3) * (y - y3)
        d3 = (x - x1) * (y3 - y1) - (x3 - x1) * (y - y1)
        return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))
    for y in range(lo_y, hi_y + 1):
        for x in range(lo_x, hi_x + 1):
            if inside(x + 0.5, y + 0.5):
                px(im, x, y, c)

def replay_arrow(im, cx, cy, r, w, c, hi, head):
    """Circular 'replay' arrow (like ⟳): a ring open at the top right, its head at the top end
    pointing clockwise into the gap."""
    arc(im, cx, cy, r, w, 75, 15, c, hi)  # from 75° anticlockwise round to 15° (gap 15°-75°)
    a = math.radians(75)
    mid = r - w / 2
    ex, ey = cx + mid * math.cos(a), cy - mid * math.sin(a)
    tx, ty = math.sin(a), math.cos(a)  # clockwise tangent, in screen coordinates (y down)
    nx, ny = math.cos(a), -math.sin(a)  # outward radial, screen coordinates
    s = w * 0.95 + 1.2
    tri(im, [(ex + tx * s * 1.5, ey + ty * s * 1.5), (ex + nx * s - tx * 0.6, ey + ny * s - ty * 0.6), (ex - nx * s - tx * 0.6, ey - ny * s - ty * 0.6)], head)

def play(im, x, y, h, c):
    tri(im, [(x, y), (x, y + h), (x + h * 0.85, y + h / 2)], c)

STONE = [(52, 50, 62, 255), (84, 82, 96, 255), (118, 116, 132, 255), (160, 158, 174, 255)]
GOLD = [(120, 84, 10, 255), (201, 162, 39, 255), (243, 215, 122, 255)]
BLUE = [(31, 95, 168, 255), (74, 163, 255, 255), (168, 216, 255, 255)]
GREEN = [(20, 110, 60, 255), (57, 211, 83, 255), (170, 250, 170, 255)]
FIRE = [(170, 50, 20, 255), (255, 159, 26, 255), (255, 230, 120, 255)]

def altar(im, top=19, gold=GOLD, stone=STONE):
    """Stepped stone altar: three slabs, lit from the top left, gold trim on the table."""
    s0, s1, s2, s3 = stone
    # bottom step
    rect(im, 3, 27, 28, 29, s1); rect(im, 3, 27, 28, 27, s2); rect(im, 24, 28, 28, 29, s0)
    # middle step
    rect(im, 6, 24, 25, 26, s1); rect(im, 6, 24, 25, 24, s2); rect(im, 22, 25, 25, 26, s0)
    # table body
    rect(im, 9, top + 2, 22, 23, s1); rect(im, 9, top + 2, 10, 23, s2); rect(im, 20, top + 2, 22, 23, s0)
    # table top slab with gold rim
    rect(im, 7, top, 24, top + 1, s3); rect(im, 7, top + 1, 24, top + 1, gold[1]); px(im, 7, top, s2); px(im, 24, top, s2)
    # carved notch on the front
    rect(im, 14, top + 3, 17, top + 4, s0)

def glow(im, cx, cy, r, c):
    for y in range(N):
        for x in range(N):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if d <= r and im.getpixel((x, y))[3] == 0 and (x + y) % 2 == 0:
                px(im, x, y, c[:3] + (110,))

def option_a():
    """Stone altar, a blue replay arrow floating above it."""
    im = canvas()
    altar(im)
    arc(im, 16, 9.5, 6, 6, 0, 359.99, (24, 30, 52, 255))  # dark orb inside the ring
    replay_arrow(im, 16, 9.5, 8, 2.6, BLUE[1], BLUE[2], BLUE[1])
    play(im, 14, 6, 6, GOLD[2])
    outline(im)
    return im

def option_b():
    """Altar with blue flames rising in a replay loop."""
    im = canvas()
    altar(im, top=20)
    replay_arrow(im, 16, 10, 9, 3, BLUE[0], BLUE[2], BLUE[1])
    # flame on the table
    tri(im, [(12, 19.5), (20, 19.5), (16, 11)], BLUE[1]); tri(im, [(14, 19.5), (18, 19.5), (16, 14)], BLUE[2])
    outline(im)
    return im

def option_c():
    """Gold replay arrow carved in the altar's front, green fel glow above (Warcraft 'altar' feel)."""
    im = canvas()
    s0, s1, s2, s3 = STONE
    rect(im, 3, 27, 28, 29, s1); rect(im, 3, 27, 28, 27, s2); rect(im, 24, 28, 28, 29, s0)
    rect(im, 5, 12, 26, 26, s1); rect(im, 5, 12, 26, 12, s3); rect(im, 5, 13, 6, 26, s2); rect(im, 24, 13, 26, 26, s0)
    rect(im, 4, 10, 27, 11, s3); rect(im, 4, 11, 27, 11, GOLD[1])
    replay_arrow(im, 15.5, 19.5, 6, 2.2, GOLD[1], GOLD[2], GOLD[1])
    # green flames on top
    for fx in (8, 16, 23):
        tri(im, [(fx - 2.5, 10), (fx + 2.5, 10), (fx, 3)], GREEN[1]); tri(im, [(fx - 1, 10), (fx + 1, 10), (fx, 6)], GREEN[2])
    outline(im)
    return im

def option_d():
    """Round badge: dark rune circle with a replay ring, a small gold altar inside."""
    im = canvas()
    arc(im, 16, 16, 15, 15, 0, 359.99, (28, 26, 36, 255))
    arc(im, 16, 16, 15, 1.2, 0, 359.99, GOLD[0])
    replay_arrow(im, 16, 16, 12.5, 2.4, FIRE[1], FIRE[2], FIRE[1])
    g0, g1, g2 = GOLD
    rect(im, 9, 21, 22, 22, g0); rect(im, 9, 21, 22, 21, g1)
    rect(im, 11, 18, 20, 20, g1); rect(im, 11, 18, 20, 18, g2); rect(im, 19, 19, 20, 20, g0)
    rect(im, 10, 16, 21, 17, g2); rect(im, 10, 17, 21, 17, g1)
    tri(im, [(13, 15.5), (19, 15.5), (16, 9)], FIRE[1]); tri(im, [(14.5, 15.5), (17.5, 15.5), (16, 12)], FIRE[2])
    outline(im)
    return im

def option_e():
    """Altar of Kings style: twin pillars with a replay ring and play button glowing between them."""
    im = canvas()
    s0, s1, s2, s3 = STONE
    rect(im, 2, 27, 29, 29, s1); rect(im, 2, 27, 29, 27, s2); rect(im, 25, 28, 29, 29, s0)
    for x0 in (3, 24):
        rect(im, x0, 9, x0 + 4, 26, s1); rect(im, x0, 9, x0, 26, s2); rect(im, x0 + 4, 9, x0 + 4, 26, s0)
        rect(im, x0 - 1, 7, x0 + 5, 8, s3); rect(im, x0 - 1, 8, x0 + 5, 8, GOLD[1])
    rect(im, 8, 9, 23, 22, (30, 30, 40, 255))  # dark recess between the pillars
    rect(im, 9, 23, 22, 26, s1); rect(im, 9, 23, 22, 23, s2); rect(im, 20, 24, 22, 26, s0)
    replay_arrow(im, 15.5, 14.5, 7.5, 2.4, BLUE[1], BLUE[2], BLUE[1])
    play(im, 13, 11, 7, GOLD[2])
    outline(im)
    return im

def option_f():
    """Hero-icon style: a framed square button (like the game's command card) with altar and arrow."""
    im = canvas()
    rect(im, 0, 0, 31, 31, GOLD[0]); rect(im, 1, 1, 30, 30, GOLD[1]); rect(im, 2, 2, 29, 29, (16, 22, 40, 255))
    for y in range(3, 29):
        for x in range(3, 29):
            t = y / 28
            px(im, x, y, (int(20 + 30 * (1 - t)), int(30 + 40 * (1 - t)), int(60 + 70 * (1 - t)), 255))
    g = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    s0, s1, s2, s3 = STONE
    rect(g, 6, 24, 25, 26, s1); rect(g, 6, 24, 25, 24, s2); rect(g, 22, 25, 25, 26, s0)
    rect(g, 9, 21, 22, 23, s1); rect(g, 9, 21, 10, 23, s2); rect(g, 20, 21, 22, 23, s0)
    rect(g, 7, 19, 24, 20, s3); rect(g, 7, 20, 24, 20, GOLD[1])
    arc(g, 16, 10.5, 5, 5, 0, 359.99, (16, 22, 40, 255))
    replay_arrow(g, 16, 10.5, 7, 2.4, BLUE[1], BLUE[2], BLUE[1])
    play(g, 14, 7.5, 6, GOLD[2])
    outline(g)
    im.alpha_composite(g)
    return im

OPTIONS = {"a-altar-floating-replay": option_a, "b-blue-flame-loop": option_b, "c-carved-gold-arrow": option_c, "d-round-badge": option_d, "e-pillars-replay-ring": option_e, "f-command-card-button": option_f}

def main():
    os.makedirs(OUT, exist_ok=True)
    icons = {}
    for name, fn in OPTIONS.items():
        im = fn()
        icons[name] = im
        im.save(os.path.join(OUT, f"{name}-32.png"))
        im.resize((512, 512), Image.NEAREST).save(os.path.join(OUT, f"{name}-512.png"))
    # Contact sheet: each option at 16, 32, 64 and 256 px, on dark and light backgrounds.
    sizes = [16, 32, 64, 256]
    pad = 24
    col_w = sum(sizes) + pad * (len(sizes) + 1)
    row_h = 256 + pad * 2
    sheet = Image.new("RGBA", (col_w * 2, row_h * len(icons) + 40), (255, 255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for half, bg in enumerate([(26, 26, 25, 255), (240, 239, 236, 255)]):
        d.rectangle([half * col_w, 0, (half + 1) * col_w, sheet.height], fill=bg)
    for i, (name, im) in enumerate(icons.items()):
        y = 40 + i * row_h + pad
        for half in range(2):
            x = half * col_w + pad
            for s in sizes:
                sheet.alpha_composite(im.resize((s, s), Image.NEAREST), (x, y + (256 - s) // 2))
                x += s + pad
        d.text((8, 40 + i * row_h + 4), name, fill=(200, 200, 200, 255))
    d.text((8, 12), "Replay Altar icon options: 16 / 32 / 64 / 256 px, dark and light backgrounds", fill=(220, 220, 220, 255))
    sheet.save(os.path.join(OUT, "contact-sheet.png"))
    print("wrote", os.path.abspath(OUT))

def final():
    im = option_e()
    # Scalable: one rectangle per run of same-coloured pixels in a row, kept sharp at any size.
    rects = []
    for y in range(N):
        x = 0
        while x < N:
            c = im.getpixel((x, y))
            run = 1
            while x + run < N and im.getpixel((x + run, y)) == c:
                run += 1
            if c[3]:
                r, g, b, a = c
                opacity = f' fill-opacity="{a / 255:.2f}"' if a < 255 else ""
                rects.append(f'<rect x="{x}" y="{y}" width="{run}" height="1" fill="#{r:02x}{g:02x}{b:02x}"{opacity}/>')
            x += run
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {N} {N}" shape-rendering="crispEdges">\n' + "\n".join(rects) + "\n</svg>\n"
    open(os.path.join(ASSETS, "replay-altar.svg"), "w").write(svg)
    # Exact multiples of the grid stay pixel-perfect; 16, 24 and 48 average the pixels instead.
    def at(size):
        return im.resize((size, size), Image.NEAREST if size % N == 0 else Image.BOX)
    os.makedirs(os.path.join(ASSETS, "icons"), exist_ok=True)
    for size in (16, 24, 32, 48, 64, 128, 256, 512):
        at(size).save(os.path.join(ASSETS, "icons", f"{size}.png"))
    sizes = (16, 24, 32, 48, 64, 128, 256)
    at(256).save(os.path.join(ASSETS, "replay-altar.ico"), sizes=[(z, z) for z in sizes], append_images=[at(z) for z in sizes[:-1]])
    print("wrote", os.path.abspath(ASSETS))

if "--options" in sys.argv:
    main()
else:
    final()
