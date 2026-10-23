// Makes sure WC3V has map data for a replay's map. Replay Altar ships none: it is extracted from
// the player's own copy of the map (the Maps folders, see mapFolders in core's config) the first
// time a game on that map is simulated, then kept in the user's data folder (sim/maps/<map>/),
// because WC3V reads it from its own folder inside the install, which an update replaces.
//
// What WC3V's data-tool makes from a map: mapdata/<map>/ (the files the simulation reads:
// terrain, pathing, doodads, placed units), client/maps/<map>/ (pathing grid, units and the
// minimap as JSON and pictures, read by the match page) and an entry for the map in two shared
// files (helpers/mapConfiguration.json, client/js/gameData.json).
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mapDataName } from "./mapname.ts";
import { WC3V_DIR } from "./paths.ts";

export { mapDataName };

/** The user's copy of the extracted map data, under the data folder. */
export const mapCacheDir = (dataRoot: string) => join(dataRoot, "sim/maps");

const MAP_CONFIG = () => join(WC3V_DIR, "helpers/mapConfiguration.json");
const GAME_DATA = () => join(WC3V_DIR, "client/js/gameData.json");
const GAME_DATA_JS = () => join(WC3V_DIR, "client/js/gameData.js");

type Entries = { mapConfiguration: Record<string, unknown>; gameData: Record<string, unknown> };
const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
};

function findMapFile(folders: string[], file: string): string | null {
  const walk = (dir: string, depth: number): string | null => {
    if (depth > 6) return null;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        const hit = walk(p, depth + 1);
        if (hit) return hit;
      } else if (e.name === file) return p;
    }
    return null;
  };
  for (const dir of folders) {
    if (!existsSync(dir)) continue;
    const hit = walk(dir, 0);
    if (hit) return hit;
  }
  return null;
}

/** The maps' entries of the shared files, kept with the cache (all of them: merging is by key). */
function saveEntries(cache: string) {
  const file = join(cache, "entries.json");
  const kept = readJson<Entries>(file, { mapConfiguration: {}, gameData: {} });
  const config = readJson<{ maps?: Record<string, unknown> }>(MAP_CONFIG(), {});
  const data = readJson<{ maps?: Record<string, unknown> }>(GAME_DATA(), {});
  const next = { mapConfiguration: { ...kept.mapConfiguration, ...config.maps }, gameData: { ...kept.gameData, ...data.maps } };
  mkdirSync(cache, { recursive: true });
  writeFileSync(file, JSON.stringify(next));
}

/** Puts back entries WC3V's shared files lost (an update ships them as WC3V publishes them). */
function restoreEntries(cache: string) {
  const kept = readJson<Entries | null>(join(cache, "entries.json"), null);
  if (!kept) return;
  const config = readJson<{ maps?: Record<string, unknown> }>(MAP_CONFIG(), {});
  const missingConfig = Object.keys(kept.mapConfiguration).filter((k) => !config.maps?.[k]);
  if (missingConfig.length) {
    config.maps = { ...config.maps, ...Object.fromEntries(missingConfig.map((k) => [k, kept.mapConfiguration[k]])) };
    writeFileSync(MAP_CONFIG(), JSON.stringify(config));
  }
  const data = readJson<{ maps?: Record<string, unknown> }>(GAME_DATA(), {});
  const missingData = Object.keys(kept.gameData).filter((k) => !data.maps?.[k]);
  if (missingData.length) {
    data.maps = { ...data.maps, ...Object.fromEntries(missingData.map((k) => [k, kept.gameData[k]])) };
    const raw = JSON.stringify(data);
    writeFileSync(GAME_DATA(), raw);
    writeFileSync(GAME_DATA_JS(), `const gameData = ${raw};\n\n  window.gameData = gameData;\n  `);
  }
}

const inWc3v = (name: string) => existsSync(join(WC3V_DIR, "mapdata", name));
const inCache = (cache: string, name: string) => existsSync(join(cache, name, "mapdata"));

/** Copies one map's extracted data from WC3V's folder to the cache. */
function save(cache: string, name: string) {
  const to = join(cache, name);
  cpSync(join(WC3V_DIR, "mapdata", name), join(to, "mapdata"), { recursive: true });
  const client = join(WC3V_DIR, "client/maps", name);
  if (existsSync(client)) cpSync(client, join(to, "client"), { recursive: true });
  saveEntries(cache);
}

/** Copies one map's extracted data from the cache back into WC3V's folder. */
function restore(cache: string, name: string) {
  const from = join(cache, name);
  cpSync(join(from, "mapdata"), join(WC3V_DIR, "mapdata", name), { recursive: true });
  if (existsSync(join(from, "client"))) cpSync(join(from, "client"), join(WC3V_DIR, "client/maps", name), { recursive: true });
  restoreEntries(cache);
}

