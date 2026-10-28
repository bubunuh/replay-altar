// Hero experience from the replay. Every level gives one skill point and players spend it at
// once, so the times skills are learned are the level-up times. The XP per level is fixed game
// data (3.0: NeedHeroXP=200, then +100 per level: 200, 500, 900, 1400, ... 5400).
// Validated against W3Champions' official "experience gained" on 56 pro player-games:
// correlation 0.96, median ratio 1.01 (see docs/DATA.md).
import { HERO_ULTIMATES } from "./gamedata.ts";

/** Total XP needed to reach each level (index = level). */
export const HERO_XP_FOR_LEVEL = [0, 0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400];
const MAX_LEVEL = 10;

type AbilityEntry = { type: "ability" | "retraining"; time: number; value?: string };

/** Whether a hero of this level can learn this rank of the skill (game rules, see HERO_ULTIMATES). */
function rankAllowed(code: string, rank: number, heroLevel: number) {
  return HERO_ULTIMATES.has(code) ? rank === 1 && heroLevel >= 6 : rank <= 3 && heroLevel >= 2 * rank - 1;
}

/**
 * Level-up times of one hero: [time reached level 1 (acquired), level 2, ...]. Retraining re-picks
 * are not level-ups. The replay keeps every click on a skill, also the ones the game refused
 * (e.g. clicking Divine Shield 12 times at level 1), so a pick only counts if the hero could have
 * learned that rank at the level the pick would give it.
 *
 * This is the fallback for raw files without the skill-menu actions (see playerLevelUps). w3gjs
 * marks a retraining at the tome's purchase time but often inserts the mark too early, before real
 * level-ups (26% of marks in our corpora), so the mark is placed by its time here.
 */
export function levelUpTimes(abilityOrder: AbilityEntry[]): number[] {
  const ordered = abilityOrder.map((a, i) => ({ a, i })).sort((x, y) => x.a.time - y.a.time || x.i - y.i).map((x) => x.a);
  const times: number[] = [];
  let ranks = new Map<string, number>();
  let relearn = 0;
  for (const a of ordered) {
    if (a.type === "retraining") {
      relearn = times.length; // the hero re-learns this many skills without gaining levels
      ranks = new Map();
      continue;
    }
    if (a.value !== undefined) {
      const rank = (ranks.get(a.value) ?? 0) + 1;
      if (!rankAllowed(a.value, rank, relearn > 0 ? times.length : times.length + 1)) continue;
      ranks.set(a.value, rank);
    }
    if (relearn > 0) {
      relearn--;
      continue;
    }
    if (times.length < MAX_LEVEL) times.push(a.time);
  }
  return times;
}

/** When a player opened a hero's skill menu, and bought a Tome of Retraining (PlayerActions in parse.ts). */
export type SkillActions = { skillMenuMs: number[]; tomeMs: number[] };

/** A tome is used within this long of its purchase, or it doesn't count. */
const TOME_USE_MS = 300_000;
/** The re-spent points of one retraining, possibly over a few openings of the skill menu. */
const RESPEND_MS = 60_000;

/**
 * Level-up times of each of a player's heroes (see levelUpTimes), using when the player opened the
 * skill menu (each opening starts a session of picks) and bought Tomes of Retraining.
 *
 * A retraining refunds every point at once, and the player re-spends them in one go: the first
 * session after a tome's purchase in which one hero picks about as many skills as its level (its
 * level − 1 or more, at least 2; picks of that hero up to a minute later included) is its
 * retraining. Up to its level of those picks are re-picks, not level-ups, and further clicks in
 * that same session were refused (no points left; one counted as a level-up showed a level the
 * official stats didn't have).
 */
