// Weekly reference refresh inside the collector: quiet, slow, and never while you play.
import { activeReferenceGroups, openDb, paths, type Config, type DB } from "@w3stats/core";
import { openReference, readState, refreshDue, refreshGroup } from "@w3stats/reference";
import { isWarcraftRunning } from "./system.ts";

const CHECK_EVERY_MS = 6 * 3600_000;

/** Replay build of your most recent game: reference games must match it (same balance). */
/** Races you played in analyzed games. */
export function racesPlayed(db: DB): Set<string> {
  return new Set((db.prepare("SELECT DISTINCT me_race FROM games WHERE analyzed = 1 AND me_race IS NOT NULL").all() as { me_race: string }[]).map((r) => r.me_race));
}

export function currentReplayBuild(db: DB): number | null {
  const row = db.prepare("SELECT build FROM games ORDER BY played_at DESC LIMIT 1").get() as { build: number } | undefined;
  return row?.build ?? null;
}

export function scheduleReferenceRefresh(config: Config, log: (m: string) => void) {
  let running = false;
  const check = async () => {
    if (running || isWarcraftRunning()) return;
    running = true;
    try {
      for (const group of activeReferenceGroups(config, racesPlayed(openDb(paths().db)))) {
        const ref = openReference(group.id, config);
        const st = readState(ref.paths.root);
        const kept = (ref.db.prepare("SELECT COUNT(*) n FROM ref_matches").get() as { n: number }).n;
        const due = refreshDue({ lastRefreshAt: st.lastRefreshAt, kept, target: group.target, refreshDays: config.reference.refreshDays, checkEveryMs: CHECK_EVERY_MS, now: Date.now() });
        ref.db.close();
        if (!due) continue;
        log(`reference ${group.id}: weekly refresh`);
        const res = await refreshGroup(group, {
          config,
          replayBuild: currentReplayBuild(openDb(paths().db)),
          gamedataRoot: paths().root,
          shouldPause: isWarcraftRunning,
          log,
        });
        log(`reference ${group.id}: +${res.downloaded} games, ${res.kept}/${group.target} kept${res.stopReason ? ` (${res.stopReason})` : ""}`);
      }
    } catch (e) {
      log(`reference refresh failed: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  };
  setTimeout(check, 60_000); // a minute after start, then every 6 hours
  return setInterval(check, CHECK_EVERY_MS);
}
