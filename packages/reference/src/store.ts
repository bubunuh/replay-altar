// A reference group's own data folder and database (same layout as yours, plus ref_* tables).
import { mkdirSync } from "node:fs";
import { openDb, referencePaths, type Config, type DB, type IngestContext } from "@w3stats/core";

export type RefPaths = ReturnType<typeof referencePaths>;

const REF_SCHEMA = `
CREATE TABLE IF NOT EXISTS ref_matches (
  game_key TEXT PRIMARY KEY,
  w3c_match_id TEXT UNIQUE NOT NULL,
  gateway INTEGER, season INTEGER, start_time TEXT, map TEXT,
  subject_name TEXT NOT NULL, subject_player_id INTEGER NOT NULL, subject_mmr INTEGER,
  opp_name TEXT, opp_race TEXT, opp_mmr INTEGER,
  subject_won INTEGER, replay_build INTEGER, downloaded_at TEXT NOT NULL
);
-- Matches looked at but not kept (replay missing, other patch, parse error), so we don't retry them.
CREATE TABLE IF NOT EXISTS ref_skipped (w3c_match_id TEXT PRIMARY KEY, reason TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ref_metric_stats (
  matchup TEXT NOT NULL, metric TEXT NOT NULL,
  n INTEGER, p10 REAL, p25 REAL, p50 REAL, p75 REAL, p90 REAL,
  PRIMARY KEY (matchup, metric)
);
`;

export function openReference(groupId: string, config: Config): IngestContext & { paths: RefPaths; db: DB } {
  const paths = referencePaths(groupId);
  mkdirSync(paths.root, { recursive: true });
  const db = openDb(paths.db);
  db.exec(REF_SCHEMA);
  // Reference games are nobody's: no accounts, so both players are just players.
  return { db, paths, config: { ...config, accounts: [] } };
}
