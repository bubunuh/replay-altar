// What mattered in a game, decided by rules rather than by the language model: tested on Gemma 4
// 26B, the model restated facts reliably but could not tell what decided a game (it missed a
// 6-minute window where the opponent had no army). Told the situation, it explains it well.
// Each finding carries its evidence as plain lines; the model writes the words around them.
// The rules live in rules/: core.ts (what decides games), basics.ts (beginner mistakes) and
// army.ts (composition and habits); this file runs them, ranks them and adds the links.
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import { RACES, type RaceCode, CORE_UPGRADES } from "@replay-altar/core/gamedata";
import { METRICS } from "@replay-altar/core/metrics";
import { metricValue, type FactsRef } from "./facts.ts";
import { openingOf } from "./openings.ts";
import { expansionsOf, fightLosses, levelSum, mmss } from "./series.ts";
import { adviceFor } from "./advice.ts";
import { armyMix, mixValue } from "./combat.ts";
import { num, proGap, simHeroes, type Ctx, type Finding } from "./rules/shared.ts";
import { economyFinding, expansionFinding, fightFinding, heroDeathsFinding, heroFinding, mechanicsFinding, noHeroesFinding, supplyFinding, upkeepFinding, windowFinding } from "./rules/core.ts";
import { buildDriftFinding, floatingFinding, goal3360Finding, justOver50Finding, mineDryFinding, noItemsFinding, oneHeroFinding, towersFinding, unansweredExpansionFinding, unusedSpikeFinding, upgradesFinding, upkeepBeforeUpgradesFinding, workersLostFinding } from "./rules/basics.ts";
import { armyMismatchFinding, noAntiAirFinding, noScoutFinding, noSustainFinding, outExpandedFinding, unusedLeadFinding } from "./rules/army.ts";

export type { Ctx, Finding } from "./rules/shared.ts";
export { heroStall } from "./rules/core.ts";

const MIN_SEVERITY = 0.5;
const MAX_FINDINGS = 3;
/** Shorter games (someone left early) say nothing about how you play. */
export const MIN_GAME_MS = 180_000;
/** Core metrics that are not skills worth praising (being attacked less is not your doing). */
const NOT_STRENGTHS = new Set(["fights_defending"]);
/** Per race: Undead mine with 5 Acolytes, so more early Acolytes mean an expansion, not better play. */
const NOT_STRENGTHS_FOR: Partial<Record<RaceCode, Set<string>>> = { U: new Set(["workers_by_6m"]) };

// ---- Links: facts from elsewhere in the game that explain a finding.

