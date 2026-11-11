#!/usr/bin/env python3
# Research: watches every replay of a recording batch by itself and records the game's observer data
# (record.py) for each, so nobody has to click through them. Linux, KDE Wayland, the game under
# Wine/Proton, maximized on a 3840x2160 screen (the click positions below are fractions of the screen,
# measured there). Input goes through /dev/uinput (python-evdev): an absolute pointer and a keyboard.
#
# Before starting: open Warcraft III, go to Replays and open the batch's folder. Leave the PC alone
# while it runs: the game only plays a replay while its window has the focus (the script gives the
# focus back every time it clicks, and whenever the replay stops advancing). Another window that covers
# the game must be open (--away, a part of its caption; default Konsole; the script maximizes it): see
# Input.focus.
#
#   python3 scripts/observer/watch.py <batch folder with manifest.json> [--speed 8] [--only 03,07] [--redo] [--away Konsole]
#
# Each manifest entry needs `file`; the replay is found by typing the file's first word (up to the
# first "_") into the list's Quick Filter, so that word must be unique in the folder and made of
# letters and digits (download-mixed.ts names them zq01_, zq02_, ...). Writes
# recordings/<file without .w3g>.jsonl and watch.log; a replay that doesn't start within 90 s, or whose
# recording stops before 90% of its length (a desync, mostly), is listed as failed and the script goes on.
import json
import os
import struct
import subprocess
import sys
import tempfile
import time

from evdev import AbsInfo, UInput, ecodes as e

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import record  # noqa: E402

W, H = 3840, 2160
FILTER = (0.599, 0.156)  # the Quick Filter box
ROW = (0.365, 0.339)  # the first replay row in a folder (under "..")
WATCH = (0.841, 0.746)
BACK = (0.056, 0.908)  # on the Match Results screen
GAME_WINDOW = "^Warcraft III"
AWAY = "Konsole"  # --away: the caption of a window that covers the game, to hand the focus to and back


def arg(name, fallback):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else fallback


class Input:
    def __init__(self):
        self.ui = None
        self.reset()

    def reset(self):
        """A new input device. After a replay the game ignores the pointer of the device it knew before."""
        if self.ui:
            self.ui.close()
            time.sleep(0.5)
        cap = {e.EV_KEY: [e.BTN_LEFT, e.BTN_RIGHT] + list(range(1, 120)),
               e.EV_ABS: [(e.ABS_X, AbsInfo(0, 0, W - 1, 0, 0, 0)), (e.ABS_Y, AbsInfo(0, 0, H - 1, 0, 0, 0))]}
        self.ui = UInput(cap, name="replay-altar-watcher")
        time.sleep(1.5)  # the compositor has to pick the device up

    def kwin(self, js):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
            f.write(js)
        try:
            sid = subprocess.run(["qdbus", "org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.loadScript", f.name, f"ra-watch-{os.getpid()}-{time.time()}"],
                                 capture_output=True, text=True).stdout.strip()
            subprocess.run(["qdbus", "org.kde.KWin", f"/Scripting/Script{sid}", "org.kde.kwin.Script.run"], capture_output=True)
            time.sleep(0.4)
            subprocess.run(["qdbus", "org.kde.KWin", f"/Scripting/Script{sid}", "org.kde.kwin.Script.stop"], capture_output=True)
        finally:
            os.unlink(f.name)

    def activate(self, caption):
        self.kwin(f'const re = new RegExp("{caption}");\n'
                  "for (const w of workspace.windowList()) if (re.test(w.caption)) { workspace.activeWindow = w; break; }\n")

    def focus(self, flip=False):
        """Focuses the game window (a KWin script). With `flip`, another window (--away, default Konsole)
        gets the focus first for a moment: after a replay the game takes no pointer events until a window
        that covers it has had the focus. Keys always arrive."""
        if flip:
            self.activate(AWAY)
            time.sleep(1.5)
        self.activate(GAME_WINDOW)
        time.sleep(0.8)

    def move(self, pos):
        x, y = int(pos[0] * W), int(pos[1] * H)
        for d in (6, 3, 0):
            self.ui.write(e.EV_ABS, e.ABS_X, x + d)
            self.ui.write(e.EV_ABS, e.ABS_Y, y + d)
            self.ui.syn()
            time.sleep(0.08)

    def click(self, pos):
        self.focus(flip=True)
        self.move(pos)
        time.sleep(0.25)
        self.ui.write(e.EV_KEY, e.BTN_LEFT, 1)
        self.ui.syn()
        time.sleep(0.2)
        self.ui.write(e.EV_KEY, e.BTN_LEFT, 0)
        self.ui.syn()
        time.sleep(0.5)

    def key(self, name, times=1):
        k = getattr(e, "KEY_" + name.upper())
        for _ in range(times):
            self.ui.write(e.EV_KEY, k, 1)
            self.ui.syn()
            time.sleep(0.05)
            self.ui.write(e.EV_KEY, k, 0)
            self.ui.syn()
            time.sleep(0.12)

    def type(self, text):
        for ch in text:
            self.key(ch)


