// Keeps a reference group stocked with current-patch tournament games from warcraft3.info.
// Maintainers only (`replay-altar ref refresh`); the app ships the statistics, never downloads.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applySim, ingestFile, parseReplay, readRecord, warcraftFolders, type Config, type GameRecord, type ReferenceGroup } from "@replay-altar/core";
import { simulateGame } from "@replay-altar/sim";
import { buildProfile, type RefProfile } from "./profile.ts";
import { openReference } from "./store.ts";
import { RateLimited } from "./w3c.ts";
import { w3iRace, w3infoClient, w3iSubjects, type W3iClient, type W3iMapFile } from "./w3info.ts";

// No documented limit: stay polite.
const BETWEEN_DOWNLOADS_MS = 3000;
const BETWEEN_PAGES_MS = 1000;
/** Replays looked at per update: enough for the target with room for skips (other patch, duplicates). */
const maxDownloadsFor = (target: number) => Math.max(120, Math.ceil(target * 1.6));
/** List pages searched (25 replays each, newest first); a race appears in roughly a third of 1v1s. */
const maxPagesFor = (target: number) => Math.max(80, target * 2);
/** The list is newest first: this many older-patch replays in a row means the patch is behind us. */
const OLD_PATCH_STREAK = 6;
/** Games shorter than this (someone left early) say nothing about how pros play. */
const MIN_DURATION_S = 180;

export type RefreshOptions = {
  config: Config;
  /** Your current replay build; games from other builds are skipped and pruned. Null: keep all. */
  replayBuild: number | null;
  /** Where the user's extracted game data lives (sim/gamedata/current). */
  gamedataRoot: string;
  target?: number;
  /** Download cap for this run. */
  maxDownloads?: number;
  client?: W3iClient;
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
  /** Stopped early: Warcraft III started, the site asked to slow down, or the per-run cap. */
  paused: boolean;
  stopReason: string | null;
  profile: RefProfile;
};

export type RefState = { lastRefreshAt: string | null; lastResult: Omit<RefreshResult, "profile"> | null };

export const readState = (root: string): RefState =>
  existsSync(join(root, "state.json")) ? JSON.parse(readFileSync(join(root, "state.json"), "utf8")) : { lastRefreshAt: null, lastResult: null };

/**
 * Simulates games whose map you may not have (tournament and W3Champions versions): on a missing
 * map it fetches the map from warcraft3.info by the checksum in the replay, into Replay Altar's
 * own maps folder (never the game's), and tries again.
 */
export function mapFetchingSimulator(o: { dataRoot: string; config: Config; gamedataRoot: string; client: W3iClient; sleep: (ms: number) => Promise<void>; log: (m: string) => void }) {
  const mapsDir = join(o.gamedataRoot, "maps");
  let mapIndex: Map<string, W3iMapFile> | null = null;
  return async (record: GameRecord) => {
    const run = () => simulateGame(record, { dataRoot: o.dataRoot, warcraftDocuments: warcraftFolders(o.config), gamedataRoot: o.gamedataRoot, extraMapDirs: [mapsDir] });
    const sim = await run();
    if (sim.status === "ok" || !sim.reason.includes("not found")) return sim; // only a missing map is fetchable
    const sha1 = record.game.map.checksumSha1.toLowerCase();
    mapIndex ??= new Map((await o.client.mapFiles()).map((f) => [f.checksum_sha1.toLowerCase(), f]));
    const file = mapIndex.get(sha1);
    if (!file) return sim;
    await o.sleep(BETWEEN_DOWNLOADS_MS);
    const buffer = await o.client.downloadMap(file.id);
    if (!buffer || createHash("sha1").update(buffer).digest("hex") !== sha1) return sim;
    mkdirSync(mapsDir, { recursive: true });
    writeFileSync(join(mapsDir, record.game.map.file), buffer);
    o.log(`downloaded map ${record.game.map.file}`);
    return run();
  };
}

