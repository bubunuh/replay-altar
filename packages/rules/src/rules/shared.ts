// What the rules share: the finding and its context, and how a game compares with the pros.
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import type { RaceCode } from "@replay-altar/core/gamedata";
import { METRICS, per10Minutes } from "@replay-altar/core/metrics";
import { decimal, tr } from "@replay-altar/core/i18n";
import { percentileOf } from "@replay-altar/reference/quantiles";
import type { FactsRef } from "../facts.ts";
import { expansionsOf } from "../series.ts";

export type Finding = {
  id:
    | "window" | "exposed" | "economy" | "heroes" | "fights" | "supply" | "mechanics" | "hero_deaths" | "no_heroes" | "upkeep" | "expansion"
    // basics: beginner mistakes, rare at higher levels (thresholds well outside what pros do)
    | "first_creep" | "upgrades" | "one_hero" | "no_items" | "floating" | "unanswered_expansion" | "just_over_50" | "towers" | "workers_lost" | "goal_3360"
    | "unused_spike" | "upkeep_before_upgrades" | "mine_dry" | "build_drift"
    // army and habits: composition against theirs, items, production, scouting
    | "no_anti_air" | "army_mismatch" | "no_sustain" | "no_scout" | "unused_lead" | "out_expanded";
  /** 0–1: how much it likely cost (problems) or how well it went (strengths). */
  severity: number;
  headline: string;
  /** Variant of the finding, for links that depend on it (heroes: "slow" when your own pace was the problem). */
  variant?: string;
  evidence: string[];
  /** What to do differently next time (advice.ts, or the rule's own). */
  advice?: string;
  /** Facts from elsewhere in the game that explain it ("you fought with 2 items against their 21"). */
  because?: string[];
};

export type Ctx = { r: GameRecord; me: PlayerRecord; opp: PlayerRecord; ref: FactsRef | null };

/**
 * Share of pro games that did better than this value (0 = better than every pro game, 1 = worse
 * than all), and the pro median, in the metric's compared unit. Null without enough pro data.
 */
export function proGap(c: Ctx, key: string): { worseThan: number; median: number } | null {
  const def = METRICS.find((m) => m.key === key);
  const raw = c.me.metrics[key];
  const entry = c.ref?.mp.metrics[key];
  if (!def || !def.better || raw === null || raw === undefined || !entry) return null;
  const stat = def.scalesWithLength && entry.per10 ? entry.per10 : entry;
  if (stat.values.length < 5) return null;
  const x = def.scalesWithLength && entry.per10 ? per10Minutes(raw, c.r.game.durationMs) : raw;
  const below = percentileOf(stat.values, x);
  return { worseThan: def.better === "higher" ? 1 - below : below, median: stat.p50 };
}

export const num = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Number.isInteger(v) ? String(v) : decimal(v));
export const vsPros = (c: Ctx, key: string, fmt: (v: number) => string = num) => {
  const g = proGap(c, key);
  return g ? tr(` (pros median ${fmt(g.median)}; worse than ${Math.round(g.worseThan * 100)}% of pro games)`, ` (mediana dos pros ${fmt(g.median)}; pior que ${Math.round(g.worseThan * 100)}% das partidas de pros)`) : "";
};

export const heroLevelSum = (p: PlayerRecord, t: number) => p.heroes.reduce((n, h) => n + h.levelUps.filter((x) => x <= t).length, 0);
export const heroLevels = (p: PlayerRecord, t: number) => p.heroes.map((h) => tr(`${h.name} level ${Math.max(1, h.levelUps.filter((x) => x <= t).length)}`, `${h.name} nível ${Math.max(1, h.levelUps.filter((x) => x <= t).length)}`)).join(", ") || tr("no heroes", "nenhum herói");

/**
 * Workers a race needs: 5 on gold per base plus a lumber crew (Grubby, beginner guide #3 and the
 * Human guides: Human 8-9 on wood, 12-13 on two bases; Orc 7; Night Elf 9 wisps; Undead lumber is
 * ghouls, which are not workers). More than that adds nothing, so one base saturates at ~14.
 */
const LUMBER_CREW: Record<RaceCode, [number, number]> = { H: [9, 12], O: [7, 9], N: [9, 12], U: [0, 0] };
export const TOWN_HALL_BUILD_MS = 120_000;
export function workerTarget(r: GameRecord, p: PlayerRecord, t: number) {
  const bases = 1 + expansionTimes(r, p).filter((x) => x + TOWN_HALL_BUILD_MS <= t).length;
  const crew = LUMBER_CREW[p.race as RaceCode] ?? [9, 12];
  return { bases, target: 5 * bases + crew[bases > 1 ? 1 : 0] };
}

export const simHeroes = (c: Ctx, p: PlayerRecord) => (c.r.sim?.status === "ok" ? (c.r.sim.players.find((x) => x.playerId === p.playerId)?.heroes ?? []) : []);
export const expansionTimes = (r: GameRecord, p: PlayerRecord) => expansionsOf(r, p);

/** Pros' quantile of a mined feature (scripts/mine-principles.ts) for the player's race, or null. */
export function proQ(c: Ctx, key: string, q: "p10" | "p25" | "p50" | "p75" | "p90"): number | null {
  const p = c.ref?.principles;
  const f = p && p.race === c.me.race ? p.features[key]?.all : null;
  return f ? f[q] : null;
}

/** Severity of the basics and other plain mistakes: shown, but below the costlier findings. */
export const BASIC = 0.5;

/** Sim fights you took part in that start in [from, to]. */
export const fightsNear = (c: Ctx, from: number, to: number) =>
  (c.r.sim?.status === "ok" ? (c.r.sim.fights ?? []) : []).filter((f) => f.start >= from && f.start <= to && f.playerIds.includes(c.me.playerId) && f.category !== "creep-fight");