class Game:
    """The observer block, found again when the game restarts."""

    def __init__(self):
        self.pid, self.m = record.discover()
        if self.m is None:
            sys.exit("no observer block found (is Warcraft III running?)")

    def state(self):
        m = self.m
        if struct.unpack_from("<I", m, 4)[0] != 100:
            struct.pack_into("<I", m, 4, 100)
        g = record.game(m)
        players = None
        if g["in_game"]:
            players = [p for p in (record.player(m, i) for i in range(28)) if p["type"] in ("player", "computer")]
            if not players or not any(p["food"] or p["units"] for p in players):
                players = None
        return g, players


def log(batch, text):
    line = f"{time.strftime('%H:%M:%S')} {text}"
    print(line, flush=True)
    with open(os.path.join(batch, "watch.log"), "a") as f:
        f.write(line + "\n")


def screenshot(batch, name):
    os.makedirs(os.path.join(batch, "failed"), exist_ok=True)
    subprocess.run(["spectacle", "-b", "-n", "-f", "-o", os.path.join(batch, "failed", name + ".png")], capture_output=True)


def on_results(inp):
    """Whether the screen shows Match Results (its parchment), from a screenshot: the observer data can't tell."""
    from PIL import Image
    inp.focus()
    path = os.path.join(tempfile.gettempdir(), f"ra-watch-{os.getpid()}.png")
    subprocess.run(["spectacle", "-b", "-n", "-f", "-o", path], capture_output=True)
    try:
        im = Image.open(path).convert("RGB")
        px = [im.getpixel((int(x * im.width), int(0.62 * im.height))) for x in (0.2, 0.35, 0.5)]
    finally:
        if os.path.exists(path):
            os.unlink(path)
    return all(r > 110 and r > b + 35 for r, g, b in px)


def leave(inp, game):
    """From a running or finished replay back to the replay list. False if Match Results won't close."""
    inp.focus()
    inp.key("F10")
    time.sleep(0.8)
    inp.key("E")  # End Game
    time.sleep(0.8)
    inp.key("Q")  # Quit Mission
    until = time.time() + 20
    while time.time() < until and game.state()[0]["in_game"]:
        time.sleep(0.5)
    time.sleep(4)
    for _ in range(5):
        if not on_results(inp):
            return True
        # Escape closes Match Results. The Back button is the fallback: the pointer often doesn't
        # reach the game after a replay, whatever window had the focus before.
        inp.key("ESC")
        time.sleep(3)
        if not on_results(inp):
            return True
        inp.reset()
        inp.click(BACK)
        time.sleep(3)
    return not on_results(inp)


