// The build-order library and the matcher. Library entries come from guides (Grubby's build
// orders, Warcraft 3 Gym, Liquipedia), written as food-keyed steps ("27 food: upgrade to Keep");
// mined entries add how pros actually play each build (scripts/mine-principles.ts).
// The matcher aligns a player's opening with every entry of their race and reports the best
// match and where the player drifted from it.
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import { CORE_UPGRADES, dropRepeatedBuildOrders, RACES, type RaceCode } from "@replay-altar/core/gamedata";
import { codeOf, nameOf } from "@replay-altar/core/names";
import { tr } from "@replay-altar/core/i18n";
import grubby from "../../../data/builds/grubby.json" with { type: "json" };
import gym from "../../../data/builds/gym.json" with { type: "json" };
import liquipedia from "../../../data/builds/liquipedia.json" with { type: "json" };
import { at } from "./series.ts";

export type StepAction = "build" | "train" | "hero" | "tech" | "expand" | "research" | "item";
export type RawStep = [number, StepAction | string, string];
export type BuildSource = { author?: string; where?: string; url?: string };
export type RawBuild = { id: string; name: string; race: string; vs: string[]; date?: string; level?: string; steps: RawStep[]; notes?: string[]; url?: string; author?: string };
type RawLibrary = { source: BuildSource; builds: RawBuild[] };

export type BuildStep = { food: number; action: StepAction; name: string; code: string | null };
export type BuildEntry = Omit<RawBuild, "steps"> & { race: RaceCode; source: BuildSource; steps: BuildStep[]; unresolved: string[] };

/** Names guides use that the game data spells differently. */
const ALIASES: Record<string, string> = {
  "troll headhunter": "ohun",
  headhunter: "ohun",
  "black gunpowder": "Rhra",
  "moon glaive": "Remg",
  "wyvern": "owyv",
};
const TAVERN = "tavern";

/** Resolve a guide's name to a replay code, using the race for generic upgrade names. */
export function resolveName(name: string, race: RaceCode, action: string): string | null {
  const n = name.toLowerCase();
  if (n === TAVERN) return TAVERN;
  if (ALIASES[n]) return ALIASES[n];
  if (action === "research") {
    const ups = CORE_UPGRADES[race] ?? [];
    const kind = /armor|armour|plating|hides|carapace/.test(n) ? "armor" : /attack|weapon|strength|gunpowder|swords/.test(n) ? "attack" : null;
    const named = ups.find((u) => u.name.toLowerCase() === n);
    if (named) return named.code;
    if (kind) {
      const ranged = /ranged|creature/.test(n);
      return (ups.find((u) => u.kind === kind && (kind === "armor" || u.detail.includes(ranged ? "ranged" : "melee"))) ?? ups.find((u) => u.kind === kind))?.code ?? null;
    }
  }
  return codeOf(name);
}

function load(lib: RawLibrary): BuildEntry[] {
  return lib.builds.map((b) => {
    const race = b.race as RaceCode;
    const unresolved: string[] = [];
    const steps = b.steps.map(([food, action, name]) => {
      const code = resolveName(name, race, action);
      if (!code) unresolved.push(name);
      return { food, action: action as StepAction, name, code };
    });
    return { ...b, race, source: { ...lib.source, ...(b.url ? { url: b.url } : {}), ...(b.author ? { author: b.author } : {}) }, steps, unresolved };
  });
}

export const LIBRARY: BuildEntry[] = [...load(grubby as RawLibrary), ...load(gym as RawLibrary), ...load(liquipedia as RawLibrary)];

/** A step the matcher looks at: a player's order (or a guide step) with the food count at that moment. */
export type KeyEvent = { ms: number; food: number; action: StepAction; code: string; name: string };

const isSupply = (race: RaceCode, code: string) => RACES[race]?.supply === code;
const isTavernHero = (code: string) => /^N/.test(code);
/** Undead expand with a Haunted Gold Mine (or a second Necropolis), Night Elves with a Tree of Life away from home. */
const EXPANSION_CODES: Record<RaceCode, string[]> = { H: ["htow"], O: ["ogre"], U: ["ugol", "unpl"], N: ["etol"] };

