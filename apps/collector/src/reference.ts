// Weekly reference refresh inside the collector: quiet, slow, and never while you play.
import { openDb, paths, type Config, type DB } from "@w3stats/core";
import { openReference, readState, refreshGroup } from "@w3stats/reference";
import { isWarcraftRunning } from "./system.ts";

const CHECK_EVERY_MS = 6 * 3600_000;

/** Replay build of your most recent game: reference games must match it (same balance). */
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
      for (const group of config.reference.groups) {
        const st = readState(openReference(group.id, config).paths.root);
        const age = st.lastRefreshAt ? Date.now() - Date.parse(st.lastRefreshAt) : Infinity;
        // Weekly once full; while still filling up (or after a rate limit), keep going every check.
        const filling = (st.lastResult?.kept ?? 0) < group.target;
        const due = age > config.reference.refreshDays * 86_400_000 || (filling && age > CHECK_EVERY_MS - 60_000);
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
