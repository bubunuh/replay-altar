// The win-chance curve: at every moment of a game, how often pros in the same position went on to
// win. A logistic model on the differences between the two players (army, workers, heroes, ...),
// fitted on the curated pro games by scripts/win-chance.ts, which writes data/winchance.json; the
// method is in docs/win-chance/report.pdf. Only what is known at each moment goes in. The research
// script and the app share this file, so they compute the same thing. Browser-safe.
import type { GameRecord, PlayerRecord, SimSample } from "@replay-altar/core/ui";
import { researchLevels } from "@replay-altar/core/gamedata";
import { HERO_XP_FOR_LEVEL } from "@replay-altar/core/heroxp";
import { fightLosses } from "./series.ts";

/** The first moment the curve looks at, and the step between moments. */
export const START_MS = 60_000;
export const STEP_MS = 30_000;

/** Every difference the research tried, in this order (the model keeps some of them). */
export const FEATURES = [
  "army value", "army value ratio (log)", "workers", "hero experience", "bases", "tier", "resources spent", "resources lost", "food used",
  "highest hero level", "heroes alive", "hero deaths", "upgrades", "attack and armor upgrades", "items bought", "creep camps (levels)",
] as const;

/** Research time per research code, in seconds: [first level, added per level]. */
export type ResearchTimes = Record<string, [number, number]>;

/** data/winchance.json */
export type WinModel = {
  /** Indexes into FEATURES. */
  keep: number[];
  basis: "linear" | "curve";
  /** Weights: for each kept difference, one per time-basis function. */
  weights: number[];
  research: ResearchTimes;
  /** What it was fitted on and how it scored, for the app's note and the report. */
  about: { games: number; patch: string; fittedAt: string; commit: string; cvLogLoss: number; validationGames: number; validationLogLoss: number };
};

type SimOk = Extract<NonNullable<GameRecord["sim"]>, { status: "ok" }>;
/** One player's game, as the differences need it. */
export type Side = {
  p: PlayerRecord;
  race: string;
  series: SimSample[];
  bases: { at: number; lostAt: number | null }[];
  t2: number | null;
  t3: number | null;
  levels: number[][];
  deaths: { diedAt: number; revivedAt: number | null }[];
  upgrades: number[];
  weaponArmor: number[];
  items: number[];
  camps: { at: number; level: number }[];
};

// Attack and armor research of every race (the build orders' names).
const WEAPON_ARMOR = /^(Swords|Gunpowder|Plating|Armor|Leather Armor|Studded Leather Armor|Melee Weapons|Ranged Weapons|Unit Armor|Strength of the Moon|Moon Armor|Reinforced Hides|Strength of the Wild|Unholy Strength|Unholy Armor|Creature Attack|Creature Carapace)/;

// Research counts when it would finish (the order time plus its research time), not when it is
// ordered; repeated clicks on the same research are one. Cancelled research can't be told apart.
function researchDone(p: PlayerRecord, research: ResearchTimes, test: (name: string) => boolean = () => true): number[] {
  const names = new Map(p.build.filter((b) => b.kind === "upgrade").map((b) => [b.code, b.name]));
  return researchLevels(p.build)
    .filter((r) => test(names.get(r.code) ?? ""))
    .map((r) => {
      const [base, mod] = research[r.code] ?? [0, 0];
      return r.ms + (base + mod * (r.level - 1)) * 1000;
    })
    .sort((a, b) => a - b);
}

export function sideOf(r: GameRecord, p: PlayerRecord, research: ResearchTimes): Side | null {
  if (r.sim?.status !== "ok") return null;
  const sp = (r.sim as SimOk).players.find((x) => x.playerId === p.playerId);
  if (!sp || !sp.series.length) return null;
  return {
    p,
    race: p.race,
    series: sp.series,
    bases: sp.bases ?? [],
    t2: sp.metrics.tier2_done_ms ?? null,
    t3: sp.metrics.tier3_done_ms ?? null,
    levels: p.heroes.map((h) => h.levelUps ?? []),
    deaths: (sp.heroes ?? []).flatMap((h) => h.deaths),
    upgrades: researchDone(p, research),
    weaponArmor: researchDone(p, research, (n) => WEAPON_ARMOR.test(n)),
    items: p.build.filter((b) => b.kind === "item").map((b) => b.ms).sort((a, b) => a - b),
    camps: sp.camps ?? [],
  };
}

