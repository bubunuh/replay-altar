// What the collector sets up by itself the first time it runs (an installed copy has no one at a
// terminal to run setup commands): who you are, the starting pro data, the game data the
// simulation needs. Each step only runs when its result is missing.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { dataDir, loadConfig, parseReplay, projectRoot, referencePaths, saveConfig, seatsOf, type Config } from "@replay-altar/core";
import { simNotReady } from "@replay-altar/sim";
import { defaultWarcraftDir, extractGameData } from "./gamedata.ts";
import { isReplayFile } from "./watcher.ts";

/** Replays looked at to find your battletag, newest first. */
const SAMPLE = 20;

/**
 * Your battletag(s) when the settings have none: the name in most of your own replays (whoever
 * saved a replay played in it). Ladder hosts in observer slots are skipped with the observers.
 */
export async function detectAccounts(dirs: string[], log: (msg: string) => void): Promise<string[]> {
  const files = dirs
    .flatMap((d) => readdirSync(d).filter(isReplayFile).map((f) => join(d, f)))
    .map((f) => ({ f, t: statSync(f).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, SAMPLE);
  const count = new Map<string, number>();
  let games = 0;
  for (const { f } of files) {
    try {
      const raw = await parseReplay(readFileSync(f));
      const names = new Set(seatsOf(raw).filter((s) => !s.isObserver && !s.isComputer).map((s) => s.name));
      games++;
      for (const n of names) count.set(n, (count.get(n) ?? 0) + 1);
    } catch {
      // unreadable replay: skip
    }
  }
  const need = Math.max(2, Math.ceil(games * 0.6));
  const found = [...count].filter(([, n]) => n >= need).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  log(found.length ? `your battletag, from ${games} replays: ${found.join(", ")}` : `could not tell your battletag from ${games} replays; set it in Settings`);
  return found;
}

/** Copies the pro data shipped with the install (seed/reference/<group>/*.json) where none was downloaded yet. */
export function seedReference(log: (msg: string) => void) {
  const seed = join(projectRoot(), "seed/reference");
  if (!existsSync(seed)) return;
  for (const group of readdirSync(seed)) {
    const to = referencePaths(group).root;
    if (existsSync(join(to, "profile.json"))) continue;
    mkdirSync(to, { recursive: true });
    for (const f of readdirSync(join(seed, group))) copyFileSync(join(seed, group, f), join(to, f));
    log(`pro data for ${group} copied from the install`);
  }
}

/** Extracts the game data the simulation needs when it is missing and the game is installed. */
export function ensureGameData(log: (msg: string) => void) {
  const problem = simNotReady(dataDir());
  if (!problem || !/game data/.test(problem)) return;
  const wc3 = defaultWarcraftDir();
  if (!existsSync(join(wc3, ".build.info"))) return log(`game data: no Warcraft III install found at ${wc3}`);
  try {
    extractGameData(wc3);
  } catch (e) {
    log(`game data extraction failed: ${(e as Error).message}`);
  }
}

export async function firstRun(config: Config, dirs: string[], log: (msg: string) => void): Promise<Config> {
  seedReference(log);
  ensureGameData(log);
  if (config.accounts.length || !dirs.length) return config;
  const accounts = await detectAccounts(dirs, log);
  if (!accounts.length) return config;
  const next = { ...loadConfig(), accounts };
  saveConfig(next);
  return next;
}