export async function refreshGroup(group: ReferenceGroup, opts: RefreshOptions): Promise<RefreshResult> {
  const log = opts.log ?? (() => {});
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const client = opts.client ?? w3infoClient({ sleep });
  const target = opts.target ?? group.target;
  const ref = openReference(group.id, opts.config);
  const { db, paths } = ref;

  // One refresh at a time (the window's button and the CLI could overlap).
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

    const simulate = mapFetchingSimulator({ dataRoot: paths.root, config: opts.config, gamedataRoot: opts.gamedataRoot, client, sleep, log: (m) => log(`${group.id}: ${m}`) });
    // Earlier games whose simulation failed over their map (missing, or not extractable before).
    for (const { game_key } of db.prepare("SELECT r.game_key FROM ref_matches r JOIN games g ON g.game_key = r.game_key WHERE g.sim_status = 'failed'").all() as { game_key: string }[]) {
      const record = readRecord(paths, game_key);
      if (record?.sim?.status !== "failed" || !/map/i.test(record.sim.reason)) continue;
      const sim = await simulate(record);
      applySim(ref, game_key, sim);
      if (sim.status === "ok") log(`${group.id}: simulated ${record.game.map.file.replace(/\.w3[xm]$/, "")} game now that its map is here`);
    }
    const countKept = () =>
      (db.prepare(`SELECT COUNT(*) n FROM ref_matches ${opts.replayBuild === null ? "" : "WHERE replay_build = ?"}`).get(...(opts.replayBuild === null ? [] : [opts.replayBuild])) as { n: number }).n;
    const seen = (id: string) =>
      db.prepare("SELECT 1 FROM ref_matches WHERE w3c_match_id = ? UNION SELECT 1 FROM ref_skipped WHERE w3c_match_id = ?").get(id, id) !== undefined;
    const skip = (id: string, reason: string) => {
      db.prepare("INSERT OR REPLACE INTO ref_skipped VALUES (?, ?, ?)").run(id, reason, new Date().toISOString());
      skipped++;
    };

    // Spread the sample over many players: newest-first would otherwise favour whoever played
    // the latest tournament.
    const perPlayerCap = Math.max(2, Math.ceil(target / 10));
    const gamesOf = (name: string) => (db.prepare("SELECT COUNT(*) n FROM ref_matches WHERE lower(subject_name) = lower(?)").get(name) as { n: number }).n;

    let kept = countKept();
    const incoming = join(paths.root, "incoming");
    mkdirSync(incoming, { recursive: true });
    let oldStreak = 0;
    if (kept < target) try {
      log(`${group.id}: ${kept}/${target} games; looking at warcraft3.info`);
      outer: for (let page = 1; page <= maxPagesFor(target); page++) {
        const list = await client.listReplays(page);
        for (const r of list.replays) {
          if (kept >= target) break outer;
          const id = `w3info:${r.id}`;
          if (r.duration < MIN_DURATION_S || seen(id)) continue;
          const pick = w3iSubjects(r, group.race).find((x) => gamesOf(x.subject.stats_player!.name) < perPlayerCap);
          if (!pick) continue;
          if (opts.shouldPause?.()) {
            stop("paused: Warcraft III is running");
            break outer;
          }
          if (downloaded + skipped >= (opts.maxDownloads ?? maxDownloadsFor(target))) {
            stop(`looked at ${downloaded + skipped} replays this run; run it again for more`);
            break outer;
          }
          await sleep(BETWEEN_DOWNLOADS_MS);
          const buffer = await client.download(r.id);
          if (!buffer) {
            skip(id, "replay not available");
            continue;
          }
          let build: number;
          try {
            build = (await parseReplay(buffer)).output.buildNumber;
          } catch (e) {
            skip(id, `unparsable: ${(e as Error).message}`);
            continue;
          }
          if (opts.replayBuild !== null && build !== opts.replayBuild) {
            skip(id, `replay build ${build}, current ${opts.replayBuild}`);
            if (++oldStreak >= OLD_PATCH_STREAK) {
              log(`${group.id}: reached games from before your patch`);
              break outer;
            }
            continue;
          }
          oldStreak = 0;
          const file = join(incoming, `${r.id}.w3g`);
          writeFileSync(file, buffer);
          let out: Awaited<ReturnType<typeof ingestFile>>;
          try {
            out = await ingestFile(ref, file);
          } catch (e) {
            // One bad replay must not stop the whole update.
            unlinkSync(file);
            skip(id, `ingest failed: ${(e as Error).message}`);
            continue;
          }
          unlinkSync(file);
          // Anything but a brand-new game (an error, or a game we already have from another source).
          if (out.status !== "new") {
            skip(id, out.status === "error" ? out.error : "duplicate game");
            continue;
          }
          const record = out.record;
          const subject = record.players.find((p) => p.name.toLowerCase() === pick.subject.player.toLowerCase());
          if (!subject) {
            skip(id, `player ${pick.subject.player} not found in the replay`);
            continue;
          }
          const opponent = record.players.find((p) => p.playerId !== subject.playerId);
          db.prepare("INSERT INTO ref_matches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
            record.gameKey, id, null, null, r.created_at, r.map,
            pick.subject.stats_player!.name, subject.playerId, null,
            pick.opponent.stats_player?.name ?? pick.opponent.player, w3iRace(pick.opponent.race), null,
            subject.result === "win" ? 1 : subject.result === "loss" ? 0 : null, build, new Date().toISOString(),
          );
          const sim = await simulate(record);
          try {
            applySim(ref, record.gameKey, sim);
          } catch (e) {
            skip(id, `could not save the simulation: ${(e as Error).message}`);
            continue;
          }
          downloaded++;
          kept++;
          log(`${group.id}: ${kept}/${target} ${pick.subject.stats_player!.name} vs ${opponent?.name.replace(/#\d+$/, "") ?? "?"} (${r.map.replace(/\.w3[xm]$/, "")})${sim.status === "ok" ? "" : ` (simulation failed: ${sim.reason})`}`);
        }
        if (page >= list.lastPage) break;
        await sleep(BETWEEN_PAGES_MS);
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

