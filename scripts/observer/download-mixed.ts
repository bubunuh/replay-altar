// Research: a recording batch spread over skill levels, for the WC3V lab. W3Champions ladder 1v1s at
// three MMR bands plus warcraft3.info tournament games, all of the installed game version (Warcraft III
// only opens replays of its own version), at most --per-cell games per matchup per band (default 1),
// simulated with WC3V. With --per-cell 2 or more, a cell's first game is 8 to 25 minutes as before and
// the others are the longest on offer, up to 40 minutes (the first batches have few long games).
// Replays with a damaged start (missing first selections: the game plays them back wrong) are left out.
// Files are named zq01_..., zq02_...: watch.py finds each one by typing that first word into the game's filter.
// Copies the replays into the game's Replays folder and writes a manifest for batch-compare.py.
// Polite: W3Champions one replay every 45 s (--pace), half an hour's wait if it asks to slow down, warcraft3.info one request every 10 s.
//
//   node scripts/observer/download-mixed.ts <batch name> <replays folder> [--low 6] [--avg 8] [--high 8] [--pro 8] [--per-cell 1] [--pace 45] [--build 7003]
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applySim, ingestFile, loadConfig, mapFolders, parseReplay, paths, type GameRecord } from "@replay-altar/core";
import { simulateGame } from "@replay-altar/sim";
import { openReference, w3cClient, W3C_RACE, w3iRace, w3infoClient } from "@replay-altar/reference";
import { builtinMap } from "../../apps/collector/src/gamedata.ts";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const [batch, replaysDir] = process.argv.slice(2);
if (!batch || !replaysDir) throw new Error("usage: <batch name> <replays folder> [--low 6] [--avg 8] [--high 8] [--pro 8] | --from <folder> [--band pro]");
const build = Number(arg("--build", "7003"));
const BANDS = { low: [1000, 1300], avg: [1500, 1700], high: [2000, 2300] } as const;
const want = { low: Number(arg("--low", "6")), avg: Number(arg("--avg", "8")), high: Number(arg("--high", "8")), pro: Number(arg("--pro", "8")) };
const ORDER = "HONU";
const matchup = (races: string[]) => [...races].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join("v");
// Matchups the earlier batches have least of come first.
const THIN = ["OvO", "UvU", "HvO", "OvU", "HvU", "NvU", "OvN", "HvH", "HvN", "NvN"];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let lastW3i = 0;
const politeFetch = async (url: string, init?: RequestInit) => {
  const wait = lastW3i + 20_000 - Date.now();
  if (wait > 0) await sleep(wait);
  lastW3i = Date.now();
  return fetch(url, init);
};
const w3i = w3infoClient({ fetch: politeFetch as never, sleep });
const w3c = w3cClient({ sleep, log: (m) => console.error(m) });
const ref = openReference("observer", loadConfig());
const out = join(paths().root, "observer", batch);
mkdirSync(out, { recursive: true });
mkdirSync(replaysDir, { recursive: true });
const incoming = join(ref.paths.root, "incoming");
mkdirSync(incoming, { recursive: true });

// Games of earlier batches are not taken again.
const earlier = new Set<string>();
for (const b of readdirSync(join(paths().root, "observer"))) {
  const m = join(paths().root, "observer", b, "manifest.json");
  if (b !== batch && existsSync(m)) for (const e of JSON.parse(readFileSync(m, "utf8"))) earlier.add(String(e.w3info ?? e.w3c ?? e.key));
}

const manifestFile = join(out, "manifest.json");
const manifest: Record<string, unknown>[] = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : [];
const perCell = Number(arg("--per-cell", "1"));
const inCell = (band: string, mu: string) => manifest.filter((e) => e.band === band && e.mu === mu).length;
const taken = (band: string, mu: string) => inCell(band, mu) >= perCell;
const pace = Number(arg("--pace", "45")) * 1000; // seconds between W3Champions replay downloads
const limited = new Set<string>();
const LONG = 1200; // seconds: a cell's later games should be at least this long, if there are any
const count = (band: string) => manifest.filter((e) => e.band === band).length;

