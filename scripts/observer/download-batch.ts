// Research: newest tournament 1v1s of the installed game version from warcraft3.info, for watching with
// the observer recorder (Warcraft III only opens replays of its own version). Spread over matchups;
// simulated with WC3V so recordings can be compared with it. Copies the replays into the game's
// Replays folder and writes a manifest for scripts/observer/batch-compare.py. One request every 10 s
// (the validation download may be running too).
//
//   node scripts/observer/download-batch.ts <batch name> <replays folder> [--count 25] [--build 7003]
import { copyFileSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applySim, ingestFile, loadConfig, mapFolders, parseReplay, paths, type GameRecord } from "@replay-altar/core";
import { simulateGame } from "@replay-altar/sim";
import { openReference, w3iRace, w3infoClient } from "@replay-altar/reference";
import { builtinMap } from "../../apps/collector/src/gamedata.ts";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const [batch, replaysDir] = process.argv.slice(2);
const count = Number(arg("--count", "25"));
const build = Number(arg("--build", "7003"));
const PER_MATCHUP = 4;
const GAP_MS = 10_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let last = 0;
const politeFetch = async (url: string, init?: RequestInit) => {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  return fetch(url, init);
};
const client = w3infoClient({ fetch: politeFetch as never, sleep });
const ref = openReference("observer", loadConfig());
const out = join(paths().root, "observer", batch);
mkdirSync(out, { recursive: true });
mkdirSync(replaysDir, { recursive: true });
const incoming = join(ref.paths.root, "incoming");
mkdirSync(incoming, { recursive: true });

const ORDER = "HONU";
const manifest: object[] = [];
const perMatchup = new Map<string, number>();
let olderInARow = 0;
outer: for (let page = 1; page <= 40; page++) {
  const { replays } = await client.listReplays(page);
  for (const r of replays) {
    if (manifest.length >= count) break outer;
    if (r.type !== "1on1" || r.players.length !== 2 || r.duration < 540 || r.duration > 1500) continue;
    const races = r.players.map((p) => w3iRace(p.race));
    if (races.some((x) => !x) || r.players.some((p) => !p.stats_player)) continue;
    const mu = (races as string[]).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join("v");
    if ((perMatchup.get(mu) ?? 0) >= PER_MATCHUP) continue;
    const buffer = await client.download(r.id);
    if (!buffer) continue;
    const replayBuild = (await parseReplay(buffer)).output.buildNumber;
    if (replayBuild !== build) {
      console.log(`${r.id}: build ${replayBuild}, skipped`);
      if (replayBuild < build && ++olderInARow >= 8) break outer; // newest first: the older version from here on
      continue;
    }
    olderInARow = 0;
    const file = join(incoming, `${r.id}.w3g`);
    writeFileSync(file, buffer);
    const res = await ingestFile(ref, file);
    unlinkSync(file);
    if (res.status !== "new") continue;
    const record: GameRecord = res.record;
    const sim = await simulateGame(record, { dataRoot: ref.paths.root, gamedataRoot: paths().root, mapFolders: [...mapFolders(ref.config), paths().maps], fromGame: builtinMap });
    applySim(ref, record.gameKey, sim);
    if (sim.status !== "ok") {
      console.log(`${r.id}: simulation failed (${sim.reason}), skipped`);
      continue;
    }
    perMatchup.set(mu, (perMatchup.get(mu) ?? 0) + 1);
    const name = `${String(manifest.length + 1).padStart(2, "0")}_${mu}_${r.map.replace(/\.w3[xm]$/, "").replace(/^\d+_|w3c_\d+_\d+_/g, "").slice(0, 20)}.w3g`;
    copyFileSync(record.provenance.archivePath, join(replaysDir, name));
    manifest.push({ file: name, key: record.gameKey, w3info: r.id, mu, map: record.game.map.file, names: record.players.map((p) => p.name), dur: Math.round(record.game.durationMs / 60000) });
    writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
    console.log(`${name}  ${r.players.map((p) => p.stats_player!.name).join(" vs ")}`);
  }
}
console.log(`${manifest.length} replays in ${replaysDir}`);
