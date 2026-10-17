// Keeps a reference group stocked with current-patch games from W3Champions.
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applySim, ingestFile, parseReplay, readRecord, type Config, type ReferenceGroup } from "@w3stats/core";
import { simulateGame } from "@w3stats/sim";
import { buildProfile, type RefProfile } from "./profile.ts";
import { openReference } from "./store.ts";
import { pickSubject, RateLimited, W3C_RACE, w3cClient, type W3cClient } from "./w3c.ts";

// W3Champions rate-limits replay downloads (about 20 in 5 minutes triggered it), so stay well
// below that: one every 10 s and at most 15 per run; the collector continues hours later.
const BETWEEN_DOWNLOADS_MS = 10_000;
const MAX_DOWNLOADS_PER_RUN = 15;
const BETWEEN_PAGES_MS = 1000;
const PAGE_SIZE = 50;
const MAX_PAGES_PER_GATEWAY = 40;

export type RefreshOptions = {
  config: Config;
  /** Your current replay build; games from other builds are skipped and pruned. Null: keep all. */
  replayBuild: number | null;
  /** Where the user's extracted game data lives (sim/gamedata/current). */
  gamedataRoot: string;
  target?: number;
  /** Download cap for this run (default 15). */
  maxDownloads?: number;
  client?: W3cClient;
  sleep?: (ms: number) => Promise<void>;
  /** Checked before each download; true pauses the refresh (e.g. while Warcraft III runs). */
  shouldPause?: () => boolean;
  log?: (msg: string) => void;
};

export type RefreshResult = {
  downloaded: number;
  skipped: number;
  pruned: number;
  kept: number;
  /** Stopped early: Warcraft III started, W3Champions asked to slow down, or the per-run cap. */
  paused: boolean;
  stopReason: string | null;
  profile: RefProfile;
};

export type RefState = { lastRefreshAt: string | null; lastResult: Omit<RefreshResult, "profile"> | null };

/**
 * Whether a group should refresh now: weekly (refreshDays) once full; while still below target
 * (or after a rate limit stopped a run), at every check that is at least checkEveryMs after the
 * last attempt.
 */
export function refreshDue(a: { lastRefreshAt: string | null; kept: number; target: number; refreshDays: number; checkEveryMs: number; now: number }): boolean {
  if (!a.lastRefreshAt) return true;
  const age = a.now - Date.parse(a.lastRefreshAt);
  if (age > a.refreshDays * 86_400_000) return true;
  return a.kept < a.target && age >= a.checkEveryMs - 60_000;
}

export const readState = (root: string): RefState =>
  existsSync(join(root, "state.json")) ? JSON.parse(readFileSync(join(root, "state.json"), "utf8")) : { lastRefreshAt: null, lastResult: null };