/** The replay's game build; -1 for a file the parser can't read (some warcraft3.info uploads). */
async function buildOf(buffer: Buffer): Promise<number> {
  try {
    return (await parseReplay(buffer)).output.buildNumber;
  } catch {
    return -1;
  }
}

/** Ingests, checks the version and simulates; copies the replay into the Replays folder if all is well. */
async function keep(buffer: Buffer, id: string, band: string, extra: Record<string, unknown>): Promise<boolean> {
  const replayBuild = await buildOf(buffer);
  if (replayBuild !== build) {
    console.log(`${id}: build ${replayBuild}, skipped`);
    return false;
  }
  const file = join(incoming, `${id.replace(/\W/g, "_")}.w3g`);
  writeFileSync(file, buffer);
  const res = await ingestFile(ref, file);
  unlinkSync(file);
  if (res.status !== "new") return false;
  const record: GameRecord = res.record;
  const sim = await simulateGame(record, { dataRoot: ref.paths.root, gamedataRoot: paths().root, mapFolders: [...mapFolders(ref.config), paths().maps], fromGame: builtinMap });
  applySim(ref, record.gameKey, sim);
  if (sim.status !== "ok") {
    console.log(`${id}: simulation failed (${sim.reason}), skipped`);
    return false;
  }
  if (record.classification.replayProblem) {
    console.log(`${id}: ${record.classification.replayProblem}, skipped`);
    return false;
  }
  const mu = matchup(record.players.map((p) => p.race));
  const mapShort = record.game.map.file.replace(/^.*[\\/]/, "").replace(/\.w3[xm]$/, "").replace(/^\d+_|w3c_\d+_\d+_/g, "").slice(0, 20);
  const name = `zq${String(manifest.length + 1).padStart(2, "0")}_${band}_${mu}_${mapShort}.w3g`;
  copyFileSync(record.provenance.archivePath, join(replaysDir, name));
  manifest.push({ file: name, key: record.gameKey, band, mu, map: record.game.map.file, names: record.players.map((p) => p.name), dur: Math.round(record.game.durationMs / 60000), durationMs: record.game.durationMs, ...extra });
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
  console.log(`${name}  ${record.players.map((p) => p.name).join(" vs ")}`);
  return true;
}

// --from <folder>: replays downloaded by hand (warcraft3.info limits downloads), all into one band
// (--band, default pro); nothing is downloaded.
const fromFolder = arg("--from", "");
if (fromFolder) {
  const band = arg("--band", "pro");
  for (const f of readdirSync(fromFolder).filter((f) => /\.(w3g|nwg)$/i.test(f)).sort()) {
    if (!(await keep(readFileSync(join(fromFolder, f)), f, band, { source: "w3info", from: f }))) console.log(`${f}: not added`);
  }
  console.log(`${manifest.length} replays in ${replaysDir} (${Object.keys(want).map((b) => `${b} ${count(b)}`).join(", ")})`);
  process.exit(0);
}

