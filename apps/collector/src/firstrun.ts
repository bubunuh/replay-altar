// What the collector sets up by itself the first time it runs (an installed copy has no one at a
// terminal to run setup commands): a guess at who you are, for you to confirm in the window, and
// the game data the simulation needs. Each step only runs when its result is missing.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { dataDir, loadConfig, parseReplay, saveConfig, seatsOf, type Config } from "@replay-altar/core";
import { simNotReady } from "@replay-altar/sim";
import { defaultWarcraftDir, extractGameData } from "./gamedata.ts";
import { isReplayFile } from "./watcher.ts";

/** Replays looked at to find your battletag, newest first. */
const SAMPLE = 20;

/**
 * Battletags in at least 60% of the replays looked at, most frequent first: whoever saved a replay
 * played in it, but a frequent opponent can pass too, so these are only suggestions.
 */
export function accountCandidates(count: Map<string, number>, games: number): { name: string; games: number; of: number }[] {
  const need = Math.max(2, Math.ceil(games * 0.6));
  return [...count].filter(([, n]) => n >= need).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, games: n, of: games }));
}

/**
 * The battletags most of your own replays have in common (newest first; ladder hosts in observer
 * slots are skipped with the observers), to suggest in the window.
 */
export async function detectAccounts(dirs: string[], log: (msg: string) => void): Promise<{ name: string; games: number; of: number }[]> {
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
  const found = accountCandidates(count, games);
  log(found.length ? `battletag suggestions from ${games} replays (waiting for you to confirm): ${found.map((x) => `${x.name} ${x.games}/${x.of}`).join(", ")}` : `could not tell your battletag from ${games} replays; set it in Settings`);
  return found;
}

/** Extracts the game data the simulation needs when it is missing and the game is installed. */
export function ensureGameData(log: (msg: string) => void, onStart: () => void = () => {}) {
  const problem = simNotReady(dataDir());
  if (!problem || !/game data/.test(problem)) return;
  const wc3 = defaultWarcraftDir();
  if (!existsSync(join(wc3, ".build.info"))) return log(`game data: no Warcraft III install found at ${wc3}`);
  onStart();
  try {
    extractGameData(wc3);
  } catch (e) {
    log(`game data extraction failed: ${(e as Error).message}`);
  }
}

/** `onSetup`: a slow step is starting (for the window's progress bar). */
export async function firstRun(config: Config, dirs: string[], log: (msg: string) => void, onSetup: (step: "gamedata") => void = () => {}): Promise<Config> {
  // Suggestions first (seconds), so the window can ask while the game data is extracted.
  if (!config.accounts.length && !config.suggestedAccounts?.length && dirs.length) {
    const suggestedAccounts = await detectAccounts(dirs, log);
    if (suggestedAccounts.length) saveConfig({ ...loadConfig(), suggestedAccounts });
  }
  ensureGameData(log, () => onSetup("gamedata"));
  return loadConfig();
}
