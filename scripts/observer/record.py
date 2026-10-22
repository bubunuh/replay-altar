#!/usr/bin/env python3
# Research: records Warcraft III's observer API (the War3StatsObserverSharedMemory block) while the
# game shows a replay, one sample per game second, to a JSON-lines file. Linux under Wine/Proton:
# the block is a memfd held by the game, opened through /proc (the approach of github.com/estubmo/
# w3scope, MIT; layout from github.com/sides/war3structs, MIT). The game only fills the block for an
# observer (a replay counts); while you play, every player field stays zero.
#
#   python3 scripts/observer/record.py out.jsonl [--timeout 3600]     one replay
#   python3 scripts/observer/record.py <folder> [--timeout 3600]      every replay watched, a file each
import json
import mmap
import os
import struct
import sys
import time

ID, ART, NAME, GSTR, MAX = 4, 100, 36, 256, 999
UNIT = ID + 100 + 4 + 4 + 4 + ART + 1 + 1 + 4 + 4 + 4  # 230
RESEARCH = ID + 100 + 4 + 1 + ART  # 209
UPGRADE = ID + 100 + 4 + 4 + 4 + ART  # 216
BUILDING = ID + 100 + 4 + 4 + ART  # 212
ITEM = ID + 100 + 4 + 4 + ART  # 212
ABILITY = ID + 36 + 4 + 4 + 4 + ART + 1 + 4 + 4  # 161
HERO = ID + ART + ART + 19 * 4 + 24 * ABILITY + 4 + 6 * ITEM  # 5420
HEAD = NAME + 6 + 4 + 3 + 12 * 4  # 97
PLAYER = HEAD + 4 + MAX * HERO + 4 + MAX * BUILDING + 4 + MAX * UPGRADE + 4 + MAX * UNIT + 4 + MAX * RESEARCH + 4 + MAX * 136 + 40
GAME = 4 + 1 + 4 + 1 + GSTR + GSTR  # 522
FILE = 4 + GAME + 28 * PLAYER + 4 + MAX * 1552
MAPPED = (FILE + 4095) // 4096 * 4096
assert HERO == 5420 and PLAYER == 6_416_738 and MAPPED == 181_223_424

RACES = {1: "H", 2: "O", 3: "U", 4: "N"}
TYPES = {1: "player", 2: "computer", 4: "observer"}
RESULTS = {0: "victory", 1: "defeat", 2: "tie", 3: "playing"}


def discover():
    """The game's observer mapping: a Wine memfd of the block's size, opened through /proc."""
    me = str(os.getpid())  # our own descriptor keeps an old mapping alive after the game closes
    for pid in filter(str.isdigit, os.listdir("/proc")):
        if pid == me:
            continue
        # The game's own descriptor: the wineserver keeps an old game's mapping after it closes.
        try:
            with open(f"/proc/{pid}/comm") as c:
                if not c.read().startswith("Warcraft III"):
                    continue
        except OSError:
            continue
        fd_dir = f"/proc/{pid}/fd"
        try:
            fds = os.listdir(fd_dir)
        except OSError:
            continue
        for fd in fds:
            path = f"{fd_dir}/{fd}"
            try:
                if not os.readlink(path).startswith("/memfd:wine-mapping"):
                    continue
                if os.stat(path).st_size != MAPPED:
                    continue
                f = os.open(path, os.O_RDWR)
            except OSError:
                continue
            return int(pid), mmap.mmap(f, MAPPED, mmap.MAP_SHARED, mmap.PROT_READ | mmap.PROT_WRITE)
    return None, None


def code(b):
    return bytes(b[::-1]).decode("ascii", "replace").strip("\0")


def text(b):
    return bytes(b).split(b"\0", 1)[0].decode("utf-8", "replace")


def game(m):
    refresh, in_game, t, count = struct.unpack_from("<IBIB", m, 4)
    return {"in_game": bool(in_game), "t": t, "players": count, "name": text(m[14:14 + GSTR]), "map": text(m[14 + GSTR:14 + 2 * GSTR])}


