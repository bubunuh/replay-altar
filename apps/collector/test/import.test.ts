// Nothing is imported until you ask (0.2.2): on a new install a scan imports no replay that was in
// the folders before the first start, only the games played since; an update keeps the newest 50
// it imported by itself before, so its match list doesn't change.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, firstStart, firstStartFile, importLimit, ingestFile, openDb, paths, type Config } from "@replay-altar/core";
import { ReplayWatcher, type ScanResult } from "../src/watcher.ts";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/replays");
const DAY = 86_400_000;

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.REPLAY_ALTAR_DATA;
  process.env.REPLAY_ALTAR_DATA = mkdtempSync(join(tmpdir(), "ra-import-data-"));
});
afterEach(() => {
  if (saved === undefined) delete process.env.REPLAY_ALTAR_DATA;
  else process.env.REPLAY_ALTAR_DATA = saved;
});

/** A Replays folder whose replay i is i days older than `newest` (each one a different replay: copies count once). */
function folder(n: number, newest: number) {
  const dir = mkdtempSync(join(tmpdir(), "ra-import-replays-"));
  for (let i = 0; i < n; i++) {
    const file = join(dir, `Replay_${i}.w3g`);
    writeFileSync(file, `replay ${i}`);
    const t = (newest - i * DAY) / 1000;
    utimesSync(file, t, t);
  }
  return dir;
}

function scan(dir: string, since: Date, limit: number | null) {
  const scheduled: string[] = [];
  let result: ScanResult | null = null;
  const w = new ReplayWatcher([dir], async () => {}, () => {}, { since, limit, known: () => false, onScan: (r) => (result = r) });
  (w as unknown as { schedule: (p: string) => void }).schedule = (p: string) => scheduled.push(p);
  w.scanAll();
  return { scheduled, result: result! };
}

const config = (change: Partial<Config> = {}): Config => ({ ...DEFAULT_CONFIG, ...change });

describe("first start", () => {
  test("a new install: nothing imported, the replays found are offered", () => {
    const start = firstStart(openDb(paths().db));
    expect(start.updated).toBe(false);
    expect(importLimit(config(), start)).toBe(0);
    const dir = folder(120, Date.parse(start.at) - 60_000);
    const { scheduled, result } = scan(dir, new Date(start.at), importLimit(config(), start));
    expect(scheduled).toEqual([]);
    expect(result).toEqual({ found: 120, older: 120 });
  });

  test("games played after the first start are imported by themselves, also when the collector wasn't running", () => {
    const start = firstStart(null);
    const dir = folder(30, Date.parse(start.at) - 60_000);
    // Two games played later (e.g. while the window was closed), and LastReplay.w3g rewritten.
    for (const name of ["Replay_new1.w3g", "Replay_new2.w3g", "LastReplay.w3g"]) {
      writeFileSync(join(dir, name), `game ${name}`);
      const t = (Date.parse(start.at) + 3_600_000) / 1000;
      utimesSync(join(dir, name), t, t);
    }
    const { scheduled, result } = scan(dir, new Date(start.at), 0);
    expect(scheduled.map((p) => p.slice(dir.length + 1)).sort()).toEqual(["LastReplay.w3g", "Replay_new1.w3g", "Replay_new2.w3g"]);
    expect(result).toEqual({ found: 33, older: 30 });
  });

  test("Import 50 replays / Import all: the newest older ones, then every one", () => {
    const start = firstStart(null);
    const dir = folder(120, Date.parse(start.at) - 60_000);
    const fifty = scan(dir, new Date(start.at), importLimit(config({ importLimit: 50 }), start));
    expect(fifty.scheduled).toHaveLength(50);
    expect(fifty.scheduled).toContain(join(dir, "Replay_0.w3g"));
    expect(fifty.scheduled).not.toContain(join(dir, "Replay_50.w3g"));
    expect(scan(dir, new Date(start.at), importLimit(config({ importLimit: "all" }), start)).scheduled).toHaveLength(120);
  });

  test.skipIf(!existsSync(join(FIXTURES, "replay1.w3g")))("an update from 0.2.1 keeps importing the newest 50", async () => {
    const p = paths();
    const db = openDb(p.db);
    const inbox = join(p.root, "inbox");
    mkdirSync(inbox);
    copyFileSync(join(FIXTURES, "replay1.w3g"), join(inbox, "replay1.w3g"));
    expect((await ingestFile({ db, config: config({ accounts: [] }), paths: p }, join(inbox, "replay1.w3g"))).status).toBe("new");
    const start = firstStart(db);
    expect(start.updated).toBe(true);
    expect(importLimit(config(), start)).toBe(50);
    // The same 50 as 0.2.1's first start chose: the newest of the replays already there.
    const dir = folder(120, Date.parse(start.at) - 60_000);
    const { scheduled, result } = scan(dir, new Date(start.at), importLimit(config(), start));
    expect(scheduled).toHaveLength(50);
    expect(result).toEqual({ found: 120, older: 70 });
    // A limit raised before the update ("Import 50 more", "Import all") stays.
    expect(importLimit(config({ importLimit: 100 }), start)).toBe(100);
    expect(importLimit(config({ importLimit: "all" }), start)).toBe(null);
  });

  test("decided once: later starts read it back, whatever the database holds by then", () => {
    const first = firstStart(null);
    expect(JSON.parse(readFileSync(firstStartFile(), "utf8"))).toEqual(first);
    const db = openDb(paths().db);
    expect(firstStart(db)).toEqual(first);
  });

  test("a file event on an older replay (OneDrive touching it, a copy keeping its date) waits for Import like the others", () => {
    const start = firstStart(null);
    const dir = folder(3, Date.parse(start.at) - 60_000);
    const scheduled: string[] = [];
    const watcher = (limit: number | null) => {
      const w = new ReplayWatcher([dir], async () => {}, () => {}, { since: new Date(start.at), limit, known: () => false });
      (w as unknown as { schedule: (p: string) => void }).schedule = (p: string) => scheduled.push(p);
      return w;
    };
    watcher(0).onEvent(join(dir, "Replay_1.w3g"));
    expect(scheduled).toEqual([]);
    // A game that just ended.
    writeFileSync(join(dir, "LastReplay.w3g"), "a new game");
    utimesSync(join(dir, "LastReplay.w3g"), (Date.parse(start.at) + 60_000) / 1000, (Date.parse(start.at) + 60_000) / 1000);
    watcher(0).onEvent(join(dir, "LastReplay.w3g"));
    expect(scheduled).toEqual([join(dir, "LastReplay.w3g")]);
    // "Import all": every replay is wanted anyway.
    watcher(null).onEvent(join(dir, "Replay_2.w3g"));
    expect(scheduled).toContain(join(dir, "Replay_2.w3g"));
    // An imported file read again (Windows reports its last-access time): nothing to do.
    scheduled.length = 0;
    const w = new ReplayWatcher([dir], async () => {}, () => {}, { since: new Date(start.at), limit: null, known: () => "game" });
    (w as unknown as { schedule: (p: string) => void }).schedule = (p: string) => scheduled.push(p);
    w.onEvent(join(dir, "LastReplay.w3g"));
    expect(scheduled).toEqual([]);
  });
});
