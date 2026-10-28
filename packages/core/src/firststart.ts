// When this copy of Replay Altar first ran with the 0.2.2 rules, and whether it already had games
// then (an update): how many older replays are imported without being asked depends on it. Kept in
// the data folder (first-start.json), next to the games it describes; the settings file only holds
// what you chose. Also the default of when the collector runs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, IMPORT_STEP, type CollectorMode, type Config } from "./config.ts";
import type { DB } from "./db.ts";

export type FirstStart = {
  /** ISO time. Replays saved after it are new games, always imported. */
  at: string;
  /** Replays were already imported then: an update from 0.2.1 or older. */
  updated: boolean;
  /**
   * The match list started over then, for this analysis version (analysis.ts): an update whose
   * games are imported again on request.
   */
  startedOver?: number;
};

/**
 * When the collector runs unless you chose (Settings → Behaviour), on new installs and on copies
 * updated from 0.2.1 or older alike: from login, but only awake while Warcraft III runs.
 */
export const DEFAULT_COLLECTOR_MODE: CollectorMode = "game";

export const firstStartFile = () => join(dataDir(), "first-start.json");

/**
 * Reads first-start.json, or writes it on the first call: `db` is the games database (null when
 * there is none yet), and any imported replay in it makes this an update. The window and the
 * collector may both get here first; whoever writes first wins and the other reads it.
 */
export function firstStart(db: DB | null): FirstStart {
  const file = firstStartFile();
  const read = (): FirstStart | null => {
    try {
      const v = JSON.parse(readFileSync(file, "utf8")) as Partial<FirstStart>;
      if (typeof v.at !== "string" || Number.isNaN(Date.parse(v.at))) return null;
      return { at: v.at, updated: !!v.updated, ...(typeof v.startedOver === "number" ? { startedOver: v.startedOver } : {}) };
    } catch {
      return null;
    }
  };
  const known = existsSync(file) ? read() : null;
  if (known) return known;
  const updated = !!db?.prepare("SELECT 1 FROM files LIMIT 1").get();
  const made: FirstStart = { at: new Date().toISOString(), updated };
  mkdirSync(dataDir(), { recursive: true });
  try {
    writeFileSync(file, JSON.stringify(made) + "\n", { flag: existsSync(file) ? "w" : "wx" });
  } catch {
    return read() ?? made; // the other process wrote it meanwhile
  }
  return made;
}

/**
 * How many of the replays saved before the first start are imported (null: all of them). Nothing
 * until you ask on a new install; an updated copy keeps the newest IMPORT_STEP it imported by
 * itself before. Replays saved after the first start are always imported.
 */
export function importLimit(config: Config, start: FirstStart): number | null {
  if (config.importLimit === "all") return null;
  return config.importLimit ?? (start.updated ? IMPORT_STEP : 0);
}

/** When the collector runs: your choice in Settings, else DEFAULT_COLLECTOR_MODE. */
export function collectorMode(config: Config): CollectorMode {
  return config.collectorMode === "off" || config.collectorMode === "game" || config.collectorMode === "always" ? config.collectorMode : DEFAULT_COLLECTOR_MODE;
}
