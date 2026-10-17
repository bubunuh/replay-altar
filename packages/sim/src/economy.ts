// Economy from a WC3V simulation: what each player spent, lost, and (estimated) mined.
//
// WC3V reconstructs units, buildings, workers and food from the replay's commands. We do our
// own cost accounting on top of its unit timeline, because its built-in ResourceSeries counts
// the starting hall and workers as spending and prices tier upgrades cumulatively. Mined income
// is not observable at all; runIncome() estimates it from workers alive and the mine rules, with
// rates calibrated on real games (scripts/calibrate-economy.ts).
import { RACES, type GameRecord, type Metrics, type RaceCode, type SimSample } from "@w3stats/core";
import { costOf, type CostTables } from "./costs.ts";

// --- WC3V output (only the fields we read) -------------------------------------------------
type WUnit = {
  itemId: string;
  isIllusion?: boolean;
  spawnTime?: number | null;
  trainedTime?: number | null;
  constructionStartTime?: number | null;
  lostState?: { state: string; since: number } | null;
  levelStream?: { gameTime: number; newLevel: number }[];
};
type WEvent = {
  gameTime: number;
  supplyUsed?: number;
  supplyMax?: number;
  workers?: { totalWorkers: number; onBuild: number; ghoulsOnLumber?: number };
};
type WPlayer = {
  teamId: number;
  race: string;
  parseConfidence: number;
  isNeutralPlayer?: boolean;
  units?: WUnit[];
  eventStream?: WEvent[];
  tierStream?: { gameTime: number; tier: number }[];
  researchStream?: { gameTime: number; goldCost?: number; lumberCost?: number }[];
};
export type WOutput = {
  players: Record<string, WPlayer>;
  world?: { neutralGroups?: Record<string, { claimOwnerId: number | null; claimState: number; claimTime?: number | null }> };
  validation?: { warnings?: { player?: number | string; type?: string; message?: string }[] };
};

// --- Model constants ----------------------------------------------------------------------
export type EconomyConstants = {
  version: number;
  startGold: number;
  startLumber: number;
  workersPerMine: number;
  goldPerMine: number;
  /** Gold per second per worker on a mine (≤ workersPerMine per mine). */
  goldPerWorkerSecond: number;
  /** Lumber per second per lumber worker, per race (ghouls for Undead). */
  lumberPerWorkerSecond: Record<RaceCode, number>;
  /** Gold income multiplier above each food threshold (engine defaults: 50 → 0.7, 80 → 0.4). */
  upkeep: { aboveFood: number; goldFactor: number }[];
};

// --- Timeline: everything the income model needs, independent of its constants -----------
type Amount = { t: number; gold: number; lumber: number };
type Mine = { activeFrom: number; until: number };
export type Timeline = {
  playerId: number;
  race: RaceCode;
  teamId: number;
  endMs: number;
  spend: Amount[];
  losses: Amount[];
  /** Step functions, sorted by time: value applies from t until the next entry. */
  food: { t: number; used: number; max: number }[];
  workers: { t: number; total: number; onBuild: number; ghoulsOnLumber: number }[];
  mines: Mine[];
  tierStarts: Record<2 | 3, number | null>;
  heroLevels: { t: number; level: number }[];
  parseConfidence: number;
};

const toRace = (r: string): RaceCode => (r === "E" ? "N" : (r as RaceCode)); // WC3V uses E for Night Elf

function hallFamily(race: RaceCode) {
  const r = RACES[race];
  return { base: r.townHalls[0], all: new Set([...r.townHalls.filter((h) => h !== "ugol"), r.tier2, r.tier3]) };
}

/** Buildings priced as an upgrade of another (the table stores cumulative costs). */
const UPGRADED_FROM: Record<string, string> = {
  hkee: "htow", hcas: "hkee", ostr: "ogre", ofrt: "ostr", unp1: "unpl", unp2: "unp1", etoa: "etol", etoe: "etoa",
  hgtw: "hwtw", hctw: "hwtw", hatw: "hwtw", uzg1: "uzig", uzg2: "uzig",
};

/**
 * Spending from the replay's own orders (w3gjs), which list every build, train, research and
 * purchase. WC3V's unit list is not used for this: it only knows units someone selected, so it
 * misses most farms, and in some replays it places the starting hall and workers late enough
 * to look like purchases. Caveat: cancelled orders are still counted.
 */