export async function refreshGroup(group: ReferenceGroup, opts: RefreshOptions): Promise<RefreshResult> {
  const log = opts.log ?? (() => {});
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const client = opts.client ?? w3cClient({ sleep, log });
  const target = opts.target ?? group.target;
  const ref = openReference(group.id, opts.config);
  const { db, paths } = ref;

  // One refresh at a time (the collector's weekly job and the CLI could overlap).
  const lock = join(paths.root, "refresh.lock");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      // stale lock
    }
    if (alive) throw new Error(`a refresh is already running (pid ${pid})`);
  }
  writeFileSync(lock, String(process.pid));

  let downloaded = 0;
  let skipped = 0;
  let paused = false;
  let stopReason: string | null = null;
  const stop = (reason: string) => {
    paused = true;
    stopReason = reason;
    log(`${group.id}: ${reason}`);
  };
  try {
    const pruned = pruneOtherBuilds(ref, opts.replayBuild);
    const countKept = () =>
      (db.prepare(`SELECT COUNT(*) n FROM ref_matches ${opts.replayBuild === null ? "" : "WHERE replay_build = ?"}`).get(...(opts.replayBuild === null ? [] : [opts.replayBuild])) as { n: number }).n;
    const seen = (id: string) =>
      db.prepare("SELECT 1 FROM ref_matches WHERE w3c_match_id = ? UNION SELECT 1 FROM ref_skipped WHERE w3c_match_id = ?").get(id, id) !== undefined;
    const skip = (id: string, reason: string) => {
      db.prepare("INSERT OR REPLACE INTO ref_skipped VALUES (?, ?, ?)").run(id, reason, new Date().toISOString());
      skipped++;
    };

    // Spread the sample over many players: newest-first would otherwise favour whoever is online now.
    const perPlayerCap = Math.max(2, Math.ceil(target / 10));
    const gamesOf = (battleTag: string) =>
      (db.prepare("SELECT COUNT(*) n FROM ref_matches WHERE lower(subject_name) = lower(?)").get(battleTag) as { n: number }).n;

    let kept = countKept();
    const incoming = join(paths.root, "incoming");
    mkdirSync(incoming, { recursive: true });
    if (kept < target) try {
      const season = await client.currentSeason();
      log(`${group.id}: ${kept}/${target} games; searching season ${season}`);
      outer: for (const gateway of group.gateways) {
        for (let page = 0; page < MAX_PAGES_PER_GATEWAY; page++) {
          const list = await client.listMatches({ gateway, season, minMmr: group.minMmr, offset: page * PAGE_SIZE, pageSize: PAGE_SIZE });
          if (!list.matches.length) break;
          for (const m of list.matches) {
            if (kept >= target) break outer;
            if (seen(m.id)) continue;
            const pick = pickSubject(m, group.race, group.minMmr);
            if (!pick || gamesOf(pick.subject.battleTag) >= perPlayerCap) continue;
            if (opts.shouldPause?.()) {
              stop("paused: Warcraft III is running");
              break outer;
            }
            if (downloaded >= (opts.maxDownloads ?? MAX_DOWNLOADS_PER_RUN)) {
              stop(`downloaded ${downloaded} this run; continuing next time`);
              break outer;
            }
            await sleep(BETWEEN_DOWNLOADS_MS);
            const buffer = await client.downloadReplay(m.id);
            if (!buffer) {
              skip(m.id, "replay not available");
              continue;
            }
            let build: number;
            try {
              build = (await parseReplay(buffer)).output.buildNumber;
            } catch (e) {
              skip(m.id, `unparsable: ${(e as Error).message}`);
              continue;
            }
            if (opts.replayBuild !== null && build !== opts.replayBuild) {
              skip(m.id, `replay build ${build}, current ${opts.replayBuild}`);
              continue;
            }
            const file = join(incoming, `${m.id}.w3g`);
            writeFileSync(file, buffer);
            const out = await ingestFile(ref, file);
            unlinkSync(file);
            // Anything but a brand-new game (an error, or a game we already have under another id).
            if (out.status !== "new") {
              skip(m.id, out.status === "error" ? out.error : "duplicate game");
              continue;
            }
            const record = out.record;
            const subject = record.players.find((p) => p.name.toLowerCase() === pick.subject.battleTag.toLowerCase());
            if (!subject) {
              skip(m.id, `player ${pick.subject.battleTag} not found in the replay`);
              continue;
            }
            db.prepare("INSERT INTO ref_matches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
              record.gameKey, m.id, m.gateWay, m.season, m.startTime, m.mapName ?? m.map,
              pick.subject.battleTag, subject.playerId, pick.subject.oldMmr,
              pick.opponent.battleTag, W3C_RACE[pick.opponent.race] ?? null, pick.opponent.oldMmr,
              pick.subject.won ? 1 : 0, build, new Date().toISOString(),
            );
            const sim = await simulateGame(record, { dataRoot: paths.root, warcraftDocuments: opts.config.warcraftDocuments, gamedataRoot: opts.gamedataRoot });
            applySim(ref, record.gameKey, sim);
            downloaded++;
            kept++;
            log(`${group.id}: ${kept}/${target} ${pick.subject.battleTag} (${pick.subject.oldMmr}) vs ${pick.opponent.battleTag} on ${m.mapName ?? m.map}${sim.status === "ok" ? "" : ` (simulation failed: ${sim.reason})`}`);
          }
          await sleep(BETWEEN_PAGES_MS);
        }
      }
    } catch (e) {
      if (!(e instanceof RateLimited)) throw e;
      stop(e.message);
    }
    const profile = buildProfile(db, paths, group, opts.replayBuild);
    const result = { downloaded, skipped, pruned, kept: countKept(), paused, stopReason };
    writeFileSync(join(paths.root, "state.json"), JSON.stringify({ lastRefreshAt: new Date().toISOString(), lastResult: result } satisfies RefState, null, 1));
    return { ...result, profile };
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Remove games from other builds (balance changed), so the reference follows the patch. */
function pruneOtherBuilds(ref: ReturnType<typeof openReference>, replayBuild: number | null): number {
  if (replayBuild === null) return 0;
  const { db, paths } = ref;
  const stale = db.prepare("SELECT game_key FROM ref_matches WHERE replay_build != ?").all(replayBuild) as { game_key: string }[];
  for (const { game_key } of stale) {
    const record = readRecord(paths, game_key);
    for (const f of [
      record?.provenance.archivePath,
      record?.sim?.status === "ok" ? record.sim.outputPath : undefined,
      join(paths.games, `${game_key}.json`),
      join(paths.raw, `${game_key}.w3gjs.json.gz`),
    ]) {
      if (f) rmSync(f, { force: true });
    }
    db.prepare("DELETE FROM games WHERE game_key = ?").run(game_key);
    db.prepare("DELETE FROM ref_matches WHERE game_key = ?").run(game_key);
  }
  return stale.length;
}

