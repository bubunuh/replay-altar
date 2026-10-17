// Hero experience from the replay. Every level gives one skill point and players spend it at
// once, so the times skills are learned are the level-up times. The XP per level is fixed game
// data (3.0: NeedHeroXP=200, then +100 per level: 200, 500, 900, 1400, ... 5400).
// Validated against W3Champions' official "experience gained" on 56 pro player-games:
// correlation 0.96, median ratio 1.01 (see docs/DATA.md).

/** Total XP needed to reach each level (index = level). */
export const HERO_XP_FOR_LEVEL = [0, 0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400];
const MAX_LEVEL = 10;

type AbilityEntry = { type: "ability" | "retraining"; time: number };

/** Level-up times of one hero: [time reached level 1 (acquired), level 2, ...]. Retraining re-picks are not level-ups. */
export function levelUpTimes(abilityOrder: AbilityEntry[]): number[] {
  const times: number[] = [];
  let relearn = 0;
  for (const a of abilityOrder) {
    if (a.type === "retraining") {
      relearn = times.length; // the hero re-learns this many skills without gaining levels
      continue;
    }
    if (relearn > 0) {
      relearn--;
      continue;
    }
    if (times.length < MAX_LEVEL) times.push(a.time);
  }
  return times;
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
