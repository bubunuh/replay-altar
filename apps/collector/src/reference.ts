// Helpers for the pro reference groups. Only the maintainers update them (`replay-altar ref
// refresh`, then `ref publish`); the app ships the resulting statistics in data/reference.
import type { DB } from "@replay-altar/core";

/** Races you played in analyzed games. */
export function racesPlayed(db: DB): Set<string> {
  return new Set((db.prepare("SELECT DISTINCT me_race FROM games WHERE analyzed = 1 AND me_race IS NOT NULL").all() as { me_race: string }[]).map((r) => r.me_race));
}

/** Replay build of your most recent game: reference games must match it (same balance). */
export function currentReplayBuild(db: DB): number | null {
  const row = db.prepare("SELECT build FROM games ORDER BY played_at DESC LIMIT 1").get() as { build: number } | undefined;
  return row?.build ?? null;
}
