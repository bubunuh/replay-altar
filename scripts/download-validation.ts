// Research: a validation set for the win-chance model. Tournament 1v1s from warcraft3.info's
// archive, 2022 to today, spread evenly over the years and the matchups; only for scoring a model
// fitted on the curated pro games, never for fitting it. Maintainers only; the app never downloads.
//
//   node scripts/download-validation.ts --target 100
//
// Polite: one request to the site every 5 seconds (lists, replays and maps alike), stops when the
// site asks to slow down. Resumable: run it again with the same or a larger target. Simulations run
// alongside, several at a time; cap the CPU from outside (systemd-run -p CPUQuota=…).
// The target counts usable games: a known winner and a simulation that worked. Writes
// reference/validation/status.json as it goes; the last line says why it stopped.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applySim, ingestFile, loadConfig, mapFolders, paths, readRecord, referencePaths, type GameRecord } from "@replay-altar/core";
import { simulateGame } from "@replay-altar/sim";
import { openReference, RateLimited, w3iRace, w3infoClient, type W3iMapFile, type W3iReplay } from "@replay-altar/reference";
import { builtinMap } from "../apps/collector/src/gamedata.ts";

const GROUP = "validation";
const CALIBRATION = ["pros", "pros-orc", "pros-undead", "pros-nightelf"];
const YEARS = [2022, 2023, 2024, 2025, 2026];
const REQUEST_GAP_MS = 5000;
const MIN_DURATION_S = 180;
/** Games taken from one list page at most, so a year isn't a handful of tournaments. */
const PER_PAGE = 4;
const SIMS_AT_ONCE = Number(process.env.SIMS_AT_ONCE ?? 6);
/** A network error is retried after these waits, then the run stops. */
const RETRY_WAITS_MS = [60_000, 300_000, 900_000];

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const target = Number(arg("--target") ?? 100);
const perYear = Math.ceil(target / YEARS.length);
/** A matchup may take this many of a year's games (10 matchups; the rare ones leave room). */
const perMatchupCap = Math.ceil((perYear / 10) * 1.6);
const perPlayerCap = Math.max(3, Math.ceil(perYear / 15));

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- Status file and a desktop-friendly stop reason -------------------------------------------
const ref = openReference(GROUP, loadConfig());
const { db, paths: vp } = ref;
const statusFile = join(vp.root, "status.json");
const counts = { downloaded: 0, simulated: 0, simFailed: 0, skipped: 0, requests: 0 };
const writeStatus = (state: "running" | "finished" | "stopped", reason: string | null = null) =>
  writeFileSync(statusFile, JSON.stringify({ state, reason, target, at: new Date().toISOString(), have: haveTotal(), ...counts, byYear: haveByYear() }, null, 1));