/**
 * A player's key events for matching: production, tech and other buildings (not supply), tier
 * upgrades, expansions, heroes, the first unit of each type, research (first level), items. The
 * food count is the food in use at that moment (as guides count it: "27/30 - upgrade to Keep").
 */
export function keyEvents(r: GameRecord, p: PlayerRecord, untilMs = 12 * 60_000): KeyEvent[] {
  const race = p.race as RaceCode;
  const R = RACES[race];
  if (!R) return [];
  const series = r.sim?.status === "ok" ? (r.sim.players.find((x) => x.playerId === p.playerId)?.series ?? []) : [];
  const foodAt = (ms: number) => at(series, ms)?.foodUsed ?? 0;
  const out: KeyEvent[] = [];
  const seenUnits = new Set<string>();
  const seenResearch = new Set<string>();
  const builds = dropRepeatedBuildOrders(p.build.map((b) => ({ ...b, id: b.code })));
  for (const b of builds) {
    if (b.ms > untilMs) break;
    if (b.kind === "building") {
      if (isSupply(race, b.code)) continue;
      const tier = b.code === R.tier2 || b.code === R.tier3;
      const expansion = EXPANSION_CODES[race].includes(b.code); // the first hall is pre-placed: any order is a new base
      out.push({ ms: b.ms, food: foodAt(b.ms), action: tier ? "tech" : expansion ? "expand" : "build", code: b.code, name: b.name });
    } else if (b.kind === "unit") {
      if (b.code === R.worker || seenUnits.has(b.code)) continue;
      seenUnits.add(b.code);
      out.push({ ms: b.ms, food: foodAt(b.ms), action: "train", code: b.code, name: b.name });
    } else if (b.kind === "upgrade") {
      if (seenResearch.has(b.code)) continue;
      seenResearch.add(b.code);
      out.push({ ms: b.ms, food: foodAt(b.ms), action: "research", code: b.code, name: b.name });
    } else if (b.kind === "item") {
      out.push({ ms: b.ms, food: foodAt(b.ms), action: "item", code: b.code, name: b.name });
    }
  }
  // Heroes: when they were trained (the simulation's appearance time, else the first skill).
  const sim = r.sim?.status === "ok" ? r.sim.players.find((x) => x.playerId === p.playerId)?.heroes : undefined;
  for (const h of p.heroes) {
    const appear = sim?.find((x) => x.code === h.code)?.appearAt ?? h.levelUps[0];
    if (appear === undefined || appear === null || appear > untilMs) continue;
    out.push({ ms: appear, food: foodAt(appear), action: "hero", code: h.code, name: h.name });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

export type StepResult = { step: BuildStep; event: KeyEvent | null };
export type Match = { build: BuildEntry; score: number; steps: StepResult[] };

const FOOD_SCALE = 10;
/** Every build is judged over at least this much of the game, so a short opening-only guide can't win by describing less. */
const MIN_HORIZON_FOOD = 40;
/** Events that say something about a build; extra ones (not in the guide) cost a little. */
const SIGNIFICANT: StepAction[] = ["build", "tech", "expand", "hero"];

const same = (s: BuildStep, e: KeyEvent) => {
  if (!s.code) return false;
  if (s.code === TAVERN) return e.action === "hero" && isTavernHero(e.code);
  if (s.action === "expand") return e.action === "expand";
  return s.code === e.code;
};

/**
 * Pair a build's steps with a player's key events by food count, not strict order (guides list
 * several steps at the same food, and a Footman can come out before the hero): each step takes the
 * unused event of the same kind closest in food. A paired step is worth 1 minus its food
 * difference / 10 (floored at 0). Score = F1 of recall (how much of the guide the player followed)
 * and precision (how much of the player's buildings, tech and heroes in that food range the guide
 * explains): 1 = the player did exactly the guide, at the guide's food counts, and nothing else.
 */
export function alignBuild(build: BuildEntry, events: KeyEvent[]): Match {
  const steps = build.steps.filter((s) => s.code && !(s.action === "build" && isSupply(build.race, s.code)));
  const maxFood = Math.max(MIN_HORIZON_FOOD, Math.max(...steps.map((s) => s.food)) + 8);
  const ev = events.filter((e) => e.food <= maxFood);
  // All (step, event) pairs of the same kind, closest food first; take them greedily.
  const pairs: { i: number; j: number; d: number }[] = [];
  steps.forEach((s, i) => ev.forEach((e, j) => same(s, e) && pairs.push({ i, j, d: Math.abs(s.food - e.food) })));
  pairs.sort((a, b) => a.d - b.d || a.i - b.i);
  const stepEvent = new Map<number, number>();
  const usedEvents = new Set<number>();
  for (const { i, j } of pairs) {
    if (stepEvent.has(i) || usedEvents.has(j)) continue;
    stepEvent.set(i, j);
    usedEvents.add(j);
  }
  let gain = 0;
  const result: StepResult[] = steps.map((step, i) => {
    const j = stepEvent.get(i);
    if (j === undefined) return { step, event: null };
    gain += Math.max(0, 1 - Math.abs(step.food - ev[j].food) / FOOD_SCALE);
    return { step, event: ev[j] };
  });
  const extras = ev.filter((e, j) => !usedEvents.has(j) && SIGNIFICANT.includes(e.action)).length;
  const recall = steps.length ? gain / steps.length : 0;
  const precision = stepEvent.size + extras ? gain / (stepEvent.size + extras) : 0;
  const score = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
  return { build, score, steps: result };
}

/** Best-matching library builds for a player (most likely first). */
export function matchBuilds(r: GameRecord, p: PlayerRecord, library: BuildEntry[] = LIBRARY): Match[] {
  const events = keyEvents(r, p);
  return library
    .filter((b) => b.race === p.race)
    .map((b) => alignBuild(b, events))
    .sort((a, b) => b.score - a.score);
}

/** Where the player drifted from a matched build: steps 4+ food off, and steps they skipped. */
export function deviations(m: Match, minFood = 4): string[] {
  const out: string[] = [];
  for (const { step, event } of m.steps) {
    const label = step.code === TAVERN ? tr("tavern hero", "herói da taverna", "héroe de taberna", "héros de taverne") : step.action === "tech" ? nameOf(step.code ?? "") : step.name;
    if (!event) out.push(tr(`no ${label} (build: ${step.food} food)`, `sem ${label} (build: ${step.food} de food)`, `sin ${label} (build: ${step.food} de food)`, `pas de ${label} (build : ${step.food} de food)`));
    else if (Math.abs(event.food - step.food) >= minFood) out.push(tr(`${label} at ${event.food} food (build: ${step.food})`, `${label} com ${event.food} de food (build: ${step.food})`, `${label} con ${event.food} de food (build: ${step.food})`, `${label} à ${event.food} de food (build : ${step.food})`));
  }
  return out;
}

/**
 * Where a player differs from how pros play the same build: key steps (tier, expansion, heroes,
 * production) that most pros on the build do, done 5+ food earlier or later than their median,
 * or not at all. Guide food counts include units in training; ours (and the pros') don't, so the
 * pros' numbers are the fair reference.
 */
export function deviationsFromPros(m: Match, pro: { steps: { step: string; proFood: number | null; share: number }[] }, minFood = 5) {
  const out: { label: string; yours: number | null; pros: number; action: StepAction }[] = [];
  m.steps.forEach(({ step, event }, i) => {
    const ps = pro.steps[i];
    if (!ps || ps.proFood === null || ps.share < 0.6) return;
    if (!["tech", "expand", "hero", "build"].includes(step.action)) return;
    const label = step.code === TAVERN ? tr("tavern hero", "herói da taverna", "héroe de taberna", "héros de taverne") : step.name;
    if (!event) out.push({ label, yours: null, pros: Math.round(ps.proFood), action: step.action });
    else if (Math.abs(event.food - ps.proFood) >= minFood) out.push({ label, yours: event.food, pros: Math.round(ps.proFood), action: step.action });
  });
  return out;
}
