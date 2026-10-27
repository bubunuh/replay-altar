// A version that reads games differently starts the match list over (core analysis.ts): kept
// what can't be made again, rebuilt the games, and every replay (the archive's copies too, for
// games whose LastReplay.w3g was overwritten) counted once and imported again on request.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  addAnnotation,
  analysisFile,
  ANALYSIS_VERSION,
  applyOfficial,
  archiveIndexFile,
  DEFAULT_CONFIG,
  firstStart,
  importLimit,
  ingestFile,
  loadConfig,
  openDb,
  paths,
  previousDbFile,
  readRecord,
  saveConfig,
  startOverIfNewAnalysis,
  type Config,
  type DB,
  type OfficialStats,
} from "@replay-altar/core";
import { ReplayWatcher, type ScanResult } from "../src/watcher.ts";
import { archiveLookup } from "../src/archive.ts";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/replays");
const DAY = 86_400_000;
const have = [1, 2, 3, 4].every((i) => existsSync(join(FIXTURES, `replay${i}.w3g`)));

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ["REPLAY_ALTAR_DATA", "REPLAY_ALTAR_CONFIG"]) saved[k] = process.env[k];
  process.env.REPLAY_ALTAR_DATA = mkdtempSync(join(tmpdir(), "ra-over-data-"));
  process.env.REPLAY_ALTAR_CONFIG = join(mkdtempSync(join(tmpdir(), "ra-over-config-")), "config.json");
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** Copies fixture replay `n` to `file`, dated `t` (ms). */
function put(n: number, file: string, t: number) {
  copyFileSync(join(FIXTURES, `replay${n}.w3g`), file);
  utimesSync(file, t / 1000, t / 1000);
}

/** A scan as the collector makes it (watcher + archive), with what it would import. */
function scan(db: DB, dirs: string[], since: Date, limit: number | null) {
  const p = paths();
  const knownFile = db.prepare("SELECT game_key FROM files WHERE path = ? AND size = ? AND mtime = ? UNION ALL SELECT game_key FROM games WHERE archive_path = ? LIMIT 1");
  const scheduled: string[] = [];
  let result: ScanResult | null = null;
  const w = new ReplayWatcher(dirs, async () => {}, () => {}, {
    since,
    limit,
    known: (path, size, mtime) => (knownFile.get(path, size, mtime, path) as { game_key: string } | undefined)?.game_key ?? null,
    onScan: (r) => (result = r),
    archive: { dir: p.archive, lookup: archiveLookup(p) },
  });
  (w as unknown as { schedule: (p: string) => void }).schedule = (path: string) => scheduled.push(path);
  w.scanAll();
  return { scheduled, result: result! };
}

const archived = () => readdirSync(paths().archive, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".w3g")).map((e) => join(e.parentPath, e.name));