const season = await w3c.currentSeason();
for (const band of ["low", "avg", "high"] as const) {
  const [lo, hi] = BANDS[band];
  const candidates: { m: Awaited<ReturnType<typeof w3c.listMatches>>["matches"][number]; mu: string }[] = [];
  for (let page = 0; page < 12 * perCell && candidates.length < 200 * perCell; page++) {
    for (const gateway of [20, 10]) {
      const { matches } = await w3c.listMatches({ gateway, season, minMmr: lo - 150, maxMmr: hi + 150, offset: page * 50, pageSize: 50 });
      await sleep(2000);
      for (const m of matches) {
        const players = m.teams.flatMap((t) => t.players);
        if (players.length !== 2 || m.durationInSeconds < 480 || m.durationInSeconds > (perCell > 1 ? 2400 : 1500) || earlier.has(m.id)) continue;
        if (players.some((p) => p.oldMmr < lo || p.oldMmr > hi || W3C_RACE[p.race] === "R") || Math.abs(players[0].oldMmr - players[1].oldMmr) > 150) continue;
        candidates.push({ m, mu: matchup(players.map((p) => W3C_RACE[p.race])) });
      }
    }
  }
  candidates.sort((a, b) => THIN.indexOf(a.mu) - THIN.indexOf(b.mu));
  // Round 0 fills each cell's first place (8 to 25 minutes), the later rounds the others, longest first.
  const rounds = [candidates.filter((c) => c.m.durationInSeconds <= 1500)];
  for (let r = 1; r < perCell; r++) rounds.push([...candidates].sort((a, b) => THIN.indexOf(a.mu) - THIN.indexOf(b.mu) || b.m.durationInSeconds - a.m.durationInSeconds));
  for (const [round, list] of rounds.entries()) for (const { m, mu } of list) {
    if (count(band) >= want[band]) break;
    if (inCell(band, mu) > round || taken(band, mu) || manifest.some((e) => e.w3c === m.id)) continue;
    await sleep(pace);
    let buffer: Buffer | null = null;
    try {
      buffer = await w3c.downloadReplay(m.id);
    } catch (err) {
      // W3Champions asked us to slow down: wait half an hour once per band, then leave the band as it is.
      if (limited.has(band)) {
        console.log(`${band}: W3Champions asked to slow down again, band left at ${count(band)}`);
        break;
      }
      limited.add(band);
      console.log(`${band}: ${(err as Error).message}; waiting 30 minutes`);
      await sleep(30 * 60_000);
      continue;
    }
    if (!buffer) continue;
    const players = m.teams.flatMap((t) => t.players);
    await keep(buffer, `w3c-${m.id}`, band, { source: "w3c", w3c: m.id, mmr: players.map((p) => p.oldMmr) });
  }
  if (count(band) < want[band]) console.log(`${band}: only ${count(band)} of ${want[band]}`);
}

// warcraft3.info tournament games, newest first.
let olderInARow = 0;
outer: for (let page = 1; page <= 40 && count("pro") < want.pro; page++) {
  const { replays } = await w3i.listReplays(page);
  const fits = replays.filter((r) => r.type === "1on1" && r.players.length === 2 && r.duration >= 540 && r.duration <= (perCell > 1 ? 2400 : 1500) && !earlier.has(String(r.id)) && r.players.every((p) => w3iRace(p.race) && p.stats_player));
  fits.sort((a, b) => THIN.indexOf(matchup(a.players.map((p) => w3iRace(p.race)!))) - THIN.indexOf(matchup(b.players.map((p) => w3iRace(p.race)!))));
  for (const r of fits) {
    if (count("pro") >= want.pro) break outer;
    const mu = matchup(r.players.map((p) => w3iRace(p.race)!));
    // A cell's later places go to long games while the list is young; after 15 pages any length will do.
    if (inCell("pro", mu) >= 1 && r.duration < LONG && page <= 15) continue;
    if (taken("pro", mu) || manifest.some((e) => e.w3info === r.id)) continue;
    // warcraft3.info limits downloads too: wait half an hour and try again, three times at most.
    let buffer: Buffer | null = null;
    for (let attempt = 1; ; attempt++) {
      try {
        buffer = await w3i.download(r.id);
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        console.log(`warcraft3.info: ${(err as Error).message}; waiting 30 minutes`);
        await sleep(30 * 60_000);
      }
    }
    if (!buffer) continue;
    const itsBuild = await buildOf(buffer);
    if (itsBuild < 0) continue;
    if (itsBuild < build) {
      if (++olderInARow >= 8) break outer;
      continue;
    }
    olderInARow = 0;
    await keep(buffer, `w3i-${r.id}`, "pro", { source: "w3info", w3info: r.id });
  }
}
console.log(`${manifest.length} replays in ${replaysDir} (${Object.keys(want).map((b) => `${b} ${count(b)}`).join(", ")})`);
