import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ReplayWatcher, type ScanResult } from "../src/watcher.ts";

// A Replays folder with an Autosaved subfolder (both watched, as the app does) and `n` replays,
// replay i being i days old (each one a different replay: copies count once).
function folder(n: number) {
  const root = mkdtempSync(join(tmpdir(), "ra-watch-"));
  const auto = join(root, "Autosaved");
  mkdirSync(auto);
  for (let i = 0; i < n; i++) {
    const file = join(auto, `Replay_${i}.w3g`);
    writeFileSync(file, `replay ${i}`);
    const t = Date.now() / 1000 - i * 86400;
    utimesSync(file, t, t);
  }
  return { root, auto };
}

function scan(dirs: string[], limit: number | null, known: (path: string) => boolean = () => false) {
  const scheduled: string[] = [];
  let result: ScanResult | null = null;
  const w = new ReplayWatcher(dirs, async () => {}, () => {}, { since: null, limit, known: (path) => known(path), onScan: (r) => (result = r) });
  // Count what would be read instead of waiting for files to settle.
  (w as unknown as { schedule: (p: string) => void }).schedule = (p: string) => scheduled.push(p);
  w.scanAll();
  return { scheduled, result: result! };
}

describe("importing replays", () => {
  test("only the newest ones up to the limit, each file once though the folders overlap", () => {
    const { root, auto } = folder(120);
    const { scheduled, result } = scan([root, auto], 50);
    expect(scheduled).toHaveLength(50);
    expect(scheduled).toContain(join(auto, "Replay_0.w3g"));
    expect(scheduled).not.toContain(join(auto, "Replay_50.w3g"));
    expect(result).toEqual({ found: 120, older: 70 });
  });

  test("imported files aren't read again; all of them when there's no limit", () => {
    const { root, auto } = folder(10);
    const known = (p: string) => /Replay_[0-4]\.w3g$/.test(p);
    expect(scan([root, auto], 50, known).scheduled).toHaveLength(5);
    const { scheduled, result } = scan([root], null, known);
    expect(scheduled).toHaveLength(5);
    expect(result).toEqual({ found: 10, older: 0 });
  });

  test("copies of one replay count once and take one place in the limit", () => {
    const { root, auto } = folder(10);
    // LastReplay.w3g and the copy saved from the score screen: the same bytes.
    writeFileSync(join(root, "LastReplay.w3g"), "replay 0");
    writeFileSync(join(root, "Replay_0_saved.w3g"), "replay 0");
    const { scheduled, result } = scan([root, auto], 2);
    expect(result).toEqual({ found: 10, older: 8 });
    // Both copies of the newest game, then the next game.
    expect(scheduled.map((p) => p.slice(root.length + 1)).sort()).toEqual(["Autosaved/Replay_0.w3g", "Autosaved/Replay_1.w3g", "LastReplay.w3g", "Replay_0_saved.w3g"]);
  });
});