export function spendFromOrders(build: GameRecord["players"][number]["build"], costs: CostTables): Amount[] {
  const spend: Amount[] = [];
  const researchLevel = new Map<string, number>();
  let heroes = 0;
  for (const b of build) {
    if (b.kind === "upgrade") {
      const u = costs.upgrades[b.code];
      if (!u) continue;
      const level = (researchLevel.get(b.code) ?? 0) + 1;
      researchLevel.set(b.code, level);
      spend.push({ t: b.ms, gold: u.goldBase + u.goldMod * (level - 1), lumber: u.lumberBase + u.lumberMod * (level - 1) });
    } else if (b.kind === "item") {
      const c = costs.items[b.code];
      if (c) spend.push({ t: b.ms, gold: c.gold, lumber: c.lumber });
    } else {
      const c = costOf(costs, b.code);
      if (c.isHero) {
        heroes++;
        if (heroes === 1) continue; // the first hero is free
      }
      const parent = UPGRADED_FROM[b.code];
      if (parent) {
        const p = costOf(costs, parent);
        spend.push({ t: b.ms, gold: Math.max(0, c.gold - p.gold), lumber: Math.max(0, c.lumber - p.lumber) });
      } else {
        spend.push({ t: b.ms, gold: c.gold, lumber: c.lumber });
      }
    }
  }
  return spend;
}

export function buildTimelines(o: WOutput, record: GameRecord, costs: CostTables): Timeline[] {
  const endMs = record.game.durationMs;
  const out: Timeline[] = [];
  for (const rp of record.players) {
    const p = o.players[String(rp.playerId)];
    if (!p || p.isNeutralPlayer) continue;
    const race = toRace(p.race);
    if (!RACES[race]) continue;
    const r = RACES[race];
    const halls = hallFamily(race);
    const units = (p.units ?? []).filter((u) => !u.isIllusion);
    // The starting hall and workers are placed together at the very start (0.8 s, or 2 s in
    // W3Champions replays); they are not purchases, and the starting hall is not an expansion.
    const firstSpawn = Math.min(...units.map((u) => u.spawnTime ?? Infinity));
    const isStarting = (u: WUnit) => (u.spawnTime ?? Infinity) <= firstSpawn + 1000;

    const spend = spendFromOrders(rp.build, costs);
    const losses: Amount[] = [];
    // WC3V infers deaths; most come back as "possiblyLost" rather than "lost". Like WC3V's own
    // charts we count both, so losses (and trades) are estimates.
    const isLost = (u: WUnit) => u.lostState?.state === "lost" || u.lostState?.state === "possiblyLost";
    for (const u of units) {
      if (!isLost(u) || costOf(costs, u.itemId).isHero) continue;
      const cost = halls.all.has(u.itemId) ? costOf(costs, halls.base) : costOf(costs, u.itemId);
      losses.push({ t: u.lostState!.since, gold: cost.gold, lumber: cost.lumber });
    }

    // Mines: the starting one plus each expansion ordered (Undead: Haunted Gold Mines), active
    // once built and until the simulation marks a matching expansion building as lost.
    const mineBuilding = race === "U" ? "ugol" : r.townHalls[0];
    const expansionLosses = units
      .filter((u) => !isStarting(u) && (race === "U" ? u.itemId === "ugol" : halls.all.has(u.itemId)) && u.lostState?.state === "lost")
      .map((u) => u.lostState!.since)
      .sort((a, b) => a - b);
    const mines: Mine[] = [{ activeFrom: 0, until: Infinity }];
    for (const b of rp.build) {
      if (b.kind !== "building" || b.code !== mineBuilding) continue;
      mines.push({ activeFrom: b.ms + costOf(costs, mineBuilding).buildMs, until: expansionLosses.shift() ?? Infinity });
    }

    const tierStarts: Timeline["tierStarts"] = {
      2: rp.build.find((b) => b.code === r.tier2)?.ms ?? null,
      3: rp.build.find((b) => b.code === r.tier3)?.ms ?? null,
    };

    const events = (p.eventStream ?? []).filter((e) => e.gameTime <= endMs).sort((a, b) => a.gameTime - b.gameTime);
    const food = events
      .filter((e) => typeof e.supplyUsed === "number" && typeof e.supplyMax === "number")
      .map((e) => ({ t: e.gameTime, used: e.supplyUsed!, max: e.supplyMax! }));
    const workers = events
      .filter((e) => e.workers)
      .map((e) => ({ t: e.gameTime, total: e.workers!.totalWorkers, onBuild: e.workers!.onBuild ?? 0, ghoulsOnLumber: e.workers!.ghoulsOnLumber ?? 0 }));
    const heroLevels = units
      .flatMap((u) => u.levelStream ?? [])
      .map((l) => ({ t: l.gameTime, level: l.newLevel }))
      .sort((a, b) => a.t - b.t);

    out.push({
      playerId: rp.playerId,
      race,
      teamId: p.teamId,
      endMs,
      spend: spend.sort((a, b) => a.t - b.t),
      losses: losses.sort((a, b) => a.t - b.t),
      food: food.length ? food : [{ t: 0, used: 5, max: 12 }],
      workers: workers.length ? workers : [{ t: 0, total: 5, onBuild: 0, ghoulsOnLumber: 0 }],
      mines,
      tierStarts,
      heroLevels,
      parseConfidence: p.parseConfidence,
    });
  }
  return out;
}