export function playerLevelUps(heroes: { abilityOrder: AbilityEntry[] }[], actions?: SkillActions): number[][] {
  if (!actions) return heroes.map((h) => levelUpTimes(h.abilityOrder));
  const menus = [...actions.skillMenuMs].sort((a, b) => a - b);
  const sessionOf = (t: number) => {
    let n = 0;
    while (n < menus.length && menus[n] <= t) n++;
    return n;
  };
  type Pick = { hero: number; time: number; value?: string; session: number; order: number };
  const picks: Pick[] = heroes
    .flatMap((h, hero) => h.abilityOrder.filter((a) => a.type === "ability").map((a) => ({ hero, time: a.time, value: a.value, session: sessionOf(a.time) })))
    .sort((a, b) => a.time - b.time)
    .map((p, order) => ({ ...p, order }));

  // Levels reached before a pick, from the picks before it, without retrainings (only used to size them).
  const out: number[][] = heroes.map(() => []);
  const ranks = heroes.map(() => new Map<string, number>());
  const levelOf = (hero: number) => out[hero].length;
  // Retraining sessions found so far: hero, session, re-pick budget left, until when re-picks count.
  const tomes = [...actions.tomeMs].sort((a, b) => a - b);
  let nextTome = 0;
  let respend: { hero: number; session: number; budget: number; until: number } | null = null;
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    // A tome bought before this pick (and not used yet) may start a retraining here.
    while (nextTome < tomes.length && p.time - tomes[nextTome] > TOME_USE_MS) nextTome++;
    if (nextTome < tomes.length && tomes[nextTome] <= p.time && (respend === null || p.time > respend.until)) {
      const inSession = picks.filter((q) => q.order >= p.order && q.session === p.session);
      if (inSession.length >= 2 && inSession.every((q) => q.hero === p.hero)) {
        respend = { hero: p.hero, session: p.session, budget: levelOf(p.hero), until: p.time + RESPEND_MS };
        ranks[p.hero] = new Map();
        // This retraining used the tome; the others bought by now are spent with it or never used.
        while (nextTome < tomes.length && tomes[nextTome] <= p.time) nextTome++;
      }
    }
    const level = levelOf(p.hero);
    const repick = respend !== null && respend.hero === p.hero && p.time <= respend.until && (respend.budget > 0 || p.session === respend.session);
    if (p.value !== undefined) {
      const rank = (ranks[p.hero].get(p.value) ?? 0) + 1;
      if (!rankAllowed(p.value, rank, repick ? level : level + 1)) continue;
      if (repick && respend!.budget === 0) continue; // no points left: the game refused it
      ranks[p.hero].set(p.value, rank);
    }
    if (repick) {
      respend!.budget = Math.max(0, respend!.budget - 1);
      continue;
    }
    if (level < MAX_LEVEL) out[p.hero].push(p.time);
  }
  return out;
}

/**
 * Estimated XP of one hero at time t. Between level-ups XP grows linearly (exact at each
 * level-up). After the last one, it grows towards half of the next level by the end of the game,
 * the estimate that matched official XP best.
 */
export function heroXpAt(levels: number[], t: number, endMs: number): number {
  if (!levels.length || t < levels[0]) return 0;
  let reached = 0; // index of the last level-up at or before t
  while (reached + 1 < levels.length && levels[reached + 1] <= t) reached++;
  const level = reached + 1;
  const base = HERO_XP_FOR_LEVEL[level];
  if (level >= MAX_LEVEL) return base;
  const gap = HERO_XP_FOR_LEVEL[level + 1] - base;
  if (reached + 1 < levels.length) {
    // Between two known level-ups.
    const from = levels[reached];
    const to = levels[reached + 1];
    return base + (gap * (t - from)) / Math.max(1, to - from);
  }
  // After the last level-up: towards half the next level by the end of the game.
  const from = levels[reached];
  return base + (gap / 2) * Math.min(1, (t - from) / Math.max(1, endMs - from));
}

export const heroesXpAt = (heroLevels: number[][], t: number, endMs: number) =>
  heroLevels.reduce((sum, levels) => sum + heroXpAt(levels, t, endMs), 0);
