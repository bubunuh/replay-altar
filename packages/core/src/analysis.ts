// Which analysis the games in the data folder were made with. A version that reads or simulates
// games differently bumps ANALYSIS_VERSION; its first start then starts the match list over, as on
// a new install: nothing is read again by itself, the match list offers "Import 20 replays" and
// "Import all replays (N)", and the games played from then on are imported by themselves.
//
// Nothing the player can't get back is lost. Kept: the settings, the battletag, the game data and
// maps (sim/gamedata, sim/maps, maps/), the pictures (ui/), the Analyzer page's replays, what the
// player added (the annotations table: results corrected by hand), the archive, and the W3Champions
// end-of-game statistics (official-stats.json, so they aren't asked for again). Rebuilt: the games
// in the database, games/, raw/ and sim/out/. The database as it was stays in one backup file,
// replaced at the next start-over.
//
// The archive holds a copy of every imported replay, and for a game whose LastReplay.w3g was
// overwritten since, the only one. Its index (archive/index.json, written here from the database
// before it is emptied) says which game each copy is and which files it came from, so that a game
// imported again from its copy keeps its date, and the copy of a replay still in the folders isn't
// counted twice.
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { configPath, loadConfig, paths as dataPaths, saveConfig } from "./config.ts";
import { openDb, transaction, type DB } from "./db.ts";
import { firstStartFile, type FirstStart } from "./firststart.ts";
import type { OfficialStats } from "./official.ts";
import type { Paths } from "./store.ts";
import { logEvent, readRecord } from "./store.ts";

/**
 * 1: everything up to 0.2.1 (and 0.2.2 before this mark existed). 2: 0.2.2 (new metrics, replay
 * checks, the new WC3V).
 */
export const ANALYSIS_VERSION = 2;

export const analysisFile = (p: Paths = dataPaths()) => join(p.root, "analysis.json");
/** The database as it was before the last start-over. */
export const previousDbFile = (p: Paths = dataPaths()) => join(p.root, "replay-altar.previous.sqlite");
export const archiveIndexFile = (p: Paths = dataPaths()) => join(p.archive, "index.json");
export const officialCacheFile = (p: Paths = dataPaths()) => join(p.root, "official-stats.json");
const lockFile = (p: Paths) => join(p.root, "analysis-reset.lock");

/** A file a game was imported from, as the files table holds it. */
export type ArchivedFrom = { path: string; sha256: string; size: number; mtime: string; durationMs: number | null; timeSource: string | null };

/** One archived replay: its game, its content, where it is (relative to archive/), and the files it was imported from. */
export type ArchiveEntry = { gameKey: string; sha256: string; archive: string; files: ArchivedFrom[] };

/** archive/index.json: the archived replays by the sha256 of their content. */
export type ArchiveIndex = { version: 1; bySha: Record<string, ArchiveEntry> };

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

/** Writes through a temporary file, so a crash never leaves half a file. */
function writeJson(file: string, value: unknown) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
}

/** Re-read only when the file changed (the collector asks once per replay). */
function cachedReader<T>(read: (file: string) => T) {
  const cache = new Map<string, { stamp: string; value: T }>();
  return (file: string): T => {
    let stamp = "none";
    try {
      const s = statSync(file);
      stamp = `${s.size}:${s.mtimeMs}`;
    } catch {
      // not there
    }
    const hit = cache.get(file);
    if (hit && hit.stamp === stamp) return hit.value;
    const value = read(file);
    cache.set(file, { stamp, value });
    return value;
  };
}

const indexReader = cachedReader((file): ArchiveIndex => {
  const v = readJson<ArchiveIndex>(file);
  return v?.version === 1 && v.bySha ? v : { version: 1, bySha: {} };
});
const officialReader = cachedReader((file) => readJson<Record<string, OfficialStats>>(file) ?? {});

export const readArchiveIndex = (p: Paths) => indexReader(archiveIndexFile(p));

const bySource = new WeakMap<ArchiveIndex, Map<string, ArchiveEntry>>();
/**
 * The archived game a replay's content belongs to: the archived copy itself, or one of the files
 * the game was imported from (a shorter copy, say).
 */