def player(m, i):
    o = 4 + GAME + i * PLAYER
    name = text(m[o:o + NAME])
    race_pref, race, pid, team, color, ptype = struct.unpack_from("<6B", m, o + NAME)
    handicap, result, slot, ai = struct.unpack_from("<IBBB", m, o + NAME + 6)
    (apm, apm_rt, gold, gold_mined, gold_taxed, gold_tax, lumber, lumber_harvested, lumber_taxed, lumber_tax,
     food_max, food) = struct.unpack_from("<12I", m, o + NAME + 13)
    p = o + HEAD
    heroes = []
    (n,) = struct.unpack_from("<I", m, p)
    for k in range(min(n, 24)):
        h = p + 4 + k * HERO
        f = struct.unpack_from("<19I", m, h + ID + 2 * ART)
        heroes.append({"id": code(m[h:h + ID]), "level": f[0], "xp": f[1], "hp": f[3], "hp_max": f[4], "deaths": f[12], "kills": f[13], "kills_heroes": f[15], "alive_ms": f[17]})
    p += 4 + MAX * HERO
    (n,) = struct.unpack_from("<I", m, p)
    buildings = [code(m[p + 4 + k * BUILDING:p + 4 + k * BUILDING + ID]) for k in range(min(n, MAX))]
    p += 4 + MAX * BUILDING
    (n,) = struct.unpack_from("<I", m, p)
    upgrades = []
    for k in range(min(n, MAX)):
        u = p + 4 + k * UPGRADE
        upgrades.append({"id": code(m[u:u + ID]), "level": struct.unpack_from("<I", m, u + ID + 100)[0]})
    p += 4 + MAX * UPGRADE
    (n,) = struct.unpack_from("<I", m, p)
    units = []
    for k in range(min(n, MAX)):
        u = p + 4 + k * UNIT
        owner, alive, total = struct.unpack_from("<3I", m, u + ID + 100)
        worker, busy = struct.unpack_from("<BB", m, u + ID + 100 + 12 + ART)
        dealt, received, healed = struct.unpack_from("<3I", m, u + ID + 100 + 12 + ART + 2)
        units.append({"id": code(m[u:u + ID]), "alive": alive, "total": total, "worker": bool(worker), "dealt": dealt, "received": received})
    return {
        "slot": i, "name": name, "race": RACES.get(race, race), "id": pid, "team": team, "type": TYPES.get(ptype, ptype),
        "result": RESULTS.get(result, result), "apm": apm, "gold": gold, "gold_mined": gold_mined, "lumber": lumber,
        "lumber_harvested": lumber_harvested, "food": food, "food_max": food_max, "heroes": heroes, "buildings": buildings,
        "upgrades": upgrades, "units": units,
    }


def attach(timeout_at):
    pid = m = None
    while m is None:
        pid, m = discover()
        if m is None:
            if time.time() > timeout_at:
                return None, None
            time.sleep(2)
    print(f"observer block found in pid {pid}; version {struct.unpack_from('<I', m, 0)[0]}", flush=True)
    return pid, m


def main():
    """`out` ending in .jsonl: one replay. Otherwise a folder: every replay watched, one file each, until
    the game closes or the timeout."""
    out = sys.argv[1]
    session = not out.endswith(".jsonl")
    timeout = float(sys.argv[sys.argv.index("--timeout") + 1]) if "--timeout" in sys.argv else 3600
    timeout_at = time.time() + timeout
    if session:
        os.makedirs(out, exist_ok=True)
    pid, m = attach(timeout_at)
    if m is None:
        sys.exit("no observer block found (is Warcraft III running?)")
    f = None
    names = None
    last_t = -1
    samples = 0
    recorded = 0
    while time.time() < timeout_at:
        try:
            # The game puts its own 2000 ms back when a replay starts: ask again whenever it differs.
            if struct.unpack_from("<I", m, 4)[0] != 100:
                struct.pack_into("<I", m, 4, 100)
            g = game(m)
        except (ValueError, OSError):
            g = {"in_game": False}
        players = None
        if g["in_game"]:
            players = [p for p in (player(m, i) for i in range(28)) if p["type"] in ("player", "computer")]
            if not players or not any(p["food"] or p["units"] for p in players):
                players = None
        now_names = tuple(p["name"] for p in players) if players else None
        # A replay ended (left, or another one started from the beginning).
        if f and (not g["in_game"] or (players and (now_names != names or g["t"] < last_t - 5000))):
            f.close()
            print(f"saved {samples} samples ({last_t // 60000}:{last_t // 1000 % 60:02d} of game)", flush=True)
            f = None
            if not session:
                break
        if players and g["t"] >= last_t + 500 or (players and f is None):
            if f is None:
                names, last_t, samples = now_names, -1, 0
                recorded += 1
                path = out if not session else os.path.join(out, f"{time.strftime('%Y%m%d-%H%M%S')}-{'-'.join(n.replace('/', '_') for n in names)}.jsonl")
                f = open(path, "a")
                print(f"recording {' vs '.join(names)} on {os.path.basename(g['map'])} -> {os.path.basename(path)}", flush=True)
            last_t = g["t"]
            f.write(json.dumps({"game": g, "players": players}) + "\n")
            f.flush()
            samples += 1
        if not os.path.exists(f"/proc/{pid}"):
            if f:
                f.close()
                print(f"saved {samples} samples (game closed)", flush=True)
                f = None
            if not session and recorded:
                break
            m.close()
            pid, m = attach(timeout_at)  # the game restarted (Battle.net login) or was started again
            if m is None:
                break
        time.sleep(0.05)
    if f:
        f.close()
    print(f"{recorded} replays recorded", flush=True)


if __name__ == "__main__":
    main()