function becauseFor(f: Finding, c: Ctx): string[] {
  const m = c.me.metrics;
  const o = c.opp.metrics;
  const out: string[] = [];
  if (f.id === "heroes" && f.headline.startsWith("Your heroes")) {
    const camps = proGap(c, "creep_camps_6m");
    if (camps && camps.worseThan >= 0.6 && (m.creep_camps_6m ?? 0) < camps.median) out.push(`You cleared ${num(m.creep_camps_6m)} creep camp${m.creep_camps_6m === 1 ? "" : "s"} by 6:00 (pros: ${num(camps.median)}): too little creeping.`);
    const appear = Math.min(...simHeroes(c, c.me).map((h) => h.appearAt ?? Infinity));
    if (Number.isFinite(appear) && m.first_creep_ms !== null && m.first_creep_ms !== undefined && m.first_creep_ms - appear > 60_000) out.push(`Your first hero waited ${Math.round((m.first_creep_ms - appear) / 1000)} s before the first creep camp.`);
    const early = simHeroes(c, c.me).reduce((n, h) => n + h.deaths.filter((d) => d.diedAt <= 600_000).length, 0);
    if (early >= 1) out.push(`Your heroes died ${early === 1 ? "once" : `${early} times`} before 10:00: each death gave their heroes experience and cost you creeping time.`);
    const h2 = proGap(c, "hero2_ms");
    if (h2 && h2.worseThan >= 0.8) out.push(`Your second hero came at ${mmss(m.hero2_ms)} (pros: ${mmss(h2.median)}).`);
  }
  if (f.id === "fights") {
    const items = [m.items_bought ?? 0, o.items_bought ?? 0];
    if (items[1] >= 5 && items[1] >= 3 * Math.max(1, items[0])) out.push(`You bought ${items[0]} item${items[0] === 1 ? "" : "s"}, they bought ${items[1]}: potions and scrolls decide even fights.`);
    const worst = fightLosses(c.r, c.me, c.opp).filter((x) => x.f.playerIds.includes(c.opp.playerId)).sort((a, b) => b.me - b.opp - (a.me - a.opp))[0];
    if (worst) {
      const [mine, theirs] = [levelSum(c.me, worst.f.start), levelSum(c.opp, worst.f.start)];
      if (theirs >= mine + 2) out.push(`At your costliest fight (${mmss(worst.f.start)}) your heroes had ${mine} levels in all, theirs ${theirs}.`);
      // Upgrade levels ordered at least a minute before the fight (time to finish part of them).
      const ups = (p: PlayerRecord) => {
        const codes = new Set((CORE_UPGRADES[p.race as RaceCode] ?? []).map((u) => u.code));
        return p.build.filter((b) => b.kind === "upgrade" && codes.has(b.code) && b.ms <= worst.f.start - 60_000).length;
      };
      if (ups(c.opp) >= ups(c.me) + 2) out.push(`They had about ${ups(c.opp)} attack/armor upgrade levels by then, you ${ups(c.me)}.`);
    }
    if (worst) {
      const idle = armyMix(c.me, worst.f.start - 360_000, worst.f.start, true).filter((e) => !e.unit.attacks.length);
      const v = mixValue(idle);
      if (v >= 400) out.push(`≈${v} of what you ordered in the 6 minutes before it went into ${idle.map((e) => `${e.name} ×${e.count}`).join(", ")}, which only attack buildings.`);
    }
    // WC3V also calls fights at bases without towers (Night Elf ancients) tower dives.
    const theyHadTowers = (t: number) => c.opp.build.some((b) => b.kind === "building" && b.ms < t && RACES[c.opp.race as RaceCode]?.towers.includes(b.code));
    const dives = fightLosses(c.r, c.me, c.opp).filter((x) => x.f.category === "tower-dive" && x.f.initiatorId === c.me.playerId && theyHadTowers(x.f.start) && x.me > x.opp && x.me >= 300);
    if (dives.length) out.push(`${dives.length === 1 ? "One" : dives.length} of your losing fights ${dives.length === 1 ? "was" : "were"} under their towers (${dives.map((x) => mmss(x.f.start)).join(", ")}).`);
  }
  if (f.id === "window") {
    const R = RACES[c.opp.race as RaceCode];
    const t2 = R ? c.opp.build.find((b) => b.code === R.tier2)?.ms : undefined;
    const towers = R ? c.opp.build.filter((b) => R.towers.includes(b.code) && b.ms <= 600_000).length : 0;
    if (t2 !== undefined && t2 <= 600_000) out.push(`They put the resources into tech instead (tier 2 at ${mmss(t2)}${towers ? `, ${towers} tower order${towers === 1 ? "" : "s"} by 10:00` : ""}): that is when an expansion is safest.`);
  }
  if (f.id === "hero_deaths" && (m.tp_bought ?? 0) === 0) out.push("You had no Town Portal to save them.");
  return out;
}

/** Every rule that fires, most costly first. */
export function allFindings(r: GameRecord, ref: FactsRef | null, subjectId?: number): Finding[] {
  const me = subjectId === undefined ? r.players.find((p) => p.isMe) : r.players.find((p) => p.playerId === subjectId);
  const opp = r.players.find((p) => p.playerId !== me?.playerId && p.teamId !== me?.teamId);
  if (!me || !opp || r.game.durationMs < MIN_GAME_MS) return [];
  const c: Ctx = { r, me, opp, ref };
  const window = windowFinding(c, true);
  const heroes = heroFinding(c);
  const found = [
    window,
    windowFinding(c, false),
    economyFinding(c),
    heroes,
    fightFinding(c),
    supplyFinding(c),
    heroDeathsFinding(c),
    noHeroesFinding(c),
    upkeepFinding(c),
    window ? null : expansionFinding(c), // the window finding already says whether you expanded
    // firstCreepFinding: dropped from the list (holdout lift 0.5 once the heroes finding names a
    // late first creep as a cause); kept for that cause.
    upgradesFinding(c),
    oneHeroFinding(c),
    noItemsFinding(c),
    floatingFinding(c),
    unansweredExpansionFinding(c),
    justOver50Finding(c),
    towersFinding(c),
    workersLostFinding(c),
    goal3360Finding(c),
    unusedSpikeFinding(c),
    upkeepBeforeUpgradesFinding(c),
    mineDryFinding(c),
    buildDriftFinding(c),
    window ? null : unusedLeadFinding(c),
    outExpandedFinding(c),
    noAntiAirFinding(c),
    armyMismatchFinding(c),
    noSustainFinding(c),
    noScoutFinding(c),
  ]
    .filter((f): f is Finding => !!f && f.severity >= MIN_SEVERITY)
    .sort((a, b) => b.severity - a.severity);
  // Mechanics are a real but constant, slow-to-fix gap: shown only when the game itself had
  // little else to point at.
  const mech = found.length < 2 ? mechanicsFinding(c) : null;
  return [...found, ...(mech ? [mech] : [])].map((f) => ({ ...f, advice: f.advice ?? adviceFor(f.id, c) ?? undefined, because: becauseFor(f, c) }));
}

/** The most important problems in a game, most costly first (at most 3). */
export const findings = (r: GameRecord, ref: FactsRef | null, subjectId?: number) => allFindings(r, ref, subjectId).slice(0, MAX_FINDINGS);