db.exec(`
CREATE TABLE IF NOT EXISTS val_games (
  game_key TEXT PRIMARY KEY, w3info_id INTEGER UNIQUE NOT NULL, year INTEGER NOT NULL, matchup TEXT NOT NULL,
  p1 TEXT, p2 TEXT, map TEXT, created_at TEXT, w3info_winner TEXT, replay_build INTEGER, downloaded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS val_skipped (w3info_id INTEGER PRIMARY KEY, reason TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS val_pages (page INTEGER PRIMARY KEY, year INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS val_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);
// Games that count towards the target: a known winner and a simulation that worked (or is still to run).
const USABLE = `FROM val_games v JOIN games g USING (game_key) WHERE COALESCE(g.sim_status, '') != 'failed'
  AND EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_key = v.game_key AND gp.result IN ('win', 'loss'))`;
const haveTotal = () => (db.prepare(`SELECT COUNT(*) n ${USABLE}`).get() as { n: number }).n;
const haveByYear = () => Object.fromEntries((db.prepare(`SELECT v.year, COUNT(*) n ${USABLE} GROUP BY v.year`).all() as { year: number; n: number }[]).map((r) => [r.year, r.n]));
const haveIn = (year: number) => (db.prepare(`SELECT COUNT(*) n ${USABLE} AND v.year = ?`).get(year) as { n: number }).n;
const matchupIn = (year: number, mu: string) => (db.prepare("SELECT COUNT(*) n FROM val_games WHERE year = ? AND matchup = ?").get(year, mu) as { n: number }).n;
const playerIn = (year: number, name: string) => (db.prepare("SELECT COUNT(*) n FROM val_games WHERE year = ? AND (p1 = ? OR p2 = ?)").get(year, name, name) as { n: number }).n;
const seen = (id: number) => db.prepare("SELECT 1 FROM val_games WHERE w3info_id = ? UNION SELECT 1 FROM val_skipped WHERE w3info_id = ?").get(id, id) !== undefined;
const skip = (id: number, reason: string) => {
  db.prepare("INSERT OR REPLACE INTO val_skipped VALUES (?, ?, ?)").run(id, reason, new Date().toISOString());
  counts.skipped++;
};

// The calibration set (never scored on): by warcraft3.info id and by game.
const calibrationIds = new Set<number>();
const calibrationKeys = new Set<string>();
for (const g of CALIBRATION) {
  const rp = referencePaths(g);
  if (!existsSync(rp.db)) continue;
  const c = openReference(g, loadConfig());
  for (const r of c.db.prepare("SELECT w3c_match_id id FROM ref_matches").all() as { id: string }[]) if (r.id.startsWith("w3info:")) calibrationIds.add(Number(r.id.slice(7)));
  for (const f of readdirSync(rp.games)) calibrationKeys.add(f.replace(/\.json$/, ""));
}

// ---- The site, one request every 5 seconds --------------------------------------------------
let lastRequest = 0;
let queue = Promise.resolve();
const politeFetch = (url: string, init?: RequestInit) => {
  const turn = queue.then(async () => {
    const wait = lastRequest + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    for (let attempt = 0; ; attempt++) {
      lastRequest = Date.now();
      counts.requests++;
      try {
        return await fetch(url, init);
      } catch (e) {
        if (attempt >= RETRY_WAITS_MS.length) throw new RateLimited(`network error after ${attempt + 1} tries: ${(e as Error).message}`);
        console.log(`network error (${(e as Error).message}); trying again in ${RETRY_WAITS_MS[attempt] / 60_000} min`);
        await sleep(RETRY_WAITS_MS[attempt]);
      }
    }
  });
  queue = turn.then(() => {}, () => {});
  return turn;
};
const client = w3infoClient({ fetch: politeFetch as never, sleep });

// ---- Which list pages hold each year (newest first) ------------------------------------------
async function newestOn(page: number): Promise<string | null> {
  const { replays } = await client.listReplays(page);
  return replays[0]?.created_at ?? null;
}
/** First page whose newest replay is older than `iso`. */
async function firstPageBefore(iso: string, lastPage: number): Promise<number> {
  let lo = 1, hi = lastPage;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const newest = await newestOn(mid);
    if (newest !== null && newest < iso) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
async function yearPages(): Promise<Record<number, [number, number]>> {
  const cached = db.prepare("SELECT v FROM val_meta WHERE k = 'yearPages'").get() as { v: string } | undefined;
  if (cached) return JSON.parse(cached.v);
  const { lastPage } = await client.listReplays(1);
  const out: Record<number, [number, number]> = {};
  let newer = 1;
  for (const y of [...YEARS].reverse()) {
    const older = await firstPageBefore(`${y}-01-01`, lastPage);
    out[y] = [Math.max(1, newer - 1), older]; // pages at the edges hold two years; the year filter sorts them
    console.log(`${y}: list pages ${out[y][0]}–${out[y][1]}`);
    newer = older;
  }
  db.prepare("INSERT OR REPLACE INTO val_meta VALUES ('yearPages', ?)").run(JSON.stringify(out));
  return out;
}

/** The same shuffled page order on every run (resumable). */
function shuffled(lo: number, hi: number, seed: number): number[] {
  const pages = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
  for (let i = pages.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pages[i], pages[j]] = [pages[j], pages[i]];
  }
  return pages;
}

const MU_ORDER = "HONU";
const matchupOf = (r: W3iReplay) => {
  const races = r.players.map((p) => w3iRace(p.race));
  if (races.some((x) => x === null)) return null;
  return (races as string[]).sort((a, b) => MU_ORDER.indexOf(a) - MU_ORDER.indexOf(b)).join("v");
};
const qualifies = (r: W3iReplay) =>
  r.type === "1on1" && r.players.length === 2 && r.players[0].team !== r.players[1].team &&
  r.players.every((p) => p.stats_player !== null) && r.duration >= MIN_DURATION_S && matchupOf(r) !== null &&
  !calibrationIds.has(r.id);

// ---- Simulations, several at a time ----------------------------------------------------------
const mapsDir = paths().maps;
let mapIndex: Map<string, W3iMapFile> | null = null;
async function simulate(record: GameRecord) {
  const run = () => simulateGame(record, { dataRoot: vp.root, gamedataRoot: paths().root, mapFolders: [...mapFolders(ref.config), mapsDir], fromGame: builtinMap });
  let sim = await run();
  if (sim.status === "failed" && sim.reason.includes("not found")) {
    const sha1 = record.game.map.checksumSha1.toLowerCase();
    mapIndex ??= new Map((await client.mapFiles()).map((f) => [f.checksum_sha1.toLowerCase(), f]));
    const file = mapIndex.get(sha1);
    const buffer = file ? await client.downloadMap(file.id) : null;
    if (buffer && createHash("sha1").update(buffer).digest("hex") === sha1) {
      mkdirSync(mapsDir, { recursive: true });
      writeFileSync(join(mapsDir, record.game.map.file), buffer);
      console.log(`downloaded map ${record.game.map.file}`);
      sim = await run();
    }
  }
  return sim;
}
const running = new Set<Promise<void>>();
/** The site stopped answering during a map download: the run stops at the next game. */
let fatal: Error | null = null;
async function queueSim(record: GameRecord) {
  while (running.size >= SIMS_AT_ONCE) await Promise.race(running);
  if (fatal) throw fatal;
  const job = (async () => {
    try {
      const sim = await simulate(record);
      applySim(ref, record.gameKey, sim);
      if (sim.status === "ok") counts.simulated++;
      else {
        counts.simFailed++;
        console.log(`${record.gameKey.slice(0, 8)} simulation failed: ${sim.reason}`);
      }
    } catch (e) {
      if (e instanceof RateLimited) fatal = e;
      counts.simFailed++;
      console.log(`${record.gameKey.slice(0, 8)} simulation error: ${(e as Error).message}`);
    }
  })();
  const tracked = job.finally(() => running.delete(tracked));
  running.add(tracked);
}
// Games downloaded on an earlier run but not simulated (the run stopped in between).
const unsimulated = () => (db.prepare("SELECT v.game_key FROM val_games v JOIN games g USING (game_key) WHERE g.sim_status IS NULL").all() as { game_key: string }[]).map((r) => r.game_key);

// ---- One game -------------------------------------------------------------------------------
const incoming = join(vp.root, "incoming");
mkdirSync(incoming, { recursive: true });
async function take(r: W3iReplay, year: number, mu: string): Promise<boolean> {
  const buffer = await client.download(r.id);
  if (!buffer) return skip(r.id, "replay not available"), false;
  const file = join(incoming, `${r.id}.w3g`);
  writeFileSync(file, buffer);
  let out: Awaited<ReturnType<typeof ingestFile>>;
  try {
    out = await ingestFile(ref, file);
  } catch (e) {
    return skip(r.id, `ingest failed: ${(e as Error).message}`), false;
  } finally {
    unlinkSync(file);
  }
  if (out.status === "error") return skip(r.id, out.error), false;
  if (out.status !== "new") return skip(r.id, "duplicate game"), false;
  const record = out.record;
  if (calibrationKeys.has(record.gameKey)) return skip(r.id, "a calibration game"), false;
  if (record.players.length !== 2) return skip(r.id, `${record.players.length} players in the replay`), false;
  const winner = r.winner ?? r.detected_winner ?? null;
  db.prepare("INSERT INTO val_games VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    record.gameKey, r.id, year, mu, r.players[0].stats_player!.name, r.players[1].stats_player!.name, r.map, r.created_at,
    winner === null ? null : String(winner), record.game.build ?? null, new Date().toISOString(),
  );
  counts.downloaded++;
  console.log(`[${haveTotal()}/${target}] ${year} ${mu} ${r.players[0].stats_player!.name} vs ${r.players[1].stats_player!.name} (${r.map.replace(/\.w3[xm]$/, "")})`);
  await queueSim(record);
  return true;
}

// ---- Main: one page per year in turn, so a stop leaves the years balanced -----------------------
let stopReason: string | null = null;
try {
  writeStatus("running");
  for (const key of unsimulated()) {
    const record = readRecord(vp, key);
    if (record) await queueSim(record);
  }
  const ranges = await yearPages();
  const orders = Object.fromEntries(YEARS.map((y) => [y, shuffled(ranges[y][0], ranges[y][1], y)]));
  const cursor = Object.fromEntries(YEARS.map((y) => [y, 0]));
  const pageDone = (p: number) => db.prepare("SELECT 1 FROM val_pages WHERE page = ?").get(p) !== undefined;
  for (;;) {
    const open = YEARS.filter((y) => haveIn(y) < perYear && cursor[y] < orders[y].length);
    if (!open.length) break;
    for (const y of open) {
      // The next page of this year not looked at yet.
      while (cursor[y] < orders[y].length && pageDone(orders[y][cursor[y]])) cursor[y]++;
      if (cursor[y] >= orders[y].length) continue;
      const page = orders[y][cursor[y]++];
      const { replays } = await client.listReplays(page);
      const picks = replays
        .filter((r) => r.created_at.startsWith(String(y)) && qualifies(r) && !seen(r.id))
        .map((r) => ({ r, mu: matchupOf(r)! }))
        .sort((a, b) => matchupIn(y, a.mu) - matchupIn(y, b.mu));
      let taken = 0;
      for (const { r, mu } of picks) {
        if (taken >= PER_PAGE || haveIn(y) >= perYear) break;
        if (matchupIn(y, mu) >= perMatchupCap) continue;
        if (r.players.some((p) => playerIn(y, p.stats_player!.name) >= perPlayerCap)) continue;
        if (await take(r, y, mu)) taken++;
        writeStatus("running");
      }
      db.prepare("INSERT OR REPLACE INTO val_pages VALUES (?, ?, ?)").run(page, y, new Date().toISOString());
    }
  }
  while (running.size) await Promise.race(running);
  if (fatal) throw fatal;
  const short = YEARS.filter((y) => haveIn(y) < perYear);
  if (short.length) stopReason = `ran out of pages for ${short.join(", ")}`;
} catch (e) {
  stopReason = e instanceof RateLimited ? e.message : `error: ${(e as Error).stack ?? e}`;
}
await Promise.allSettled(running);
writeStatus(stopReason && haveTotal() < target ? "stopped" : "finished", stopReason);
console.log(`${haveTotal()} games (${JSON.stringify(haveByYear())}); ${counts.simulated} simulated, ${counts.simFailed} simulations failed, ${counts.skipped} skipped, ${counts.requests} requests${stopReason ? `; stopped: ${stopReason}` : ""}`);
process.exit(stopReason && haveTotal() < target ? 1 : 0);
