// Army size and value over time, hero timelines (levels, deaths, revives), and a units-killed
// estimate. Validated against W3Champions' official numbers on 56 pro player-games:
// - "largest army" (game counts it in food) vs our max army food: correlation 0.90, 0.95x
// - "units killed" (game counts creeps too) vs (enemy losses + creeps in camps you cleared) x 1.49:
//   correlation 0.90
import { RACES, type GameRecord, type HeroTimeline } from "@replay-altar/core";
import { costOf, type CostTables } from "./costs.ts";
import type { WOutput } from "./economy.ts";

const WORKERS = new Set(Object.values(RACES).map((r) => r.worker));
const HERO_FOOD = 5;

type WUnitX = {
  itemId: string;
  spawnTime?: number | null;
  trainedTime?: number | null;
  lostState?: { state: string; since: number } | null;
  path?: { gameTime: number }[];
};

const isLost = (u: WUnitX) => u.lostState?.state === "lost" || u.lostState?.state === "possiblyLost";

/**
 * Army food and value at time t. Food comes from the simulation's supply (food used minus
 * workers minus heroes); value prices that food at the average cost per food of the army units
 * you had finished training by then (from your orders), so 10 food of Knights is worth more
 * than 10 food of Footmen.
 */
export function armyAt(
  t: number,
  foodUsed: number,
  workers: number,
  player: GameRecord["players"][number],
  costs: CostTables,
): { armyFood: number; armyValue: number } {
  const heroes = player.heroes.filter((h) => (h.levelUps?.[0] ?? Infinity) <= t).length;
  const armyFood = Math.max(0, foodUsed - workers - heroes * HERO_FOOD);
  let value = 0;
  let food = 0;
  for (const b of player.build) {
    if (b.kind !== "unit" || WORKERS.has(b.code)) continue;
    const c = costOf(costs, b.code);
    if (c.isHero || c.food <= 0 || b.ms + c.buildMs > t) continue;
    value += c.gold + c.lumber;
    food += c.food;
  }
  return { armyFood, armyValue: food > 0 ? Math.round((armyFood * value) / food) : 0 };
}

/** Revive duration in ms by the game's formula (miscgame: factor 0.6 per level, at most 2x build time, max 150 s). */
const reviveMs = (buildMs: number, level: number) => Math.min(150_000, buildMs * level * 0.6, buildMs * 2);

/**
 * When each hero appeared, levelled, died and came back. Levels are exact (replay skill
 * points). Deaths are approximate: a dead hero can't be ordered around, so the death is taken as
 * its last movement before the revive order; it is back after the game's revive time.
 */
export function heroTimelines(o: WOutput, playerId: number, player: GameRecord["players"][number], costs: CostTables, endMs: number): HeroTimeline[] {
  const wp = o.players[String(playerId)] as unknown as { units?: WUnitX[]; eventStream?: { key?: string; gameTime: number; hero?: string | { itemId?: string } }[] } | undefined;
  const units = wp?.units ?? [];
  // The revive event carries the hero as a unit object ({ itemId, ... }).
  const heroOf = (e: { hero?: string | { itemId?: string } }) => (typeof e.hero === "string" ? e.hero : e.hero?.itemId);
  const revives = (wp?.eventStream ?? []).filter((e) => e.key === "heroRevive" && heroOf(e));
  return player.heroes.map((h) => {
    const unit = units.find((u) => u.itemId === h.code);
    const levels = h.levelUps ?? [];
    const appearAt = unit?.trainedTime ?? unit?.spawnTime ?? levels[0] ?? null;
    const levelAt = (t: number) => Math.max(1, levels.filter((x) => x <= t).length);
    const buildMs = costOf(costs, h.code).buildMs || 55_000;
    const pathTimes = (unit?.path ?? []).map((p) => p.gameTime).sort((a, b) => a - b);
    const deaths: HeroTimeline["deaths"] = [];
    let lastRevive = appearAt ?? 0;
    for (const r of revives.filter((e) => heroOf(e) === h.code).sort((a, b) => a.gameTime - b.gameTime)) {
      const before = pathTimes.filter((x) => x < r.gameTime - 1000 && x >= lastRevive);
      const diedAt = before.length ? before[before.length - 1] : r.gameTime;
      const revivedAt = Math.min(endMs, r.gameTime + reviveMs(buildMs, levelAt(r.gameTime)));
      deaths.push({ diedAt, revivedAt });
      lastRevive = revivedAt;
    }
    if (unit?.lostState?.state === "lost" && unit.lostState.since > lastRevive) deaths.push({ diedAt: unit.lostState.since, revivedAt: null });
    return { code: h.code, name: h.name, appearAt, levelUps: levels, deaths };
  });
}

/**
 * Enemy units (not buildings, not heroes; the game counts those separately) the simulation saw
 * die, plus creeps in camps your side cleared, times the fitted factor.
 */
export function unitsKilledEstimate(o: WOutput, playerId: number, teamId: number, factor: number, costs: CostTables): number {
  const enemies = Object.entries(o.players).filter(([pid, p]) => Number(pid) !== playerId && !p.isNeutralPlayer && p.teamId !== teamId);
  const isUnit = (id: string) => {
    const c = costOf(costs, id);
    return c.food > 0 && !c.isHero;
  };
  let lost = 0;
  for (const [, p] of enemies) lost += ((p.units ?? []) as WUnitX[]).filter((u) => isLost(u) && isUnit(u.itemId)).length;
  const camps = Object.values(o.world?.neutralGroups ?? {}) as { claimState: number; claimOwnerId: number | null; units?: unknown[] }[];
  const creeps = camps.filter((g) => g.claimState === 2 && g.claimOwnerId === teamId).reduce((s, g) => s + (g.units?.length ?? 0), 0);
  return Math.round((lost + creeps) * factor);
}