/** Value of a step function at time t (the last entry at or before t, else the first). */
function stepAt<T extends { t: number }>(steps: T[], t: number): T {
  let lo = 0;
  let hi = steps.length - 1;
  if (t < steps[0].t) return steps[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (steps[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return steps[lo];
}

export type IncomeResult = { series: SimSample[]; perSecond: { gold: number; lumber: number; spentGold: number; spentLumber: number }[] };

/** Second-by-second income model; returns 10 s samples plus the per-second banks used by calibration. */
export function runIncome(tl: Timeline, k: EconomyConstants): IncomeResult {
  const seconds = Math.ceil(tl.endMs / 1000);
  const mineLeft = tl.mines.map(() => k.goldPerMine);
  let goldMined = 0;
  let lumberMined = 0;
  let spentGold = 0;
  let spentLumber = 0;
  let lostGold = 0;
  let lostLumber = 0;
  let si = 0;
  let li = 0;
  const series: SimSample[] = [];
  const perSecond: IncomeResult["perSecond"] = [];

  for (let s = 0; s <= seconds; s++) {
    const t = s * 1000;
    const f = stepAt(tl.food, t);
    const w = stepAt(tl.workers, t);
    if (s > 0) {
      // Income during the second that just ended.
      const available = Math.max(0, w.total - w.onBuild);
      let goldWorkers = 0;
      let goldThisSecond = 0;
      const factor = k.upkeep.reduce((acc, u) => (f.used > u.aboveFood ? u.goldFactor : acc), 1);
      tl.mines.forEach((m, i) => {
        if (t < m.activeFrom || t >= m.until || mineLeft[i] <= 0) return;
        const onThis = Math.min(k.workersPerMine, available - goldWorkers);
        if (onThis <= 0) return;
        goldWorkers += onThis;
        const g = Math.min(mineLeft[i], onThis * k.goldPerWorkerSecond);
        mineLeft[i] -= g;
        goldThisSecond += g * factor;
      });
      const lumberWorkers = tl.race === "U" ? w.ghoulsOnLumber : Math.max(0, available - goldWorkers);
      goldMined += goldThisSecond;
      lumberMined += lumberWorkers * k.lumberPerWorkerSecond[tl.race];
    }
    while (si < tl.spend.length && tl.spend[si].t <= t) {
      spentGold += tl.spend[si].gold;
      spentLumber += tl.spend[si].lumber;
      si++;
    }
    while (li < tl.losses.length && tl.losses[li].t <= t) {
      lostGold += tl.losses[li].gold;
      lostLumber += tl.losses[li].lumber;
      li++;
    }
    perSecond.push({ gold: k.startGold + goldMined - spentGold, lumber: k.startLumber + lumberMined - spentLumber, spentGold, spentLumber });
    if (s % 10 === 0 || s === seconds) {
      series.push({
        t,
        goldSpent: spentGold,
        lumberSpent: spentLumber,
        goldLost: lostGold,
        lumberLost: lostLumber,
        foodUsed: f.used,
        foodMax: f.max,
        workers: w.total,
        estGoldMined: Math.round(goldMined),
        estLumberMined: Math.round(lumberMined),
        estGoldBank: Math.round(k.startGold + goldMined - spentGold),
        estLumberBank: Math.round(k.startLumber + lumberMined - spentLumber),
      });
    }
  }
  return { series, perSecond };
}

/** Income estimates are only reported up to here (see economyMetrics). */
export const ESTIMATE_HORIZON_MS = 600_000;

const at = (series: SimSample[], t: number) => series.filter((s) => s.t <= t).at(-1) ?? series[0];

/** The per-player metrics registered in core's SIM_METRICS. */
export function economyMetrics(
  tl: Timeline,
  income: IncomeResult,
  opponent: { tl: Timeline; income: IncomeResult } | null,
  o: WOutput,
  costs: CostTables,
): Metrics {
  const { series } = income;
  const last = series.at(-1)!;
  const r = RACES[tl.race];
  let blocked = 0;
  let low = 0;
  let high = 0;
  let unused = 0;
  const seconds = Math.ceil(tl.endMs / 1000);
  for (let s = 0; s < seconds; s++) {
    const f = stepAt(tl.food, s * 1000);
    if (f.used >= f.max && f.max < 100) blocked++;
    if (f.used > 80) high++;
    else if (f.used > 50) low++;
    unused += Math.max(0, f.max - f.used);
  }
  const camps = Object.values(o.world?.neutralGroups ?? {}).filter((g) => g.claimState === 2 && g.claimOwnerId === tl.teamId && typeof g.claimTime === "number");
  const campsBy = (ms: number) => camps.filter((g) => g.claimTime! <= ms).length;
  const heroLevelAt = (ms: number) => tl.heroLevels.filter((h) => h.t <= ms).reduce((m, h) => Math.max(m, h.level), 0);
  const lost = last.goldLost + last.lumberLost;
  const killedSample = opponent ? opponent.income.series.at(-1)! : null;
  const killed = killedSample ? killedSample.goldLost + killedSample.lumberLost : null;
  const past = (ms: number) => tl.endMs >= ms;
  const bankAt = (s: SimSample) => Math.max(0, s.estGoldBank) + Math.max(0, s.estLumberBank);
  const early = series.filter((s) => s.t <= ESTIMATE_HORIZON_MS);

  return {
    gold_spent_6m: past(360_000) ? at(series, 360_000).goldSpent : null,
    gold_spent_10m: past(600_000) ? at(series, 600_000).goldSpent : null,
    lumber_spent_10m: past(600_000) ? at(series, 600_000).lumberSpent : null,
    resources_spent_total: last.goldSpent + last.lumberSpent,
    resources_lost_total: lost,
    resources_killed_total: killed,
    trade_efficiency: killed !== null && killed + lost > 0 ? killed / (killed + lost) : null,
    workers_alive_6m: past(360_000) ? at(series, 360_000).workers : null,
    workers_alive_10m: past(600_000) ? at(series, 600_000).workers : null,
    tier2_done_ms: tl.tierStarts[2] === null ? null : tl.tierStarts[2] + costOf(costs, r.tier2).buildMs,
    tier3_done_ms: tl.tierStarts[3] === null ? null : tl.tierStarts[3] + costOf(costs, r.tier3).buildMs,
    expansions: tl.mines.filter((m) => m.activeFrom > 0 && m.activeFrom <= tl.endMs).length,
    creep_camps_6m: campsBy(360_000),
    creep_camps_10m: campsBy(600_000),
    hero_level_6m: past(360_000) ? heroLevelAt(360_000) : null,
    hero_level_10m: past(600_000) ? heroLevelAt(600_000) : null,
    supply_blocked_s: blocked,
    unused_supply_avg: seconds ? unused / seconds : null,
    upkeep_low_s: low,
    upkeep_high_s: high,
    est_gold_mined_10m: past(600_000) ? at(series, 600_000).estGoldMined : null,
    est_lumber_mined_10m: past(600_000) ? at(series, 600_000).estLumberMined : null,
    // The income model is calibrated mostly on single-mine play; past ~10 minutes (more mines,
    // Night Elf wisps WC3V under-counts) it drifts, so bank figures stop at 10:00.
    est_bank_avg: early.length ? early.reduce((sum, s) => sum + bankAt(s), 0) / early.length : null,
    est_bank_10m: past(600_000) ? bankAt(at(series, 600_000)) : null,
  };
}