describe.skipIf(!have)("start over for a new analysis", () => {
  test("keeps what can't be made again, rebuilds the games, imports every replay again on request", async () => {
    const p = paths();
    const config: Config = { ...DEFAULT_CONFIG, accounts: ["Pedrovisk#1486"], importLimit: "all", collectorMode: "always" };
    saveConfig(config);
    let db = openDb(p.db);
    const ctx = { db, config, paths: p };
    const replays = mkdtempSync(join(tmpdir(), "ra-over-replays-"));
    const old = Date.now() - 10 * DAY;
    put(1, join(replays, "Replay_1.w3g"), old);
    put(2, join(replays, "Replay_2.w3g"), old + DAY);
    put(3, join(replays, "LastReplay.w3g"), old + 2 * DAY);
    const keys: string[] = [];
    for (const f of ["Replay_1.w3g", "Replay_2.w3g", "LastReplay.w3g"]) {
      const out = await ingestFile(ctx, join(replays, f));
      if (out.status !== "new") throw new Error(`${f}: ${out.status}`);
      keys.push(out.record.gameKey);
    }
    const [k1, k2, k3] = keys;
    const before = new Map((db.prepare("SELECT game_key, played_at, ended_at, archive_path FROM games").all() as { game_key: string; played_at: string; ended_at: string; archive_path: string }[]).map((r) => [r.game_key, r]));
    // Things that can't be made again: a result corrected by hand, W3Champions' statistics.
    addAnnotation(db, { gameKey: k1, kind: "result_override", source: "user", body: { result: "win" } });
    const official: OfficialStats = { status: "ok", source: "w3champions", matchId: "m-1", fetchedAt: new Date().toISOString(), players: [] };
    applyOfficial(ctx, k2, official);
    // (Only W3Champions games have them; these fixtures are Battle.net games.)
    db.prepare("UPDATE games SET source = 'w3champions' WHERE game_key = ?").run(k2);
    // Rebuilt: simulations. Kept: game data, maps, pictures, the Analyzer page's replays.
    for (const f of ["sim/out/x.wc3v.gz", "sim/gamedata/current/manifest.json", "sim/maps/m/mapdata/a", "maps/m.w3x", "ui/races/human.png", "analyzer/abc-p1/analyzed.json"]) {
      mkdirSync(join(p.root, f, ".."), { recursive: true });
      writeFileSync(join(p.root, f), "x");
    }
    // The next game overwrote LastReplay.w3g (that game is in the folders, not imported yet): game 3
    // is left only in the archive.
    put(4, join(replays, "LastReplay.w3g"), old + 3 * DAY);
    db.close();

    const over = startOverIfNewAnalysis(p);
    expect(over).toMatchObject({ games: 3, archived: 3, officialKept: 1, backup: previousDbFile(p) });
    expect(over!.freedBytes).toBeGreaterThan(0);
    expect(startOverIfNewAnalysis(p)).toBeNull(); // once
    expect(JSON.parse(readFileSync(analysisFile(p), "utf8")).version).toBe(ANALYSIS_VERSION);

    // Rebuilt.
    for (const d of ["games", "raw", "sim/out"]) expect(existsSync(join(p.root, d))).toBe(false);
    db = openDb(p.db);
    expect(db.prepare("SELECT COUNT(*) AS n FROM games").get()).toEqual({ n: 0 });
    // Kept.
    for (const f of ["sim/gamedata/current/manifest.json", "sim/maps/m/mapdata/a", "maps/m.w3x", "ui/races/human.png", "analyzer/abc-p1/analyzed.json"]) expect(existsSync(join(p.root, f))).toBe(true);
    expect(archived()).toHaveLength(3);
    expect(db.prepare("SELECT kind, game_key FROM annotations").all()).toEqual([{ kind: "result_override", game_key: k1 }]);
    const backup = openDb(previousDbFile(p), { readOnly: true });
    expect(backup.prepare("SELECT COUNT(*) AS n FROM games").get()).toEqual({ n: 3 });
    backup.close();
    expect(Object.keys(JSON.parse(readFileSync(archiveIndexFile(p), "utf8")).bySha)).toHaveLength(3);
    const settings = loadConfig();
    expect(settings.accounts).toEqual(["Pedrovisk#1486"]);
    expect(settings.collectorMode).toBe("always");
    expect(settings.importLimit).toBeUndefined();

    // As after a first start: nothing older imported by itself; game 3 counted from its copy, the
    // copies of games 1 and 2 not counted again.
    const start = firstStart(db);
    expect(start).toMatchObject({ updated: false, startedOver: ANALYSIS_VERSION });
    expect(importLimit(settings, start)).toBe(0);
    const since = new Date(start.at);
    expect(scan(db, [replays], since, 0)).toEqual({ scheduled: [], result: { found: 4, older: 4 } });
    // A game played after the start-over is imported by itself.
    put(5, join(replays, "Replay_new.w3g"), Date.now() + 60_000);
    expect(scan(db, [replays], since, 0)).toEqual({ scheduled: [join(replays, "Replay_new.w3g")], result: { found: 5, older: 4 } });

    // "Import all replays": every game back, game 3 from its archived copy, with its date and no new copy.
    const all = scan(db, [replays], since, null);
    expect(all.result).toEqual({ found: 5, older: 0 });
    const copy3 = before.get(k3)!.archive_path;
    expect(all.scheduled.sort()).toEqual([copy3, ...["LastReplay.w3g", "Replay_1.w3g", "Replay_2.w3g", "Replay_new.w3g"].map((f) => join(replays, f))].sort());
    const again = { db, config: settings, paths: p };
    for (const f of all.scheduled) expect((await ingestFile(again, f)).status).toBe("new");
    expect(db.prepare("SELECT COUNT(*) AS n FROM games").get()).toEqual({ n: 5 });
    for (const k of keys) {
      const row = db.prepare("SELECT played_at, ended_at, archive_path FROM games WHERE game_key = ?").get(k);
      expect(row).toEqual({ played_at: before.get(k)!.played_at, ended_at: before.get(k)!.ended_at, archive_path: before.get(k)!.archive_path });
    }
    expect(archived()).toHaveLength(5); // the old three, and copies of the two games new to it
    // What was kept comes back with its game.
    expect(readRecord(p, k2)?.official).toEqual(official);
    expect(db.prepare("SELECT result FROM v_games WHERE game_key = ?").get(k1)).toEqual({ result: "win" });
    // Nothing left to import, and a later scan reads nothing again.
    expect(scan(db, [replays], since, null)).toEqual({ scheduled: [], result: { found: 5, older: 0 } });
  });

  test("a new install, or a copy without games, has nothing to start over", () => {
    const p = paths();
    expect(startOverIfNewAnalysis(p)).toBeNull();
    expect(JSON.parse(readFileSync(analysisFile(p), "utf8")).version).toBe(ANALYSIS_VERSION);
    expect(existsSync(previousDbFile(p))).toBe(false);
    expect(firstStart(openDb(p.db)).startedOver).toBeUndefined();
  });

  test("an archived copy with the same content as a replay in the folders counts once, also without the index", async () => {
    const p = paths();
    const db = openDb(p.db);
    const replays = mkdtempSync(join(tmpdir(), "ra-over-replays-"));
    put(1, join(replays, "Replay_1.w3g"), Date.now() - DAY);
    // A copy in the archive the index doesn't know (e.g. kept unparsed by an older version).
    mkdirSync(join(p.archive, "unparsed"), { recursive: true });
    put(1, join(p.archive, "unparsed", "0123456789ab_Replay_1.w3g"), Date.now() - DAY);
    put(2, join(p.archive, "unparsed", "ba9876543210_LastReplay.w3g"), Date.now() - 2 * DAY);
    const { scheduled, result } = scan(db, [replays], new Date(), null);
    expect(result).toEqual({ found: 2, older: 0 });
    expect(scheduled.sort()).toEqual([join(p.archive, "unparsed", "ba9876543210_LastReplay.w3g"), join(replays, "Replay_1.w3g")].sort());
    // Imported, the unparsed copy moves to its place in the archive (no second copy).
    for (const f of scheduled) expect((await ingestFile({ db, config: { ...DEFAULT_CONFIG }, paths: p }, f)).status).toBe("new");
    expect(readdirSync(join(p.archive, "unparsed"))).toEqual(["0123456789ab_Replay_1.w3g"]);
    expect(archived()).toHaveLength(3);
    expect(scan(db, [replays], new Date(), null)).toEqual({ scheduled: [], result: { found: 2, older: 0 } });
  });

  test("a game whose LastReplay.w3g was overwritten keeps its date when a copy saved later is what's left in the folders", async () => {
    const p = paths();
    let db = openDb(p.db);
    const replays = mkdtempSync(join(tmpdir(), "ra-over-replays-"));
    const ended = Date.now() - 5 * DAY;
    put(3, join(replays, "LastReplay.w3g"), ended);
    const out = await ingestFile({ db, config: { ...DEFAULT_CONFIG }, paths: p }, join(replays, "LastReplay.w3g"));
    if (out.status !== "new") throw new Error(out.status);
    const before = db.prepare("SELECT played_at, time_source, archive_path FROM games").get();
    // Saved from the replay list two days later (dated then), and LastReplay.w3g overwritten by the next game.
    put(3, join(replays, "Saved_game.w3g"), ended + 2 * DAY);
    put(4, join(replays, "LastReplay.w3g"), ended + 3 * DAY);
    db.close();
    startOverIfNewAnalysis(p);
    db = openDb(p.db);
    const all = scan(db, [replays], new Date(firstStart(db).at), null);
    expect(all.result).toEqual({ found: 2, older: 0 });
    // The saved copy stands for the game (its archived copy has the same content).
    expect(all.scheduled.sort()).toEqual([join(replays, "LastReplay.w3g"), join(replays, "Saved_game.w3g")]);
    for (const f of all.scheduled) await ingestFile({ db, config: { ...DEFAULT_CONFIG }, paths: p }, f);
    expect(db.prepare("SELECT played_at, time_source, archive_path FROM games WHERE game_key = ?").get(out.record.gameKey)).toEqual(before);
    expect(scan(db, [replays], new Date(firstStart(db).at), null).scheduled).toEqual([]);
  });
});
