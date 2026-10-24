// Research: a recording batch spread over skill levels, for the WC3V lab. W3Champions ladder 1v1s at
// three MMR bands plus warcraft3.info tournament games, all of the installed game version (Warcraft III
// only opens replays of its own version), at most one game per matchup per band, simulated with WC3V.
// Copies the replays into the game's Replays folder and writes a manifest for batch-compare.py.
// Polite: W3Champions one replay every 45 s, warcraft3.info one request every 10 s.
//
//   node scripts/observer/download-mixed.ts <batch name> <replays folder> [--low 6] [--avg 8] [--high 8] [--pro 8] [--build 7003]
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
if (!batch || !replaysDir) throw new Error("usage: <batch name> <replays folder> [--low 6] [--avg 8] [--high 8] [--pro 8]");
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
  const wait = lastW3i + 10_000 - Date.now();
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
const taken = (band: string, mu: string) => manifest.some((e) => e.band === band && e.mu === mu);
const count = (band: string) => manifest.filter((e) => e.band === band).length;

/** Ingests, checks the version and simulates; copies the replay into the Replays folder if all is well. */
async function keep(buffer: Buffer, id: string, band: string, extra: Record<string, unknown>): Promise<boolean> {
  const replayBuild = (await parseReplay(buffer)).output.buildNumber;
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
  const mu = matchup(record.players.map((p) => p.race));
  const mapShort = record.game.map.file.replace(/^.*[\\/]/, "").replace(/\.w3[xm]$/, "").replace(/^\d+_|w3c_\d+_\d+_/g, "").slice(0, 20);
  const name = `${String(manifest.length + 1).padStart(2, "0")}_${band}_${mu}_${mapShort}.w3g`;
  copyFileSync(record.provenance.archivePath, join(replaysDir, name));
  manifest.push({ file: name, key: record.gameKey, band, mu, map: record.game.map.file, names: record.players.map((p) => p.name), dur: Math.round(record.game.durationMs / 60000), ...extra });
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
  console.log(`${name}  ${record.players.map((p) => p.name).join(" vs ")}`);
  return true;
}

// W3Champions ladder: both players in the band and within 150 MMR of each other.
const season = await w3c.currentSeason();
for (const band of ["low", "avg", "high"] as const) {
  const [lo, hi] = BANDS[band];
  const candidates: { m: Awaited<ReturnType<typeof w3c.listMatches>>["matches"][number]; mu: string }[] = [];
  for (let page = 0; page < 12 && candidates.length < 200; page++) {
    for (const gateway of [20, 10]) {
      const { matches } = await w3c.listMatches({ gateway, season, minMmr: lo - 150, maxMmr: hi + 150, offset: page * 50, pageSize: 50 });
      await sleep(2000);
      for (const m of matches) {
        const players = m.teams.flatMap((t) => t.players);
        if (players.length !== 2 || m.durationInSeconds < 480 || m.durationInSeconds > 1500 || earlier.has(m.id)) continue;
        if (players.some((p) => p.oldMmr < lo || p.oldMmr > hi || W3C_RACE[p.race] === "R") || Math.abs(players[0].oldMmr - players[1].oldMmr) > 150) continue;
        candidates.push({ m, mu: matchup(players.map((p) => W3C_RACE[p.race])) });
      }
    }
  }
  candidates.sort((a, b) => THIN.indexOf(a.mu) - THIN.indexOf(b.mu));
  for (const { m, mu } of candidates) {
    if (count(band) >= want[band]) break;
    if (taken(band, mu) || manifest.some((e) => e.w3c === m.id)) continue;
    await sleep(45_000);
    const buffer = await w3c.downloadReplay(m.id);
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
  const fits = replays.filter((r) => r.type === "1on1" && r.players.length === 2 && r.duration >= 540 && r.duration <= 1500 && !earlier.has(String(r.id)) && r.players.every((p) => w3iRace(p.race) && p.stats_player));
  fits.sort((a, b) => THIN.indexOf(matchup(a.players.map((p) => w3iRace(p.race)!))) - THIN.indexOf(matchup(b.players.map((p) => w3iRace(p.race)!))));
  for (const r of fits) {
    if (count("pro") >= want.pro) break outer;
    if (taken("pro", matchup(r.players.map((p) => w3iRace(p.race)!))) || manifest.some((e) => e.w3info === r.id)) continue;
    const buffer = await w3i.download(r.id);
    if (!buffer) continue;
    if ((await parseReplay(buffer)).output.buildNumber < build) {
      if (++olderInARow >= 8) break outer;
      continue;
    }
    olderInARow = 0;
    await keep(buffer, `w3i-${r.id}`, "pro", { source: "w3info", w3info: r.id });
  }
}
console.log(`${manifest.length} replays in ${replaysDir} (${Object.keys(want).map((b) => `${b} ${count(b)}`).join(", ")})`);
