// Calibrates the income model's mining rates on your simulated games.
//
//   node scripts/calibrate-economy.ts [--write]
//
// Idea: nobody can spend money they don't have, so in every game the true rates must keep
// start + mined - spent >= 0 at all times. For each player-game we find the smallest gold rate
// (and lumber rate) that does that; real players run close to zero bank at their tightest
// moment, so the median of those minimums estimates the true rate. --write stores the result
// in packages/sim/src/economy-constants.json (with the sample it came from).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDb, paths, readRecord, type RaceCode } from "@w3stats/core";
import { buildTimelines, CONSTANTS, gamedataDir, loadCosts, readSimOutput, runIncome, type EconomyConstants, type Timeline } from "@w3stats/sim";

const SKIP_FIRST_MS = 60_000; // the opening is dominated by starting resources

// Priors from the game's harvest data (abilitydata.slk): 10 gold per ~5 s mining trip; Harvest
// (Ahar) 10 lumber per load at 1.1 s per chop plus walking; ghouls (Ahrl) 20 per load;
// wisps (Awha) 5 lumber per 7.5 s with no walking. Calibrated values may move within
// [0.6x, 1.6x] of these; a race with fewer than 3 samples keeps its prior.
const PRIOR = { gold: 2.0, lumber: { H: 0.5, O: 0.5, U: 0.85, N: 0.667 } as Record<RaceCode, number> };
const clampTo = (x: number, prior: number) => (Number.isFinite(x) ? Math.min(prior * 1.6, Math.max(prior * 0.6, x)) : prior);
const p = paths();
const db = openDb(p.db);

const costs = loadCosts(gamedataDir(p.root));

const timelines: { key: string; tl: Timeline }[] = [];
for (const { game_key } of db.prepare("SELECT game_key FROM games WHERE sim_status = 'ok'").all() as { game_key: string }[]) {
  const record = readRecord(p, game_key)!;
  if (record.sim?.status !== "ok") continue;
  for (const tl of buildTimelines(readSimOutput(record.sim.outputPath), record, costs)) timelines.push({ key: game_key, tl });
}

function minBank(tl: Timeline, k: EconomyConstants, which: "gold" | "lumber") {
  const { perSecond } = runIncome(tl, k);
  let min = Infinity;
  for (let s = Math.floor(SKIP_FIRST_MS / 1000); s < perSecond.length; s++) min = Math.min(min, perSecond[s][which]);
  return min;
}

/** Smallest rate that keeps the bank at or above zero (bank grows with the rate). */
function solve(tl: Timeline, which: "gold" | "lumber"): number {
  let lo = 0.05;
  let hi = 6;
  const withRate = (r: number): EconomyConstants =>
    which === "gold"
      ? { ...CONSTANTS, goldPerWorkerSecond: r, lumberPerWorkerSecond: { H: 9, O: 9, U: 9, N: 9 } }
      : { ...CONSTANTS, goldPerWorkerSecond: 9, lumberPerWorkerSecond: { H: r, O: r, U: r, N: r } };
  if (minBank(tl, withRate(hi), which) < 0) return NaN; // even absurd rates can't explain the spending
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (minBank(tl, withRate(mid), which) >= 0) hi = mid;
    else lo = mid;
  }
  return hi;
}

const median = (xs: number[]) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const rows = timelines.map(({ key, tl }) => ({ game: key.slice(0, 8), race: tl.race, gold: solve(tl, "gold"), lumber: solve(tl, "lumber") }));
console.table(rows.map((r) => ({ ...r, gold: r.gold.toFixed(3), lumber: r.lumber.toFixed(3) })));

const gold = clampTo(median(rows.map((r) => r.gold)), PRIOR.gold);
const lumberByRace = Object.fromEntries(
  (["H", "O", "U", "N"] as RaceCode[]).map((race) => {
    const xs = rows.filter((r) => r.race === race).map((r) => r.lumber).filter(Number.isFinite);
    return [race, xs.length >= 3 ? clampTo(median(xs), PRIOR.lumber[race]) : PRIOR.lumber[race]];
  }),
) as Record<RaceCode, number>;
const round = (x: number) => Math.round(x * 1000) / 1000;
const next: EconomyConstants & { calibration: unknown } = {
  ...CONSTANTS,
  version: CONSTANTS.version + 1,
  goldPerWorkerSecond: round(gold),
  lumberPerWorkerSecond: Object.fromEntries(Object.entries(lumberByRace).map(([k, v]) => [k, round(v)])) as Record<RaceCode, number>,
  calibration: {
    method: "median over player-games of the smallest rate that keeps start + mined - spent >= 0 after 60 s, clamped to [0.6x, 1.6x] of the harvest-data prior; races with < 3 samples use the prior",
    priors: PRIOR,
    rawMedians: { gold: median(rows.map((r) => r.gold)), lumber: Object.fromEntries((["H", "O", "U", "N"] as RaceCode[]).map((race) => [race, median(rows.filter((r) => r.race === race).map((r) => r.lumber))])) },
    at: new Date().toISOString(),
    playerGames: rows.length,
    perRaceSamples: Object.fromEntries((["H", "O", "U", "N"] as RaceCode[]).map((r) => [r, rows.filter((x) => x.race === r).length])),
  },
};
console.log(`gold per worker-second: ${next.goldPerWorkerSecond}`, "lumber per worker-second:", next.lumberPerWorkerSecond);
if (process.argv.includes("--write")) {
  const file = join(import.meta.dirname, "../packages/sim/src/economy-constants.json");
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  console.log(`wrote ${file} (model v${next.version}); run \`w3stats sim --resummarize\``);
}