def watch(inp, game, batch, entry, speed):
    stem = entry["file"][:-4]
    token = stem.split("_")[0]
    out = os.path.join(batch, "recordings", stem + ".jsonl")
    if game.state()[0]["in_game"] and not leave(inp, game):
        return None
    inp.click(FILTER)
    inp.key("END")
    inp.key("BACKSPACE", 24)
    inp.type(token)
    time.sleep(1.2)
    inp.click(ROW)
    inp.click(WATCH)
    until = time.time() + 90
    players = None
    while time.time() < until and not players:
        time.sleep(0.5)
        g, players = game.state()
    if not players:
        screenshot(batch, stem + "-nostart")
        log(batch, f"{stem}: FAILED, did not start")
        return False
    # A replay the game doesn't list (its map is missing) leaves the list's last selection in place,
    # and Watch then plays that one.
    if entry.get("names") and {p["name"] for p in players} != {n.split("#")[0] for n in entry["names"]}:
        log(batch, f"{stem}: FAILED, the game opened another replay (is this one in its list?)")
        return False if leave(inp, game) else None
    # Speed: each "=" doubles it (1, 2, 4 ... 64); checked against the game's own clock.
    inp.focus()
    presses = max(0, speed.bit_length() - 1)
    inp.key("EQUAL", presses)
    f = open(out, "w")
    last_t, samples, stalled_since, last_progress_t = -1, 0, None, time.time()
    rate_t0, rate_g0, checked = time.time() + 2, None, False
    ended = None
    while True:
        try:
            g, players = game.state()
        except (ValueError, OSError):
            break
        if not g["in_game"] or not players:
            break
        now = time.time()
        if g["t"] >= last_t + 500:
            last_t = g["t"]
            f.write(json.dumps({"game": g, "players": players}) + "\n")
            samples += 1
            last_progress_t = now
        if not checked and now >= rate_t0:
            if rate_g0 is None:
                rate_g0 = (now, g["t"])
            elif now - rate_g0[0] >= 4:
                rate = (g["t"] - rate_g0[1]) / 1000 / (now - rate_g0[0])
                checked = True
                if rate < speed * 0.4:
                    log(batch, f"{stem}: speed x{rate:.1f}, wanted x{speed}: one more step")
                    inp.focus()
                    inp.key("EQUAL")
        finished = any(p["result"] != "playing" for p in players)
        if finished and ended is None:
            ended = now
        if ended is not None and now - ended > 1.5:
            break
        if now - last_progress_t > 15:  # stopped advancing: lost the focus, or the replay is over
            if stalled_since is None:
                stalled_since = now
                inp.focus()
                last_progress_t = now
            else:
                break
        time.sleep(0.05)
    f.close()
    length = entry.get("durationMs") or entry.get("dur", 0) * 60000
    # A result minutes before the file's end is no proof of a good recording: a replay the game plays
    # back wrong (a desync) ends early with one too.
    ok = samples > 20 and (not length or last_t >= 0.9 * length - 60000)
    log(batch, f"{stem}: {'ok' if ok else 'FAILED, stopped early'}, {samples} samples to {last_t // 60000}:{last_t // 1000 % 60:02d}"
        + (f" of {length // 60000}:{length // 1000 % 60:02d}" if length else ""))
    if not ok:
        screenshot(batch, stem + "-early")
        os.replace(out, out + ".failed")
    if not leave(inp, game):
        return None
    return ok


def main():
    batch = os.path.expanduser(sys.argv[1])
    global AWAY
    AWAY = arg("--away", AWAY)
    speed = int(arg("--speed", "8"))
    only = set(filter(None, arg("--only", "").split(",")))
    manifest = json.load(open(os.path.join(batch, "manifest.json")))
    os.makedirs(os.path.join(batch, "recordings"), exist_ok=True)
    game, inp = Game(), Input()
    # The away window must cover the whole game: where it doesn't, the game takes no clicks after a replay.
    inp.kwin(f'const re = new RegExp("{AWAY}");\n'
             "for (const w of workspace.windowList()) if (re.test(w.caption)) { w.setMaximize(true, true); break; }\n")
    done = failed = 0
    for entry in manifest:
        stem = entry["file"][:-4]
        if only and not any(stem.startswith(o) or stem.split("_")[0].endswith(o) for o in only):
            continue
        if os.path.exists(os.path.join(batch, "recordings", stem + ".jsonl")) and "--redo" not in sys.argv:
            continue
        if os.path.exists(os.path.join(batch, "recordings", stem + ".jsonl.desync")):  # set aside by hand: the game plays it wrong
            continue
        if not os.path.exists(f"/proc/{game.pid}"):
            log(batch, "the game closed: stopping")
            break
        result = watch(inp, game, batch, entry, speed)
        if result is None:
            screenshot(batch, stem + "-stuck")
            log(batch, "Match Results does not close: stopping")
            break
        if result:
            done += 1
        else:
            failed += 1
    log(batch, f"finished: {done} recorded, {failed} failed")
    inp.ui.close()


if __name__ == "__main__":
    main()