/**
 * At start: every cached map back into WC3V's folder (after an update) and every map WC3V has
 * into the cache (maps extracted before the cache existed). Returns how many moved each way.
 */
export function syncMapCache(dataRoot: string): { restored: number; saved: number } {
  const cache = mapCacheDir(dataRoot);
  let restored = 0;
  let saved = 0;
  if (existsSync(cache)) {
    for (const name of readdirSync(cache)) {
      if (inCache(cache, name) && !inWc3v(name)) {
        restore(cache, name);
        restored++;
      }
    }
    restoreEntries(cache);
  }
  const mapdata = join(WC3V_DIR, "mapdata");
  if (existsSync(mapdata)) {
    for (const name of readdirSync(mapdata)) {
      if (!inCache(cache, name)) {
        save(cache, name);
        saved++;
        continue;
      }
      // Files WC3V added after the copy was made (placed units, written by the first simulation).
      const client = join(WC3V_DIR, "client/maps", name);
      const copy = join(cache, name, "client");
      if (existsSync(client) && readdirSync(client).some((f) => !existsSync(join(copy, f)))) cpSync(client, copy, { recursive: true });
    }
  }
  return { restored, saved };
}

/**
 * After a simulation: WC3V writes some of a map's files (its placed units, read by the match
 * page) only when it first simulates a game there, so the cached copy is refreshed.
 */
export function refreshMapCache(dataRoot: string, mapFile: string) {
  const name = mapDataName(mapFile);
  const client = join(WC3V_DIR, "client/maps", name);
  const cache = mapCacheDir(dataRoot);
  if (existsSync(client) && inCache(cache, name)) cpSync(client, join(cache, name, "client"), { recursive: true });
}

/** Where the match page finds a map's pictures and grid: WC3V's folder, else the cache. */
export function mapClientDir(dataRoot: string, file: string): string | null {
  const name = mapDataName(file);
  for (const dir of [join(WC3V_DIR, "client/maps", name), join(mapCacheDir(dataRoot), name, "client")]) if (existsSync(dir)) return dir;
  return null;
}

/** A map that comes with the game, copied out of its storage into a temporary folder (null: none). */
export type FromGame = (mapFile: string) => string | null;

/**
 * Returns null when ready, or the reason the map can't be prepared. `folders`: where to look for
 * the map file (any depth); `dataRoot`: whose cache to use (null: no cache, e.g. tests);
 * `fromGame`: for Blizzard's own maps, which are inside the game rather than in a folder.
 */
export function ensureMapData(mapFile: string, folders: string[], dataRoot: string | null, fromGame?: FromGame): string | null {
  const name = mapDataName(mapFile);
  const cache = dataRoot ? mapCacheDir(dataRoot) : null;
  if (inWc3v(name)) {
    if (cache && !inCache(cache, name)) save(cache, name);
    return null;
  }
  if (cache && inCache(cache, name)) {
    restore(cache, name);
    return null;
  }
  let source = findMapFile(folders, mapFile);
  let copied: string | null = null;
  if (!source && fromGame) {
    try {
      source = copied = fromGame(mapFile);
    } catch (e) {
      return `map file ${mapFile} not found in your map folders, and reading it from the game failed: ${(e as Error).message}`;
    }
  }
  if (!source) return `map file ${mapFile} not found in your map folders or the game (Settings → Map folders)`;
  const tmp = mkdtempSync(join(tmpdir(), "replay-altar-map-"));
  try {
    // The data-tool only reads .w3x; a .w3m (classic-format map) is the same kind of archive.
    copyFileSync(source, join(tmp, mapFile.replace(/\.w3m$/i, ".w3x")));
    mkdirSync(join(WC3V_DIR, "mapdata"), { recursive: true });
    mkdirSync(join(WC3V_DIR, "client/maps"), { recursive: true });
    const prefix = /^\d+_w3c_/.test(mapFile) ? [] : ["--prefix="];
    execFileSync(process.execPath, [join(WC3V_DIR, "tools/data-tool.js"), `--source=${tmp}`, ...prefix], {
      cwd: WC3V_DIR,
      // Its errors are kept for the reason below; its progress output isn't.
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
  } catch (e) {
    // The tool's error line says why (the message itself is only the command line).
    const lines = String((e as { stderr?: Buffer }).stderr ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return `map extraction failed: ${lines.find((l) => /Error\b/.test(l)) ?? lines.at(-1) ?? (e as Error).message}`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    if (copied) rmSync(dirname(copied), { recursive: true, force: true });
  }
  if (!inWc3v(name)) return `map extraction produced no data for ${name}`;
  if (cache) save(cache, name);
  return null;
}