export function archiveEntryFor(p: Paths, sha: string): ArchiveEntry | undefined {
  const index = readArchiveIndex(p);
  if (index.bySha[sha]) return index.bySha[sha];
  let map = bySource.get(index);
  if (!map) {
    map = new Map();
    for (const e of Object.values(index.bySha)) for (const f of e.files) map.set(f.sha256, e);
    bySource.set(index, map);
  }
  return map.get(sha);
}
/** The W3Champions statistics kept from before the last start-over, by game key. */
export const keptOfficial = (p: Paths, gameKey: string): OfficialStats | undefined => officialReader(officialCacheFile(p))[gameKey];

/** Is `file` inside `dir` (or `dir` itself)? Windows paths compare case-insensitively. */
export function isInside(file: string, dir: string): boolean {
  const norm = (s: string) => (process.platform === "win32" ? resolve(s).toLowerCase() : resolve(s));
  const rel = relative(norm(dir), norm(file));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-z]:/i.test(rel));
}

const hasGames = (p: Paths) => {
  if (existsSync(p.games) && readdirSync(p.games).some((f) => f.endsWith(".json"))) return true;
  if (!existsSync(p.db)) return false;
  try {
    const db = openDb(p.db, { readOnly: true });
    try {
      return !!db.prepare("SELECT 1 FROM games LIMIT 1").get();
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
};

const storedVersion = (p: Paths): number | null => {
  const v = readJson<{ version?: unknown }>(analysisFile(p));
  return typeof v?.version === "number" ? v.version : null;
};

/** Bytes under a folder (or of a file). */
export function sizeOf(path: string): number {
  let st;
  try {
    st = statSync(path);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const e of readdirSync(path, { withFileTypes: true })) n += sizeOf(join(path, e.name));
  return n;
}

/** What a start-over did, for the log. */
export type StartOver = { games: number; archived: number; officialKept: number; freedBytes: number; backup: string | null };

/** The archive index with every game in the database added (older entries stay: games not imported again since). */
function indexFromDb(db: DB, p: Paths, before: ArchiveIndex): ArchiveIndex {
  const bySha = { ...before.bySha };
  const games = db.prepare("SELECT game_key, archive_path, sha256 FROM games").all() as { game_key: string; archive_path: string; sha256: string }[];
  const files = db.prepare("SELECT game_key, path, sha256, size, mtime, duration_ms, time_source FROM files").all() as {
    game_key: string;
    path: string;
    sha256: string;
    size: number;
    mtime: string;
    duration_ms: number | null;
    time_source: string | null;
  }[];
  const byGame = new Map<string, ArchivedFrom[]>();
  for (const f of files) {
    const list = byGame.get(f.game_key) ?? [];
    list.push({ path: f.path, sha256: f.sha256, size: f.size, mtime: f.mtime, durationMs: f.duration_ms, timeSource: f.time_source });
    byGame.set(f.game_key, list);
  }
  for (const g of games) {
    if (!g.archive_path || !existsSync(g.archive_path) || !isInside(g.archive_path, p.archive)) continue;
    bySha[g.sha256] = { gameKey: g.game_key, sha256: g.sha256, archive: relative(p.archive, g.archive_path).split(sep).join("/"), files: byGame.get(g.game_key) ?? [] };
  }
  return { version: 1, bySha };
}

/** The W3Champions statistics of every game that has some (looked up, found or not), added to the kept ones. */
function officialFromRecords(db: DB, p: Paths, before: Record<string, OfficialStats>): Record<string, OfficialStats> {
  const out = { ...before };
  const keys = db.prepare("SELECT game_key FROM games WHERE source = 'w3champions'").all() as { game_key: string }[];
  for (const { game_key } of keys) {
    try {
      const official = readRecord(p, game_key)?.official;
      if (official && !(out[game_key]?.status === "ok" && official.status !== "ok")) out[game_key] = official;
    } catch {
      // an unreadable record: nothing to keep from it
    }
  }
  return out;
}

/** Synchronous sleep (the start-over runs before anything else at start). */
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** A lock older than this was left by a process that died during a start-over. */
const STALE_LOCK_MS = 10 * 60_000;

/**
 * At start, before the database is opened: when the games were made by an older analysis, starts
 * the match list over (see the top of this file) and returns what it did; null when nothing was to
 * do. The window and the collector may both get here first: one does it, the other waits for it.
 */
export function startOverIfNewAnalysis(p: Paths = dataPaths()): StartOver | null {
  const stored = storedVersion(p);
  if (stored !== null && stored >= ANALYSIS_VERSION) return null;
  mkdirSync(p.root, { recursive: true });
  if (stored === null && !hasGames(p)) {
    // A new install, or nothing imported yet: the games to come are made by this version.
    writeJson(analysisFile(p), { version: ANALYSIS_VERSION, at: new Date().toISOString() });
    return null;
  }
  // One process at a time.
  for (;;) {
    try {
      closeSync(openSync(lockFile(p), "wx"));
      break;
    } catch {
      let age = 0;
      try {
        age = Date.now() - statSync(lockFile(p)).mtimeMs;
      } catch {
        continue; // just removed: try again
      }
      if (age > STALE_LOCK_MS) rmSync(lockFile(p), { force: true });
      else pause(250);
    }
  }
  try {
    const now = storedVersion(p);
    if (now !== null && now >= ANALYSIS_VERSION) return null; // the other process did it meanwhile
    return startOver(p);
  } finally {
    rmSync(lockFile(p), { force: true });
  }
}

function startOver(p: Paths): StartOver {
  const db = openDb(p.db);
  let games = 0;
  let backup: string | null = null;
  try {
    games = (db.prepare("SELECT COUNT(*) AS n FROM games").get() as { n: number }).n;
    // First what must survive: the archive's index and the W3Champions statistics. A start-over cut
    // short (the computer turned off) runs again at the next start and finds them here.
    mkdirSync(p.archive, { recursive: true });
    writeJson(archiveIndexFile(p), indexFromDb(db, p, readArchiveIndex(p)));
    writeJson(officialCacheFile(p), officialFromRecords(db, p, officialReader(officialCacheFile(p))));
    // The database as it was, in one file (never replaced by an already emptied one).
    if (games > 0) {
      const file = previousDbFile(p);
      rmSync(file, { force: true });
      db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
      backup = file;
    }
    // The games go, with everything that hangs on them; the annotations (your corrections) stay.
    transaction(db, () => db.exec("DELETE FROM games"));
    try {
      db.exec("VACUUM");
    } catch {
      // busy (another process reading): the space is reused by the games imported again
    }
  } finally {
    db.close();
  }
  let freedBytes = 0;
  for (const dir of [p.games, p.raw, join(p.root, "sim/out")]) {
    freedBytes += sizeOf(dir);
    rmSync(dir, { recursive: true, force: true });
  }
  // Counts of the last scan: the collector counts again, with the archive.
  rmSync(join(p.root, "replays.json"), { force: true });
  // As after a first start: nothing older is imported until asked, new games are.
  const start: FirstStart = { at: new Date().toISOString(), updated: false, startedOver: ANALYSIS_VERSION };
  writeJson(firstStartFile(), start);
  try {
    const config = existsSync(configPath()) ? loadConfig() : null;
    if (config && config.importLimit !== undefined) {
      delete config.importLimit;
      saveConfig(config);
    }
  } catch {
    // an unreadable settings file stays as it is
  }
  const index = readArchiveIndex(p);
  const officials = officialReader(officialCacheFile(p));
  writeJson(analysisFile(p), { version: ANALYSIS_VERSION, at: start.at, previous: storedVersion(p) ?? 1 });
  logEvent(p, { type: "reingested", games: 0, startedOver: ANALYSIS_VERSION });
  return { games, archived: Object.keys(index.bySha).length, officialKept: Object.values(officials).filter((o) => o.status === "ok").length, freedBytes, backup };
}
