// Food in use over time, counted from the simulation's units the way the game counts it.
//
// WC3V keeps its own food counter (supplyUsed in its event stream), but that counter only adds:
// a unit counts once its training finishes and keeps counting after it dies (only a Wisp that
// becomes a building is taken off). Over a game it climbs to 100 and stays there, whatever the
// fights. Against Warcraft III's own food used on the 51 observer games (WC3V lab dev set and
// holdout, snapshots from 3:00), that counter read 10.4 food high on average (12.6 off, 20 off
// above 50 food) and put players above 80 food for 113 s per game when they spent 1 s there.
//
// The game counts a unit from the moment it starts training until it dies, and a hero from its
// training on, dead or alive (so it can be revived). Here: every unit WC3V followed that existed
// (deaths.ts; trained units the selection lists never showed are already gone), from the start
// of its training (its finish minus its build time) until its death, or until a Wisp became a
// building; heroes from the replay, from when they were ordered. On the same games: 3.1 off,
// 0.5 high, 8 s above 80 food per game.
import type { GameRecord } from "@replay-altar/core";
import { heroUnit } from "./army.ts";
import { costOf, type CostTables } from "./costs.ts";
import { diedAt, neverMade } from "./deaths.ts";

export type FoodUnit = {
  itemId: string;
  isBuilding?: boolean;
  isIllusion?: boolean;
  spawnTime?: number | null;
  trainedTime?: number | null;
  lostState?: { state: string; since: number; source?: string } | null;
  destroyedAt?: number | null;
  destroyedByBuilding?: boolean;
  morphHistory?: { gameTime: number; itemId: string; from: string }[];
};

/** Units WC3V first sees within this time, with no training, are the ones the game starts with. */
const START_UNITS_MS = 1000;

/** Food in use as a step function (sorted; each value holds until the next), at most 100. */
export function foodInUse(units: FoodUnit[], heroes: GameRecord["players"][number]["heroes"], costs: CostTables): { t: number; used: number }[] {
  const deltas: { t: number; d: number }[] = [];
  const count = (from: number, to: number | null, food: number) => {
    if (food <= 0 || (to !== null && to <= from)) return;
    deltas.push({ t: from, d: food });
    if (to !== null) deltas.push({ t: to, d: -food });
  };
  for (const u of units) {
    if (u.isBuilding || u.isIllusion || neverMade(u) || costOf(costs, u.itemId).isHero) continue;
    const morph = [...(u.morphHistory ?? [])].sort((a, b) => a.gameTime - b.gameTime)[0];
    const first = morph ? morph.from : u.itemId;
    // The starting units (no training) are there from 0:00; WC3V first sees them a few hundred ms in.
    const spawn = u.trainedTime == null && (u.spawnTime ?? 0) < START_UNITS_MS ? 0 : (u.spawnTime ?? 0);
    const start = u.trainedTime != null ? Math.max(spawn, u.trainedTime - costOf(costs, first).buildMs) : spawn;
    const end = u.destroyedByBuilding && u.destroyedAt != null ? u.destroyedAt : diedAt(u);
    if (morph && morph.gameTime > start && (end === null || morph.gameTime < end)) {
      count(start, morph.gameTime, costOf(costs, first).food);
      count(morph.gameTime, end, costOf(costs, u.itemId).food);
    } else {
      count(start, end, costOf(costs, u.itemId).food);
    }
  }
  for (const h of heroes) {
    const c = costOf(costs, h.code);
    const buildMs = c.buildMs || 55_000;
    const unit = heroUnit(units, h.code, h.levelUps?.[0]);
    const start = h.orderedMs ?? (unit?.trainedTime != null ? unit.trainedTime - buildMs : (unit?.spawnTime ?? (h.levelUps?.[0] != null ? h.levelUps[0] - buildMs : null)));
    if (start !== null) count(Math.max(0, start), null, c.food || 5);
  }
  deltas.sort((a, b) => a.t - b.t);
  const steps: { t: number; used: number }[] = [{ t: 0, used: 0 }];
  let used = 0;
  for (const { t, d } of deltas) {
    used += d;
    const v = Math.max(0, Math.min(100, used));
    if (steps.at(-1)!.t === t) steps.at(-1)!.used = v;
    else steps.push({ t, used: v });
  }
  return steps;
}
