// Army size and value over time, hero timelines (levels, deaths, revives), and a units-killed
// estimate. Validated against W3Champions' official numbers on 86 pro player-games (0.2.2):
// - "largest army" (game counts it in food) vs our max army food: correlation 0.86, 1.02x
// - "units killed" (game counts creeps too) vs (enemy losses + creeps in camps you cleared) x 1.29:
//   correlation 0.93
import { baseUnit, RACES, type GameRecord, type HeroTimeline } from "@replay-altar/core";
import { costOf, type CostTables } from "./costs.ts";
import type { WOutput } from "./economy.ts";
import { diedAt } from "./deaths.ts";

const WORKERS = new Set(Object.values(RACES).map((r) => r.worker));
/** Militia are Peasants called to arms for 45 s: workers, not army (WC3V often misses their return to work). */
const NOT_ARMY = new Set([...WORKERS, "hmil"]);
const HERO_FOOD = 5;

type WUnitX = {
  itemId: string;
  spawnTime?: number | null;
  trainedTime?: number | null;
  lostState?: { state: string; since: number } | null;
  path?: { gameTime: number }[];
};

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

/**
 * Army value at each time from the simulation's own units: what the army units finished by then
 * cost, minus those that died by then (WC3V's lost or possibly lost, like the loss series; `o`
 * without the units that never existed, deaths.ts). The supply count can't be used for this: the
 * simulation rarely takes dead units off it (pros sit at "100 food" after losing half their army),
 * so a wiped army still looked full. A unit that changed form (Obsidian Statue to Destroyer) is
 * valued as what it was then. Militia don't count (NOT_ARMY).
 */
export function armyValueFn(o: WOutput, playerId: number, costs: CostTables): (t: number) => number {
  type U = WUnitX & { isBuilding?: boolean; isIllusion?: boolean; morphHistory?: { gameTime: number; itemId: string; from: string }[] };
  const units = ((o.players[String(playerId)] as unknown as { units?: U[] })?.units ?? [])
    .filter((u) => !u.isBuilding && !u.isIllusion && !NOT_ARMY.has(u.itemId))
    .map((u) => ({ u, c: costOf(costs, u.itemId) }))
    .filter(({ c }) => !c.isHero && c.food > 0)
    .map(({ u, c }) => {
      const morphs = [...(u.morphHistory ?? [])].sort((a, b) => a.gameTime - b.gameTime);
      const before = morphs.length ? costOf(costs, morphs[0].from) : c;
      return { from: u.trainedTime ?? u.spawnTime ?? Infinity, to: diedAt(u) ?? Infinity, morphAt: morphs[0]?.gameTime ?? -Infinity, value: c.gold + c.lumber, valueBefore: before.gold + before.lumber };
    });
  return (t) => units.reduce((n, x) => (x.from <= t && x.to > t ? n + (t < x.morphAt ? x.valueBefore : x.value) : n), 0);
}

/** Revive duration in ms by the game's formula (miscgame: factor 0.6 per level, at most 2x build time, max 150 s). */
const reviveMs = (buildMs: number, level: number) => Math.min(150_000, buildMs * level * 0.6, buildMs * 2);

/**
 * The simulation's unit for a hero. WC3V makes a hero for every train order, also one cancelled
 * at the altar (seen for every cancel in our corpora); the real one is the last trained before
 * the hero learned its first skill. A hero is matched by its base form (Metamorphosis, Chemical Rage).
 */
export function heroUnit<U extends WUnitX>(units: U[], code: string, firstLevelUp: number | undefined): U | undefined {
  const same = units.filter((u) => baseUnit(u.itemId) === baseUnit(code));
  const at = (u: U) => u.trainedTime ?? u.spawnTime ?? Infinity;
  const before = same.filter((u) => at(u) <= (firstLevelUp ?? Infinity));
  return before.length ? before.reduce((a, b) => (at(b) > at(a) ? b : a)) : same[0];
}

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
    const levels = h.levelUps ?? [];
    const unit = heroUnit(units, h.code, levels[0]);
    const appearAt = unit?.trainedTime ?? unit?.spawnTime ?? levels[0] ?? null;
    const levelAt = (t: number) => Math.max(1, levels.filter((x) => x <= t).length);
    const buildMs = costOf(costs, h.code).buildMs || 55_000;
    const pathTimes = (unit?.path ?? []).map((p) => p.gameTime).sort((a, b) => a - b);
    const deaths: HeroTimeline["deaths"] = [];
    let lastRevive = appearAt ?? 0;
    for (const r of revives.filter((e) => heroOf(e) === h.code).sort((a, b) => a.gameTime - b.gameTime)) {
      const before = pathTimes.filter((x) => x < r.gameTime - 1000 && x >= lastRevive);
      const died = before.length ? before[before.length - 1] : r.gameTime;
      const revivedAt = Math.min(endMs, r.gameTime + reviveMs(buildMs, levelAt(r.gameTime)));
      deaths.push({ diedAt: died, revivedAt });
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
  for (const [, p] of enemies) lost += ((p.units ?? []) as WUnitX[]).filter((u) => diedAt(u) !== null && isUnit(u.itemId)).length;
  const camps = Object.values(o.world?.neutralGroups ?? {}) as { claimState: number; claimOwnerId: number | null; units?: unknown[] }[];
  const creeps = camps.filter((g) => g.claimState === 2 && g.claimOwnerId === teamId).reduce((s, g) => s + (g.units?.length ?? 0), 0);
  return Math.round((lost + creeps) * factor);
}
