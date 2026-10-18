// One player's game reduced to milestones: when (game time) and at what food count each step
// of a game plan happened. Pros hit their milestones at similar food counts whatever the build
// (tier 2 around 27 food, first hero level 3 around 34, tier 3 around 53), so food is the common
// scale for comparing builds; scripts/mine-principles.ts collects these over the pro games.
import type { GameRecord, PlayerRecord, SimSample } from "@replay-altar/core/ui";
import { RACES, type RaceCode } from "@replay-altar/core/gamedata";
import { openingOf } from "./openings.ts";
import { at, productionGap } from "./series.ts";

export const MILESTONES = [
  "tier2", "tier3", "hero1", "hero2", "hero3", "hero1_l3", "hero2_l3", "hero1_l5",
  "expansion", "first_army", "first_attack_upgrade", "first_armor_upgrade", "food50", "food60", "goal3360",
] as const;
export type MilestoneKey = (typeof MILESTONES)[number];
export type Point = { ms: number; food: number };

/** Greed (fast expand or tech), safety (early towers), aggression (early pressure), or standard. */
export type Posture = "greed" | "safety" | "aggression" | "standard";

export type Milestones = {
  race: RaceCode;
  opponentRace: string;
  win: boolean | null;
  durationMs: number;
  opening: string[];
  posture: Posture[];
  at: Record<MilestoneKey, Point | null>;
  workers6: number | null;
  workers10: number | null;
  workersMax: number | null;
  /** Share of game time (after 1:00) at 46-50 food, 51-80 (low upkeep) and 81+ (high upkeep). */
  timeShare: { at50: number; low: number; high: number } | null;
  creepCamps6: number | null;
  creepCamps10: number | null;
  itemsBought: number | null;
  potionsBought: number | null;
  towerOrders: number | null;
  heroDeaths: number | null;
  tradeEfficiency: number | null;
  /** Within 4 minutes of first reaching 50 food: fought the opponent, expanded or started tier 3. */
  spikeUsed: boolean | null;
  /** From the first hero appearing to the first creep fight. */
  creepDelayMs: number | null;
  workersLost12: number | null;
  /** Tower build/upgrade orders per base (1 + expansions). */
  towersPerBase: number | null;
  /** Seconds above 80 food with fewer than 2 expansions ordered. */
  highUpkeepFewBasesS: number | null;
  /** Average unspent gold over the first 10 minutes (estimate). */
  bankAvg: number | null;
  /** Longest stretch to 10:00 with gold, supply room and no army unit trained (series.ts productionGap). */
  productionGapS: number | null;
};

const point = (series: SimSample[], ms: number | null | undefined): Point | null => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  const s = at(series, ms);
  return { ms, food: s?.foodUsed ?? 0 };
};

export function postureOf(opening: string[]): Posture[] {
  const has = (re: RegExp) => opening.some((l) => re.test(l));
  const out: Posture[] = [];
  if (has(/^fast expand|^fast tech/)) out.push("greed");
  if (has(/^early towers/) && !has(/early pressure/)) out.push("safety");
  if (has(/early pressure|^fast Riflemen|^Headhunter|^fast Huntresses/)) out.push("aggression");
  return out.length ? out : ["standard"];
}