const sampleAt = (series: SimSample[], t: number) => {
  let best = series[0];
  for (const s of series) if (s.t <= t) best = s;
  return best;
};
const countTo = (times: number[], t: number) => {
  let n = 0;
  for (const x of times) if (x <= t) n++;
  return n;
};

/**
 * Hero experience known at time t: the XP of the levels reached so far. (heroesXpAt, used for the
 * charts, fills in between level-ups with the next one's time, which would let the model see a
 * level-up, and so a won fight, coming.)
 */
const xpSoFar = (s: Side, t: number) => s.levels.reduce((sum, l) => sum + HERO_XP_FOR_LEVEL[Math.min(10, countTo(l, t))], 0);

/** The differences A − B at time t (FEATURES order), scaled to similar sizes. */
export function diffs(a: Side, b: Side, t: number): number[] {
  const sa = sampleAt(a.series, t), sb = sampleAt(b.series, t);
  const bases = (s: Side) => s.bases.filter((x) => x.at <= t && (x.lostAt === null || x.lostAt > t)).length;
  const tier = (s: Side) => (s.t2 !== null && s.t2 <= t ? 1 : 0) + (s.t3 !== null && s.t3 <= t ? 1 : 0);
  const army = (s: SimSample) => s.armyValue ?? 0;
  const topLevel = (s: Side) => Math.max(0, ...s.levels.map((l) => countTo(l, t)));
  const dead = (s: Side) => s.deaths.filter((d) => d.diedAt <= t && (d.revivedAt === null || d.revivedAt > t)).length;
  const alive = (s: Side) => s.levels.filter((l) => l.length && l[0] <= t).length - dead(s);
  const camps = (s: Side) => s.camps.filter((c) => c.at <= t).reduce((n, c) => n + c.level, 0);
  return [
    (army(sa) - army(sb)) / 1000,
    Math.log((army(sa) + 200) / (army(sb) + 200)),
    (sa.workers - sb.workers) / 10,
    (xpSoFar(a, t) - xpSoFar(b, t)) / 1000,
    bases(a) - bases(b),
    tier(a) - tier(b),
    (sa.goldSpent + sa.lumberSpent - sb.goldSpent - sb.lumberSpent) / 1000,
    (sa.goldLost + sa.lumberLost - sb.goldLost - sb.lumberLost) / 1000,
    (sa.foodUsed - sb.foodUsed) / 10,
    topLevel(a) - topLevel(b),
    alive(a) - alive(b),
    a.deaths.filter((d) => d.diedAt <= t).length - b.deaths.filter((d) => d.diedAt <= t).length,
    countTo(a.upgrades, t) - countTo(b.upgrades, t),
    countTo(a.weaponArmor, t) - countTo(b.weaponArmor, t),
    (countTo(a.items, t) - countTo(b.items, t)) / 5,
    (camps(a) - camps(b)) / 20,
  ];
}