/** Core metrics at pro level, best first: what went well (at most 2). */
/** Strengths that would contradict a finding shown for the same game (found in scripts/scan-reports.ts). */
const COVERED_BY: Record<string, string[]> = {
  heroes: ["hero_xp_6m", "hero_xp_10m", "hero_xp_share", "hero_level3_ms", "goal_3360_ms", "creep_camps_6m", "hero2_ms", "hero3_ms"],
  goal_3360: ["goal_3360_ms", "hero_level3_ms"],
  fights: ["trade_efficiency", "units_killed"],
  economy: ["workers_by_6m", "workers_alive_6m", "workers_alive_10m"],
  workers_lost: ["workers_by_6m", "workers_alive_6m", "workers_alive_10m"],
  hero_deaths: ["hero_deaths"],
  expansion: ["expansions"],
  out_expanded: ["expansions"],
  mine_dry: ["expansions", "gold_collected"],
};

export function strengths(r: GameRecord, ref: FactsRef | null, found: Finding[] = []): string[] {
  const covered = new Set(found.flatMap((f) => COVERED_BY[f.id] ?? []));
  const me = r.players.find((p) => p.isMe);
  const opp = r.players.find((p) => p.playerId === r.classification.opponentId);
  if (!me || !opp || !ref || r.game.durationMs < MIN_GAME_MS) return [];
  const c: Ctx = { r, me, opp, ref };
  return METRICS.filter((m) => m.section === "core" && m.better && !NOT_STRENGTHS.has(m.key) && !covered.has(m.key) && !NOT_STRENGTHS_FOR[me.race as RaceCode]?.has(m.key))
    .map((m) => ({ m, g: proGap(c, m.key) }))
    .filter((x) => x.g && x.g.worseThan <= 0.4)
    // Losing the trade isn't a strength, however it compares with pros.
    .filter((x) => x.m.key !== "trade_efficiency" || (me.metrics.trade_efficiency ?? 0) > 0.5)
    .sort((a, b) => a.g!.worseThan - b.g!.worseThan)
    .slice(0, 2)
    .map(({ m, g }) => `${m.raceLabels?.[me.race as RaceCode] ?? m.label}: you ${metricValue(m, me.metrics[m.key], r.metricSources?.[m.key] === "official")}, opp ${metricValue(m, opp.metrics[m.key], r.metricSources?.[m.key] === "official")}, better than ${Math.round((1 - g!.worseThan) * 100)}% of pro games.`);
}

/**
 * The opponent's plan in numbers, so the model describes their strategy from facts (left to
 * itself it guessed: "focused on hero leveling" for heroes that stayed level 1 for 15 minutes).
 */
export function opponentPlan(r: GameRecord, ref: FactsRef | null): string[] {
  const opp = r.players.find((p) => p.playerId === r.classification.opponentId);
  if (!opp) return [];
  const race = RACES[opp.race as RaceCode];
  const b = opp.build;
  const first = (codes: string[]) => b.find((x) => codes.includes(x.code))?.ms ?? null;
  const lines: string[] = [];
  const opening = openingOf(opp);
  if (opening.length) lines.push(`Opening: ${opening.join("; ")}.`);
  if (race) {
    const [t2, t3] = [first([race.tier2]), first([race.tier3])];
    lines.push(`Tech: tier 2 ordered ${mmss(t2)}, tier 3 ${mmss(t3)}${ref ? ` (your race's pros: ${mmss(ref.mp.metrics.tier2_ms?.p50)} and ${mmss(ref.mp.metrics.tier3_ms?.p50)})` : ""}.`);
    const towers = b.filter((x) => race.towers.includes(x.code));
    const early = towers.filter((x) => x.ms <= 300_000).length;
    lines.push(`Towers: ${towers.length} build/upgrade orders, ${early} of them by 5:00.`);
    const halls = expansionsOf(r, opp);
    lines.push(`Expansions: ${halls.length ? halls.map((t) => mmss(t)).join(", ") : "none"}.`);
  }
  const army = b.filter((x) => x.kind === "unit" && x.code !== race?.worker);
  const byName = new Map<string, number>();
  for (const u of army) byName.set(u.name, (byName.get(u.name) ?? 0) + 1);
  lines.push(
    army.length
      ? `Army: first unit ordered ${mmss(army[0].ms)} (${army[0].name}); in all ${[...byName.entries()].sort((x, y) => y[1] - x[1]).map(([n, k]) => `${n} ×${k}`).join(", ")}.`
      : "Army: no army units ordered.",
  );
  const end = r.game.durationMs;
  lines.push(`Heroes: ${opp.heroes.map((h) => `${h.name} (level 2 at ${mmss(h.levelUps[1] ?? null)}, level ${Math.max(1, h.levelUps.filter((x) => x <= end).length)} at the end)`).join("; ") || "none"}.`);
  const items = b.filter((x) => x.kind === "item");
  lines.push(`Items bought: ${items.length}${items.length ? ` (first at ${mmss(items[0].ms)})` : ""}.`);
  return lines;
}