export function milestonesOf(r: GameRecord, playerId: number): Milestones | null {
  const p = r.players.find((x) => x.playerId === playerId);
  const opp = r.players.find((x) => x.playerId !== playerId && x.teamId !== p?.teamId);
  const race = p?.race as RaceCode;
  const R = RACES[race];
  if (!p || !opp || !R || r.sim?.status !== "ok") return null;
  const sim = r.sim.players.find((x) => x.playerId === playerId);
  const series = sim?.series ?? [];
  if (!series.length) return null;
  const b = p.build;
  const first = (pred: (x: (typeof b)[number]) => boolean) => b.find(pred)?.ms ?? null;
  const heroes = [...p.heroes].sort((a, c) => a.order - c.order);
  const halls = b.filter((x) => x.kind === "building" && R.townHalls.includes(x.code)).map((x) => x.ms);
  const m = p.metrics;
  const t50 = series.find((s) => s.foodUsed >= 50)?.t ?? null;
  const t60 = series.find((s) => s.foodUsed >= 60)?.t ?? null;
  const tier3 = first((x) => x.code === R.tier3);

  let spikeUsed: boolean | null = null;
  if (t50 !== null && r.game.durationMs >= t50 + 240_000) {
    const fought = (r.sim.fights ?? []).some((f) => f.start >= t50 && f.start <= t50 + 240_000 && f.initiatorId === playerId && f.playerIds.includes(opp.playerId));
    spikeUsed = fought || halls.some((t) => t >= t50 - 60_000 && t <= t50 + 240_000) || (tier3 !== null && tier3 <= t50 + 240_000);
  }
  const after = series.filter((s) => s.t > 60_000);
  const share = (lo: number, hi: number) => (after.length ? after.filter((s) => s.foodUsed >= lo && s.foodUsed <= hi).length / after.length : 0);
  const opening = openingOf(p);
  const deaths = sim?.heroes ? sim.heroes.reduce((n, h) => n + h.deaths.length, 0) : null;
  const heroAppear = Math.min(...(sim?.heroes ?? []).map((h) => h.appearAt ?? Infinity));
  let highFew = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i].foodUsed > 80 && halls.filter((t) => t <= series[i].t).length < 2) highFew += (series[i].t - series[i - 1].t) / 1000;
  }

  return {
    race,
    opponentRace: opp.race,
    win: p.result === "win" ? true : p.result === "loss" ? false : null,
    durationMs: r.game.durationMs,
    opening,
    posture: postureOf(opening),
    at: {
      tier2: point(series, first((x) => x.code === R.tier2)),
      tier3: point(series, tier3),
      hero1: point(series, heroes[0]?.levelUps[0]),
      hero2: point(series, heroes[1]?.levelUps[0]),
      hero3: point(series, heroes[2]?.levelUps[0]),
      hero1_l3: point(series, heroes[0]?.levelUps[2]),
      hero2_l3: point(series, heroes[1]?.levelUps[2]),
      hero1_l5: point(series, heroes[0]?.levelUps[4]),
      expansion: point(series, halls[0]),
      first_army: point(series, first((x) => x.kind === "unit" && x.code !== R.worker)),
      first_attack_upgrade: point(series, m.first_attack_upgrade_ms),
      first_armor_upgrade: point(series, m.first_armor_upgrade_ms),
      food50: point(series, t50),
      food60: point(series, t60),
      goal3360: point(series, m.goal_3360_ms),
    },
    workers6: at(series, 360_000)?.workers ?? null,
    workers10: r.game.durationMs >= 600_000 ? (at(series, 600_000)?.workers ?? null) : null,
    workersMax: Math.max(...series.map((s) => s.workers)),
    timeShare: after.length ? { at50: share(46, 50), low: share(51, 80), high: share(81, 200) } : null,
    creepCamps6: m.creep_camps_6m ?? null,
    creepCamps10: m.creep_camps_10m ?? null,
    itemsBought: m.items_bought ?? null,
    potionsBought: m.potions_bought ?? null,
    towerOrders: m.towers_total ?? null,
    heroDeaths: deaths,
    tradeEfficiency: m.trade_efficiency ?? null,
    spikeUsed,
    creepDelayMs: Number.isFinite(heroAppear) && m.first_creep_ms !== null && m.first_creep_ms !== undefined ? Math.max(0, m.first_creep_ms - heroAppear) : null,
    workersLost12: m.workers_lost_12m ?? null,
    towersPerBase: m.towers_total === null || m.towers_total === undefined ? null : m.towers_total / (1 + halls.length),
    highUpkeepFewBasesS: Math.round(highFew),
    bankAvg: m.est_bank_avg ?? null,
    productionGapS: productionGap(r, p, R.worker)?.s ?? null,
  };
}

/** Players worth learning from in a reference game: both, when they play the group's race. */
export const subjectsOf = (r: GameRecord, race: string): PlayerRecord[] => r.players.filter((p) => p.race === race && (p.result === "win" || p.result === "loss"));