/** linear: weight = a + b·t. curve: a weight per knot (minutes), straight lines between. */
export const KNOTS_MIN = [1, 5, 10, 15, 22, 30];
export function basis(kind: WinModel["basis"], t: number): number[] {
  if (kind === "linear") return [1, t / 600_000];
  const m = t / 60_000;
  const out = KNOTS_MIN.map(() => 0);
  if (m <= KNOTS_MIN[0]) out[0] = 1;
  else if (m >= KNOTS_MIN.at(-1)!) out[out.length - 1] = 1;
  else {
    const i = KNOTS_MIN.findIndex((k) => k > m) - 1;
    const f = (m - KNOTS_MIN[i]) / (KNOTS_MIN[i + 1] - KNOTS_MIN[i]);
    out[i] = 1 - f;
    out[i + 1] = f;
  }
  return out;
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** The weight of the k-th kept difference at time t. */
export function weightAt(model: Pick<WinModel, "basis" | "weights">, k: number, t: number): number {
  const bs = basis(model.basis, t);
  return bs.reduce((s, b, j) => s + b * model.weights[k * bs.length + j], 0);
}

/** Chance that side A wins, from the differences A − B at time t. */
export function chance(model: Pick<WinModel, "keep" | "basis" | "weights">, d: number[], t: number): number {
  return sigmoid(model.keep.reduce((z, f, k) => z + weightAt(model, k, t) * d[f], 0));
}

export type WinPoint = { t: number; p: number };

/** A difference that moved the chance in a swing: which one, and for whom. */
export type Driver = { feature: number; favours: "me" | "opp" };
/** Something that happened just before or during a swing. */
export type SwingEvent =
  | { kind: "fight"; at: number; category: string; myLoss: number; oppLoss: number }
  | { kind: "heroDied"; at: number; who: "me" | "opp" }
  | { kind: "expansionLost"; at: number; who: "me" | "opp" }
  | { kind: "tier"; at: number; who: "me" | "opp"; tier: 2 | 3 };
export type Swing = { from: number; to: number; pFrom: number; pTo: number; drivers: Driver[]; events: SwingEvent[] };

/** Differences where more is worse for you (losing more resources): their weight is negative. */
const MORE_IS_WORSE = new Set([7, 11]);
/** Swings over this window; the biggest ones, at least this far apart and this big. */
const SWING_MS = 60_000;
const SWING_GAP_MS = 90_000;
const SWING_MIN = 0.08;

export type WinCurve = { points: WinPoint[]; swings: Swing[] };

/** Your chance over the game and the moments that swung it most; null when the game can't have one. */
export function winCurve(r: GameRecord, model: WinModel, me: PlayerRecord, opp: PlayerRecord): WinCurve | null {
  const a = sideOf(r, me, model.research), b = sideOf(r, opp, model.research);
  if (!a || !b) return null;
  const end = r.game.durationMs;
  const points: WinPoint[] = [];
  for (let t = START_MS; t < end; t += STEP_MS) points.push({ t, p: chance(model, diffs(a, b, t), t) });
  if (points.length < 3) return null;

  const back = SWING_MS / STEP_MS;
  const candidates = points
    .map((c, i) => ({ from: points[Math.max(0, i - back)].t, to: c.t, pFrom: points[Math.max(0, i - back)].p, pTo: c.p }))
    .filter((s) => Math.abs(s.pTo - s.pFrom) >= SWING_MIN)
    .sort((x, y) => Math.abs(y.pTo - y.pFrom) - Math.abs(x.pTo - x.pFrom));
  const picked: typeof candidates = [];
  for (const s of candidates) if (picked.length < 3 && picked.every((x) => Math.abs(x.to - s.to) >= SWING_GAP_MS)) picked.push(s);

  // Which differences moved the chance: each one's share of the change in the model's score. A
  // difference whose weight has the unexpected sign at that moment (the model uses it to correct
  // another one) is left out of the explanation: it would read backwards.
  const drivers = (t0: number, t1: number, up: boolean): Driver[] => {
    const d0 = diffs(a, b, t0), d1 = diffs(a, b, t1);
    return model.keep
      .map((f, k) => ({ f, w: weightAt(model, k, t1), c: weightAt(model, k, t1) * d1[f] - weightAt(model, k, t0) * d0[f] }))
      .filter((x) => (MORE_IS_WORSE.has(x.f) ? x.w < 0 : x.w > 0))
      .filter((x) => (up ? x.c > 0.05 : x.c < -0.05))
      .sort((x, y) => Math.abs(y.c) - Math.abs(x.c))
      .slice(0, 2)
      .map((x) => ({ feature: x.f, favours: x.c > 0 ? "me" : "opp" }));
  };
  const fights = fightLosses(r, me, opp);
  const events = (t0: number, t1: number): SwingEvent[] => {
    const out: SwingEvent[] = [];
    const within = (t: number | null) => t !== null && t >= t0 && t <= t1;
    // Losses as the report counts them (from the army series, not WC3V's battle summaries).
    for (const { f, me: myLoss, opp: oppLoss } of fights) {
      if (f.category === "creep-fight" || f.end < t0 || f.start > t1) continue;
      if (myLoss + oppLoss >= 150) out.push({ kind: "fight", at: f.start, category: f.category, myLoss, oppLoss });
    }
    for (const [s, who] of [[a, "me"], [b, "opp"]] as const) {
      for (const d of s.deaths) if (within(d.diedAt)) out.push({ kind: "heroDied", at: d.diedAt, who });
      for (const x of s.bases) if (within(x.lostAt)) out.push({ kind: "expansionLost", at: x.lostAt!, who });
      if (within(s.t2)) out.push({ kind: "tier", at: s.t2!, who, tier: 2 });
      if (within(s.t3)) out.push({ kind: "tier", at: s.t3!, who, tier: 3 });
    }
    return out.sort((x, y) => x.at - y.at);
  };
  const swings = picked
    .sort((x, y) => x.to - y.to)
    .map((s) => ({ ...s, drivers: drivers(s.from, s.to, s.pTo > s.pFrom), events: events(s.to - SWING_GAP_MS, s.to) }));
  return { points, swings };
}
