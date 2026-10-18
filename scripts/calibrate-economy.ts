// Calibrates the income model's gold mining rate.
//
//   node scripts/calibrate-economy.ts [--write]
//
// Preferred method: fit to the game's own "gold collected" (W3Champions score sheets, for your
// W3C games and the reference games): pick the rate at which the model's end-of-game gold
// matches the official number on median. Fallback with fewer than 20 such player-games: nobody
// can spend money they don't have, so take the median over games of the smallest rate that
// keeps start + mined - spent >= 0 (this over-shoots, because order-based spending counts
// cancelled orders and pays a little early).
//
// Lumber keeps the harvest-data priors: our lumber estimate correlated only 0.60 with the
// official numbers and is no longer reported.
//
// --write stores the result in packages/sim/src/economy-constants.json, then run
// `replay-altar sim --resummarize` (and `replay-altar reingest` for the reference games).
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, paths, readRecord, referencePaths, type GameRecord } from "@replay-altar/core";
import { buildTimelines, CONSTANTS, gamedataDir, loadCosts, readSimOutput, runIncome, unitsKilledEstimate, type EconomyConstants, type Timeline } from "@replay-altar/sim";

const MIN_OFFICIAL = 20;
const SKIP_FIRST_MS = 60_000;
const PRIOR_GOLD = 2.0; // 10 gold per ~5 s mining trip (abilitydata.slk, Harvest)

const costs = loadCosts(gamedataDir(paths().root));
const roots = [paths(), ...loadConfig().reference.groups.map((g) => referencePaths(g.id))];

type Sample = { tl: Timeline; official: number | null; minutes: number };
const samples: Sample[] = [];
for (const p of roots) {
  for (const f of readdirSync(p.games)) {
    const r = readRecord(p, f.replace(/\.json$/, "")) as GameRecord | null;
    if (!r || r.sim?.status !== "ok") continue;
    for (const tl of buildTimelines(readSimOutput(r.sim.outputPath), r, costs)) {
      const op = r.official?.status === "ok" ? r.official.players.find((x) => x.playerId === tl.playerId) : undefined;
      samples.push({ tl, official: op?.goldCollected ?? null, minutes: r.game.durationMs / 60_000 });
    }
  }
}

const withGold = (g: number): EconomyConstants => ({ ...CONSTANTS, goldPerWorkerSecond: g });
const median = (xs: number[]) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const endGold = (s: Sample, k: EconomyConstants) => runIncome(s.tl, k).series.at(-1)!.estGoldMined;

/** Rate at which f(rate) crosses the target, f increasing in rate. */
function bisect(f: (g: number) => number, target: number) {
  let lo = 0.3;
  let hi = 6;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > target) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

const official = samples.filter((s) => s.official !== null && s.official > 0);
let gold: number;
let calibration: Record<string, unknown>;
if (official.length >= MIN_OFFICIAL) {
  gold = bisect((g) => median(official.map((s) => endGold(s, withGold(g)) / s.official!)), 1);
  const k = withGold(gold);
  const errs = official.map((s) => Math.abs(endGold(s, k) - s.official!) / s.official!);
  const ratioFor = (pred: (s: Sample) => boolean) => median(official.filter(pred).map((s) => endGold(s, k) / s.official!));
  calibration = {
    method: "median end-of-game estimate = official gold collected (W3Champions score sheets)",
    playerGames: official.length,
    medianAbsError: Math.round(median(errs) * 1000) / 1000,
    medianRatioUnder15Min: Math.round(ratioFor((s) => s.minutes < 15) * 100) / 100,
    medianRatioFrom15Min: Math.round(ratioFor((s) => s.minutes >= 15) * 100) / 100,
  };
} else {
  const minBank = (tl: Timeline, g: number) => {
    const { perSecond } = runIncome(tl, { ...withGold(g), lumberPerWorkerSecond: { H: 9, O: 9, U: 9, N: 9 } });
    let min = Infinity;
    for (let s = SKIP_FIRST_MS / 1000; s < perSecond.length; s++) min = Math.min(min, perSecond[s].gold);
    return min;
  };
  gold = median(samples.map((s) => bisect((g) => minBank(s.tl, g), 0)));
  gold = Math.min(PRIOR_GOLD * 1.6, Math.max(PRIOR_GOLD * 0.6, gold));
  calibration = { method: "median smallest rate keeping start + mined - spent >= 0 (fallback: fewer than 20 official samples)", playerGames: samples.length };
}

// Units killed: official count / (enemy units seen dying + creeps in cleared camps), median.
const killRatios: number[] = [];
for (const p of roots) {
  for (const f of readdirSync(p.games)) {
    const r = readRecord(p, f.replace(/\.json$/, "")) as GameRecord | null;
    if (!r || r.sim?.status !== "ok" || r.official?.status !== "ok") continue;
    const o = readSimOutput(r.sim.outputPath);
    for (const op of r.official.players) {
      const pl = r.players.find((x) => x.playerId === op.playerId);
      if (!pl) continue;
      const base = unitsKilledEstimate(o, op.playerId, pl.teamId, 1, costs);
      if (base > 0) killRatios.push(op.unitsKilled / base);
    }
  }
}
const unitsKilledFactor = killRatios.length >= MIN_OFFICIAL ? Math.round(median(killRatios) * 100) / 100 : CONSTANTS.unitsKilledFactor ?? 1.49;

const next = {
  ...CONSTANTS,
  unitsKilledFactor,
  version: CONSTANTS.version + 1,
  goldPerWorkerSecond: Math.round(gold * 1000) / 1000,
  calibration: { ...calibration, priorGold: PRIOR_GOLD, unitsKilledSamples: killRatios.length, at: new Date().toISOString() },
};
console.log(`gold per worker-second: ${next.goldPerWorkerSecond}`, next.calibration);
if (process.argv.includes("--write")) {
  const file = join(import.meta.dirname, "../packages/sim/src/economy-constants.json");
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  console.log(`wrote ${file} (model v${next.version}); run \`replay-altar reingest\` and \`replay-altar sim --resummarize\``);
}
