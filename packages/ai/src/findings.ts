// What mattered in a game, decided by rules rather than by the language model: tested on Gemma 4
// 26B, the model restated facts reliably but could not tell what decided a game (it missed a
// 6-minute window where the opponent had no army). Told the situation, it explains it well.
// Each finding carries its evidence as plain lines; the model writes the words around them.
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import { RACES, type RaceCode } from "@replay-altar/core/gamedata";
import { METRICS, per10Minutes } from "@replay-altar/core/metrics";
import { percentileOf } from "@replay-altar/reference/quantiles";
import { metricValue, type FactsRef } from "./facts.ts";
import { openingOf } from "./openings.ts";
import { deviationsFromPros, matchBuilds } from "./builds.ts";
import { proBuildOf } from "./principles.ts";
import { at, fightLosses, mmss, sampleBoth, seriesOf, STEP_MS } from "./series.ts";

export type Finding = {
  id:
    | "window" | "exposed" | "economy" | "heroes" | "fights" | "supply" | "mechanics" | "hero_deaths" | "no_heroes" | "upkeep" | "expansion"
    // basics: beginner mistakes, rare at higher levels (thresholds well outside what pros do)
    | "first_creep" | "upgrades" | "one_hero" | "no_items" | "floating" | "unanswered_expansion" | "just_over_50" | "towers" | "workers_lost" | "goal_3360"
    | "unused_spike" | "upkeep_before_upgrades" | "mine_dry" | "build_drift";
  /** 0–1: how much it likely cost (problems) or how well it went (strengths). */
  severity: number;
  /** Fallback title when the model is not available. */
  headline: string;
  evidence: string[];
};

const MIN_SEVERITY = 0.5;
const MAX_FINDINGS = 3;
/** Shorter games (someone left early) say nothing about how you play. */
export const MIN_GAME_MS = 180_000;
/** Core metrics that are not skills worth praising (being attacked less is not your doing). */
const NOT_STRENGTHS = new Set(["fights_defending"]);

type Ctx = { r: GameRecord; me: PlayerRecord; opp: PlayerRecord; ref: FactsRef | null };

/**
 * Share of pro games that did better than this value (0 = better than every pro game, 1 = worse
 * than all), and the pro median, in the metric's compared unit. Null without enough pro data.
 */
function proGap(c: Ctx, key: string): { worseThan: number; median: number } | null {
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

const num = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1));
const vsPros = (c: Ctx, key: string, fmt: (v: number) => string = num) => {
  const g = proGap(c, key);
  return g ? ` (pros median ${fmt(g.median)}; worse than ${Math.round(g.worseThan * 100)}% of pro games)` : "";
};

const heroLevelSum = (p: PlayerRecord, t: number) => p.heroes.reduce((n, h) => n + h.levelUps.filter((x) => x <= t).length, 0);
const heroLevels = (p: PlayerRecord, t: number) => p.heroes.map((h) => `${h.name} level ${Math.max(1, h.levelUps.filter((x) => x <= t).length)}`).join(", ") || "no heroes";

/** Opponent had no army units for at least two samples (4 minutes) while you had one. */
function windowFinding(c: Ctx, mine: boolean): Finding | null {
  const army = sampleBoth(c.r, c.me, c.opp, (s) => s.armyValue ?? 0).filter((x) => x.t > STEP_MS);
  const open = (x: { me: number; opp: number }) => (mine ? x.opp === 0 && x.me > 0 : x.me === 0 && x.opp > 0);
  let best: { from: number; to: number } | null = null;
  let cur: { from: number; to: number } | null = null;
  for (const x of army) {
    if (!open(x)) cur = null;
    else if (cur) cur.to = x.t;
    else cur = { from: x.t, to: x.t };
    if (cur && (!best || cur.to - cur.from > best.to - best.from)) best = { from: cur.from, to: cur.to };
  }
  if (!best || best.to - best.from < STEP_MS) return null;
  const { from: since, to } = best;
  const losses = fightLosses(c.r, c.me, c.opp).filter((x) => x.f.start >= since && x.f.start <= to);
  const theyLost = losses.reduce((n, x) => n + x.opp, 0);
  const youLost = losses.reduce((n, x) => n + x.me, 0);
  const sm = seriesOf(c.r, c.me);
  const so = seriesOf(c.r, c.opp);
  if (!mine) {
    return {
      id: "exposed",
      severity: Math.min(0.9, 0.5 + youLost / 2000),
      headline: "You had no army while they had one",
      evidence: [
        `You had no army units (army value 0) at every check from ${mmss(since)} to ${mmss(to)}; opp's army value reached ${at(so, to)?.armyValue ?? "—"}.`,
        `You lost ≈${youLost} in fights in that time; opp lost ≈${theyLost}.`,
      ],
    };
  }
  // Not a window when they put the resources into heroes instead (a hero rush): their heroes
  // were ahead of yours by then.
  if (heroLevelSum(c.opp, to) > heroLevelSum(c.me, to) + 1) return null;
  const halls = RACES[c.me.race as RaceCode]?.townHalls ?? [];
  const expansions = c.me.build.filter((b) => b.kind === "building" && halls.includes(b.code));
  const expandedInWindow = expansions.some((b) => b.ms >= since && b.ms <= to);
  const xp = c.me.metrics.hero_xp_10m;
  const xpGap = proGap(c, "hero_xp_10m");
  const used = expandedInWindow || theyLost >= 400 || (xpGap !== null && xpGap.worseThan < 0.5);
  const evidence = [
    `Opp had no army units (army value 0) at every check from ${mmss(since)} to ${mmss(to)}, only heroes and buildings; your army value was ${at(sm, to)?.armyValue ?? "—"} at ${mmss(to)}.`,
    expandedInWindow
      ? `You expanded in that time (${expansions.filter((b) => b.ms >= since && b.ms <= to).map((b) => mmss(b.ms)).join(", ")}).`
      : `You did not expand in that time (your first expansion: ${expansions.length ? mmss(expansions[0].ms) : "none"}).`,
    `Opp lost ≈${theyLost} in fights in that time; you lost ≈${youLost}.`,
    ...(to >= 600_000 && xp !== null && xp !== undefined ? [`Your hero XP by 10:00: ${num(xp)}${vsPros(c, "hero_xp_10m")}.`] : []),
    `Your workers at ${mmss(to)}: ${at(sm, to)?.workers ?? "—"}; opp's: ${at(so, to)?.workers ?? "—"}.`,
  ];
  return used
    ? null // Used well: not a problem worth a finding (the strengths list covers good numbers).
    : { id: "window", severity: Math.min(0.95, 0.6 + (to - since) / 1_200_000), headline: "They left a window open and you didn't use it", evidence };
}

/**
 * Workers a race needs: 5 on gold per base plus a lumber crew (Grubby, beginner guide #3 and the
 * Human guides: Human 8-9 on wood, 12-13 on two bases; Orc 7; Night Elf 9 wisps; Undead lumber is
 * ghouls, which are not workers). More than that adds nothing, so one base saturates at ~14.
 */
const LUMBER_CREW: Record<RaceCode, [number, number]> = { H: [9, 12], O: [7, 9], N: [9, 12], U: [0, 0] };
const TOWN_HALL_BUILD_MS = 120_000;
function workerTarget(p: PlayerRecord, t: number) {
  const bases = 1 + expansionTimes(p).filter((x) => x + TOWN_HALL_BUILD_MS <= t).length;
  const crew = LUMBER_CREW[p.race as RaceCode] ?? [9, 12];
  return { bases, target: 5 * bases + crew[bases > 1 ? 1 : 0] };
}

/** Below the worker target (5 per gold mine + lumber crew) at 6:00 or 10:00, usually from an idle town hall. */
function economyFinding(c: Ctx): Finding | null {
  const series = seriesOf(c.r, c.me);
  const checks = [
    { t: 360_000, slack: 3, key: "workers6" },
    { t: 600_000, slack: 2, key: "workers10" },
  ]
    .filter(({ t }) => c.r.game.durationMs >= t)
    .map(({ t, slack, key }) => {
      const target = workerTarget(c.me, t);
      // Short of the guides' target and below 9 in 10 pros of the race: Orc and Undead pros run
      // leaner than the guide numbers (Orc pros plateau at ~12 even on two bases).
      const floor = Math.min(target.target - slack, proQ(c, key, "p10") ?? Infinity);
      return { t, floor, workers: at(series, t)?.workers ?? null, ...target };
    })
    .filter((x) => x.workers !== null);
  const short = checks.filter((x) => x.workers! < x.floor);
  if (!short.length) return null;
  const gap = Math.max(...short.map((x) => x.target - x.workers!));
  const m = c.me.metrics;
  return {
    id: "economy",
    severity: Math.min(0.9, 0.55 + 0.05 * gap),
    headline: "You had too few workers",
    evidence: [
      ...checks.map((x) => `Workers at ${mmss(x.t)}: ${x.workers} of the ${x.target} your ${x.bases === 1 ? "base needs" : `${x.bases} bases need`} (5 on gold per base + lumber crew).`),
      ...(m.hall_idle_6m_s !== null && m.hall_idle_6m_s !== undefined ? [`Your main hall was idle ${num(m.hall_idle_6m_s)} of the first 360 seconds${vsPros(c, "hall_idle_6m_s")}; it should train workers non-stop until the target.`] : []),
      ...(m.workers_lost_12m ? [`Workers lost by 12:00: ≈${m.workers_lost_12m}.`] : []),
    ],
  };
}

function heroFinding(c: Ctx): Finding | null {
  const gap = proGap(c, "hero_xp_10m") ?? proGap(c, "hero_xp_6m");
  const share = c.me.metrics.hero_xp_share;
  const losingShare = share !== null && share !== undefined && share < 0.45;
  if ((gap?.worseThan ?? 0) < 0.75 && !losingShare) return null;
  const m = c.me.metrics;
  const end = c.r.game.durationMs;
  return {
    id: "heroes",
    severity: Math.max(gap?.worseThan ?? 0, losingShare ? 0.6 + (0.45 - share!) : 0),
    headline: "Your heroes fell behind",
    evidence: [
      `Hero XP by 6:00: you ${num(m.hero_xp_6m)}, opp ${num(c.opp.metrics.hero_xp_6m)}${vsPros(c, "hero_xp_6m")}.`,
      ...(m.hero_xp_10m !== null && m.hero_xp_10m !== undefined ? [`Hero XP by 10:00: you ${num(m.hero_xp_10m)}, opp ${num(c.opp.metrics.hero_xp_10m)}${vsPros(c, "hero_xp_10m")}.`] : []),
      ...(m.hero_level3_ms !== null && m.hero_level3_ms !== undefined ? [`First hero level 3 at ${mmss(m.hero_level3_ms)}${vsPros(c, "hero_level3_ms", mmss)}.`] : []),
      `Creep camps cleared by 6:00: ${num(m.creep_camps_6m)}${vsPros(c, "creep_camps_6m")}.`,
      ...(share !== null && share !== undefined ? [`Your share of both players' hero XP: ${Math.round(share * 100)}%.`] : []),
      `Hero levels at the end: yours ${heroLevels(c.me, end)}; opp's ${heroLevels(c.opp, end)}.`,
    ],
  };
}

function fightFinding(c: Ctx): Finding | null {
  const losses = fightLosses(c.r, c.me, c.opp);
  const youLost = losses.reduce((n, x) => n + x.me, 0);
  const theyLost = losses.reduce((n, x) => n + x.opp, 0);
  const trade = proGap(c, "trade_efficiency");
  if (youLost <= theyLost * 1.5 || youLost < 800) return null;
  const sim = c.r.sim?.status === "ok" ? c.r.sim.players.find((p) => p.playerId === c.me.playerId)?.heroes ?? [] : [];
  const worst = [...losses].sort((a, b) => b.me - b.opp - (a.me - a.opp)).slice(0, 3).sort((a, b) => a.f.start - b.f.start);
  const deathsNear = (from: number, to: number) => sim.flatMap((h) => h.deaths.filter((d) => d.diedAt >= from - 30_000 && d.diedAt <= to + 30_000).map((d) => `your ${h.name} died ≈${mmss(d.diedAt)}`));
  const items = [c.me.metrics.items_bought, c.opp.metrics.items_bought];
  return {
    id: "fights",
    severity: Math.max(trade?.worseThan ?? 0.6, 0.6),
    headline: "Your fights cost far more than theirs",
    evidence: [
      `In fights you lost ≈${youLost}, opp lost ≈${theyLost} (trade efficiency ≈${Math.round((c.me.metrics.trade_efficiency ?? 0) * 100)}%${trade ? `, pros median ${Math.round(trade.median * 100)}%` : ""}).`,
      ...worst.map((x) => {
        const d = deathsNear(x.f.start, x.f.end);
        return `${mmss(x.f.start)}–${mmss(x.f.end)} ${x.f.category.replace(/-/g, " ")}: you lost ≈${x.me}, opp ≈${x.opp}${d.length ? `; ${d.join(", ")}` : ""}.`;
      }),
      ...((items[1] ?? 0) >= 8 && (items[1] ?? 0) >= 3 * Math.max(1, items[0] ?? 0) ? [`Items bought: you ${num(items[0])}, opp ${num(items[1])}.`] : []),
    ],
  };
}

function supplyFinding(c: Ctx): Finding | null {
  const g = proGap(c, "supply_blocked_s");
  if (!g || g.worseThan < 0.75) return null;
  return {
    id: "supply",
    severity: 0.4 + g.worseThan / 4,
    headline: "You got supply blocked",
    evidence: [`Time supply blocked: ${num(c.me.metrics.supply_blocked_s)} s${vsPros(c, "supply_blocked_s")}.`],
  };
}

function mechanicsFinding(c: Ctx): Finding | null {
  const apm = proGap(c, "apm");
  const hotkeys = proGap(c, "hotkey_select_share");
  if (!apm || !hotkeys || apm.worseThan < 0.9 || hotkeys.worseThan < 0.75) return null;
  const m = c.me.metrics;
  return {
    id: "mechanics",
    // Real but slow to fix: ranked below the game-specific findings.
    severity: 0.5,
    headline: "Speed and hotkeys are a long-term gap",
    evidence: [
      `APM: you ${num(m.apm)}, opp ${num(c.opp.metrics.apm)}${vsPros(c, "apm")}.`,
      `Selections via hotkey: ${Math.round((m.hotkey_select_share ?? 0) * 100)}%${vsPros(c, "hotkey_select_share", (v) => `${Math.round(v * 100)}%`)}.`,
      `Control-group recalls per minute: ${num(m.control_group_recalls_per_min)}${vsPros(c, "control_group_recalls_per_min")}.`,
    ],
  };
}


/** Share of pro games with a lower value (per 10 minutes for whole-game totals); null without data. */
function proShareBelow(c: Ctx, key: string): number | null {
  const def = METRICS.find((m) => m.key === key);
  const raw = c.me.metrics[key];
  const entry = c.ref?.mp.metrics[key];
  if (!def || raw === null || raw === undefined || !entry) return null;
  const stat = def.scalesWithLength && entry.per10 ? entry.per10 : entry;
  if (stat.values.length < 5) return null;
  return percentileOf(stat.values, def.scalesWithLength && entry.per10 ? per10Minutes(raw, c.r.game.durationMs) : raw);
}

const simHeroes = (c: Ctx, p: PlayerRecord) => (c.r.sim?.status === "ok" ? (c.r.sim.players.find((x) => x.playerId === p.playerId)?.heroes ?? []) : []);
const expansionTimes = (p: PlayerRecord) => {
  const halls = RACES[p.race as RaceCode]?.townHalls ?? [];
  return p.build.filter((b) => b.kind === "building" && halls.includes(b.code)).map((b) => b.ms);
};

/** Official basics: keep heroes alive "at all costs"; a Town Portal is the way out. */
function heroDeathsFinding(c: Ctx): Finding | null {
  const mine = simHeroes(c, c.me).flatMap((h) => h.deaths.map((d) => ({ h, d })));
  const theirs = simHeroes(c, c.opp).reduce((n, h) => n + h.deaths.length, 0);
  if (mine.length < 2 || mine.length <= theirs) return null;
  const m = c.me.metrics;
  return {
    id: "hero_deaths",
    severity: Math.min(0.9, 0.55 + 0.1 * (mine.length - theirs)),
    headline: "You lost your heroes too often",
    evidence: [
      `Your heroes died ${mine.length} times, opp's ${theirs}: ${mine
        .sort((a, b) => a.d.diedAt - b.d.diedAt)
        .map(({ h, d }) => `${h.name} ≈${mmss(d.diedAt)}${d.revivedAt !== null && d.revivedAt <= c.r.game.durationMs ? ` (back ${mmss(d.revivedAt)})` : " (not back before the end)"}`)
        .join(", ")}.`,
      `Town Portals bought: you ${num(m.tp_bought)}, opp ${num(c.opp.metrics.tp_bought)}. Potions bought: you ${num(m.potions_bought)}, opp ${num(c.opp.metrics.potions_bought)}.`,
    ],
  };
}

/** Official basics: when all your heroes are dead, retreat (no experience, no spells). */
function noHeroesFinding(c: Ctx): Finding | null {
  const heroes = simHeroes(c, c.me).filter((h) => h.appearAt !== null);
  if (!heroes.length) return null;
  const allDead = (t: number) =>
    heroes.every((h) => h.appearAt! > t || h.deaths.some((d) => d.diedAt <= t && (d.revivedAt === null || d.revivedAt > t))) && heroes.some((h) => h.appearAt! <= t);
  const losses = fightLosses(c.r, c.me, c.opp).filter((x) => allDead(x.f.start) || allDead((x.f.start + x.f.end) / 2));
  const lost = losses.reduce((n, x) => n + x.me, 0);
  if (lost < 300) return null;
  return {
    id: "no_heroes",
    severity: Math.min(0.85, 0.55 + lost / 4000),
    headline: "You kept fighting with all heroes dead",
    evidence: [
      ...losses.map((x) => `${mmss(x.f.start)}–${mmss(x.f.end)} ${x.f.category.replace(/-/g, " ")} while all your heroes were dead: you lost ≈${x.me}, opp ≈${x.opp}.`),
    ],
  };
}

/** Sim fights you took part in that start in [from, to]. */
const fightsNear = (c: Ctx, from: number, to: number) =>
  (c.r.sim?.status === "ok" ? (c.r.sim.fights ?? []) : []).filter((f) => f.start >= from && f.start <= to && f.playerIds.includes(c.me.playerId) && f.category !== "creep-fight");

/**
 * High upkeep (above 80 food: you keep 40% of mined gold). Official page: avoid it unless you have
 * 2-3 expansions. Grubby: only go there "if you intend to use it to fight very soon". Counted
 * with fewer than 2 expansions (also requiring "no fight within 90 s" almost never fired: the
 * simulation sees some fight nearly all the time); the fights are given as evidence instead.
 */
function upkeepFinding(c: Ctx): Finding | null {
  const series = seriesOf(c.r, c.me);
  const exp = expansionTimes(c.me);
  let seconds = 0;
  let first: number | null = null;
  for (let i = 1; i < series.length; i++) {
    const s = series[i];
    const bases = exp.filter((t) => t <= s.t).length; // expansions ordered by then
    if (s.foodUsed > 80 && bases < 2) {
      seconds += (s.t - series[i - 1].t) / 1000;
      first ??= s.t;
    }
  }
  // More than 9 in 10 pros of your race (and at least 2 minutes).
  if (seconds < Math.max(120, proQ(c, "highUpkeepFewBases", "p90") ?? 0)) return null;
  const top = Math.max(...series.map((s) => s.foodUsed));
  return {
    id: "upkeep",
    severity: Math.min(0.8, 0.5 + seconds / 1200),
    headline: "You sat in high upkeep on too few bases",
    evidence: [
      `You were above 80 food (high upkeep: you keep 40% of the gold your workers mine) for ${Math.round(seconds)} s, from ${mmss(first)}; at most ${top} food. Go that high only right before a fight.`,
      `Fights you were in from then on: ${fightsNear(c, first ?? 0, c.r.game.durationMs).map((f) => `${mmss(f.start)} ${f.category.replace(/-/g, " ")}`).join(", ") || "none"}.`,
      `Expansions by ${mmss(first)}: ${exp.filter((t) => t <= (first ?? 0)).length} (your expansions: ${exp.length ? exp.map((t) => mmss(t)).join(", ") : "none"}).`,
      `Opp's highest food: ${Math.max(0, ...seriesOf(c.r, c.opp).map((s) => s.foodUsed))}.`,
    ],
  };
}

/** Liquipedia: Human (and most races) expand early when safe. No expansion, or much later than pros. */
function expansionFinding(c: Ctx): Finding | null {
  const ms = c.me.metrics.expansion_ms;
  const pro = c.ref?.mp.metrics.expansion_ms;
  if (!pro || pro.values.length < 5) return null;
  const p75 = [...pro.values].sort((a, b) => a - b)[Math.floor(pro.values.length * 0.75)];
  // Tested on 56 pro perspectives: "later than 3 in 4 pros" fired for half of them, wins and
  // losses alike. Only the extreme case is worth saying: a long game on one base while the
  // opponent expanded.
  const late = (ms === null || ms === undefined) && c.r.game.durationMs >= 20 * 60_000 && c.opp.metrics.expansion_ms !== null && c.opp.metrics.expansion_ms !== undefined;
  if (!late) return null;
  return {
    id: "expansion",
    severity: ms === null || ms === undefined ? 0.65 : 0.55,
    headline: ms === null || ms === undefined ? "You never expanded" : "You expanded late",
    evidence: [
      `Your first expansion: ${ms === null || ms === undefined ? "none" : mmss(ms)}; pros who expanded did it by ${mmss(pro.p50)} (median) and ${mmss(p75)} (three in four).`,
      `Opp's first expansion: ${mmss(c.opp.metrics.expansion_ms)}.`,
    ],
  };
}



/** Pros' quantile of a mined feature (scripts/mine-principles.ts) for the player's race, or null. */
function proQ(c: Ctx, key: string, q: "p10" | "p25" | "p50" | "p75" | "p90"): number | null {
  const p = c.ref?.principles;
  const f = p && p.race === c.me.race ? p.features[key]?.all : null;
  return f ? f[q] : null;
}

// ---- Basics: clear beginner mistakes. Thresholds sit outside what the pro games show, so these
// stay quiet for good players and speak up for new ones (they rank below the findings above).
const BASIC = 0.5;

/** Every race's standard opening (Liquipedia): creep as soon as the hero leaves the altar. Pros: median 9 s, 90% within 67 s. */
function firstCreepFinding(c: Ctx): Finding | null {
  const hero = Math.min(...simHeroes(c, c.me).map((h) => h.appearAt ?? Infinity));
  const creep = c.me.metrics.first_creep_ms;
  // Beyond what 9 in 10 pros of your race do (at least 90 s).
  const limit = Math.max(90_000, proQ(c, "creepDelay", "p90") ?? 0);
  if (!Number.isFinite(hero) || creep === null || creep === undefined || creep - hero <= limit) return null;
  return {
    id: "first_creep",
    severity: BASIC,
    headline: "Your hero waited before creeping",
    evidence: [`Your first hero appeared at ${mmss(hero)} and first fought creeps at ${mmss(creep)}: ${Math.round((creep - hero) / 1000)} s later (pros: within about 10 s, almost always within 70 s).`],
  };
}

/** Pros order their first attack upgrade by about 9:00 (90% by 12:00). None by 15:00 in a longer game is a gap. */
function upgradesFinding(c: Ctx): Finding | null {
  const m = c.me.metrics;
  const first = Math.min(m.first_attack_upgrade_ms ?? Infinity, m.first_armor_upgrade_ms ?? Infinity);
  if (c.r.game.durationMs < 15 * 60_000 || first <= 15 * 60_000) return null;
  return {
    id: "upgrades",
    severity: BASIC + 0.05,
    headline: "No attack or armor upgrades for 15 minutes",
    evidence: [
      `Your first attack upgrade: ${mmss(m.first_attack_upgrade_ms)}; first armor upgrade: ${mmss(m.first_armor_upgrade_ms)} (pros: first attack upgrade around 9:00).`,
      `Opp's: attack ${mmss(c.opp.metrics.first_attack_upgrade_ms)}, armor ${mmss(c.opp.metrics.first_armor_upgrade_ms)}.`,
    ],
  };
}

/** A long game on one hero while the opponent had more (one-hero builds exist, so only then). */
function oneHeroFinding(c: Ctx): Finding | null {
  if (c.r.game.durationMs < 15 * 60_000 || c.me.heroes.length !== 1 || c.opp.heroes.length < 2) return null;
  return {
    id: "one_hero",
    severity: BASIC,
    headline: "One hero against several",
    evidence: [`You played ${mmss(c.r.game.durationMs)} with one hero (${c.me.heroes[0].name}); opp had ${c.opp.heroes.length} (${c.opp.heroes.map((h) => h.name).join(", ")}). Pros get their second hero around 7:00.`],
  };
}

/** Items (potions, scrolls, Town Portal) keep heroes alive; most pros buy a few. */
function noItemsFinding(c: Ctx): Finding | null {
  if (c.r.game.durationMs < 12 * 60_000 || (c.me.metrics.items_bought ?? 0) > 0) return null;
  return {
    id: "no_items",
    severity: BASIC,
    headline: "You never used the shop",
    evidence: [`Items bought: you 0, opp ${num(c.opp.metrics.items_bought)} (pros: about 5 a game). Potions, healing scrolls and a Town Portal save heroes and units.`],
  };
}

/** Unspent gold in the first 10 minutes (estimate): money in the bank is army or tech you don't have. */
function floatingFinding(c: Ctx): Finding | null {
  const avg = c.me.metrics.est_bank_avg;
  const pro = c.ref?.mp.metrics.est_bank_avg;
  if (avg === null || avg === undefined || !pro || pro.values.length < 10) return null;
  const p90 = [...pro.values].sort((a, b) => a - b)[Math.floor(pro.values.length * 0.9)];
  if (avg <= Math.max(p90, 400)) return null;
  return {
    id: "floating",
    severity: BASIC,
    headline: "Gold sat unspent",
    evidence: [`Average unspent gold over the first 10 minutes: ≈${Math.round(avg)} (pros median ≈${Math.round(pro.p50)}; 9 in 10 below ≈${Math.round(p90)}). Estimated from your workers and spending.`],
  };
}

/** The opponent started an expansion while your army was bigger, and you left it alone for 4 minutes. */
function unansweredExpansionFinding(c: Ctx): Finding | null {
  const t = expansionTimes(c.opp).find((x) => x > 60_000);
  if (t === undefined || c.r.sim?.status !== "ok") return null;
  const mine = at(seriesOf(c.r, c.me), t)?.armyValue ?? 0;
  const theirs = at(seriesOf(c.r, c.opp), t)?.armyValue ?? 0;
  if (mine <= theirs || mine === 0) return null;
  const fought = (c.r.sim.fights ?? []).some((f) => f.start >= t && f.start <= t + 240_000 && f.playerIds.includes(c.me.playerId) && f.playerIds.includes(c.opp.playerId));
  if (fought) return null;
  return {
    id: "unanswered_expansion",
    severity: BASIC,
    headline: "Their expansion went unchallenged",
    evidence: [`Opp started an expansion at ${mmss(t)} while your army was bigger (≈${mine} vs ≈${theirs}); no fight between you in the next 4 minutes.`],
  };
}

/** Grubby: 51 food is "almost no benefit for maximum disadvantage": low upkeep for one extra unit. */
function justOver50Finding(c: Ctx): Finding | null {
  const series = seriesOf(c.r, c.me);
  let seconds = 0;
  for (let i = 1; i < series.length; i++) {
    const s = series[i];
    if (s.foodUsed >= 51 && s.foodUsed <= 54 && !fightsNear(c, s.t - 60_000, s.t + 60_000).length) seconds += (s.t - series[i - 1].t) / 1000;
  }
  if (seconds < 120) return null;
  return {
    id: "just_over_50",
    severity: BASIC,
    headline: "You sat just over 50 food",
    evidence: [`You spent ${Math.round(seconds)} s at 51-54 food without fighting: that already costs 30% of your gold income (low upkeep) for one or two extra units. Stay at 50 and invest (upgrades, items, a production building), then go well past it right before a fight.`],
  };
}

/** 2026 Human guide (Grubby): one arcane tower and maybe one guard tower per base; more gains little. */
function towersFinding(c: Ctx): Finding | null {
  const towers = c.me.metrics.towers_total ?? 0; // build and upgrade orders: a guard tower is 2
  const bases = 1 + expansionTimes(c.me).length;
  if (towers / bases <= Math.max(6, proQ(c, "towersPerBase", "p90") ?? 0)) return null;
  return {
    id: "towers",
    severity: BASIC,
    headline: "More towers than they're worth",
    evidence: [`Tower build/upgrade orders: ${towers} for ${bases} base${bases > 1 ? "s" : ""} (a guide rule of thumb: an arcane tower and maybe a guard tower per base; after that units are worth more). Kills by towers give your heroes no experience.`],
  };
}

/** Human guide: losing about five workers (e.g. while expanding) puts you too far behind. */
function workersLostFinding(c: Ctx): Finding | null {
  const lost = c.me.metrics.workers_lost_12m ?? 0;
  if (lost < Math.max(5, (proQ(c, "workersLost12", "p90") ?? 0) + 1)) return null;
  return {
    id: "workers_lost",
    severity: BASIC + 0.1,
    headline: "You lost too many workers",
    evidence: [`Workers lost by 12:00: ≈${lost} (pros: usually 0-4; deaths are inferred and tend to be undercounted). Pull workers away or fight back with militia/towers when harassed.`],
  };
}

/** Grubby's beginner goal "3360": first hero level 3, second hero level 3, 60 food; then seek a fight. */
function goal3360Finding(c: Ctx): Finding | null {
  const pro = c.ref?.mp.metrics.goal_3360_ms;
  if (!pro || pro.values.length < 10 || c.r.game.durationMs < 15 * 60_000) return null;
  const p75 = [...pro.values].sort((a, b) => a - b)[Math.floor(pro.values.length * 0.75)];
  const got = c.me.metrics.goal_3360_ms;
  if (got !== null && got !== undefined && got <= p75) return null;
  if ((got === null || got === undefined) && c.r.game.durationMs < p75 + 180_000) return null;
  const byOrder = [...c.me.heroes].sort((a, b) => a.order - b.order);
  const food60 = seriesOf(c.r, c.me).find((s) => s.foodUsed >= 60)?.t ?? null;
  return {
    id: "goal_3360",
    severity: BASIC,
    headline: got ? "Late to the 3-3-60 goal" : "Never reached the 3-3-60 goal",
    evidence: [
      `Grubby's beginner goal: first hero level 3, second hero level 3, 60 food. You: first hero level 3 at ${mmss(byOrder[0]?.levelUps[2] ?? null)}, second hero level 3 at ${mmss(byOrder[1]?.levelUps[2] ?? null)}, 60 food at ${mmss(food60)}${got ? ` (all three at ${mmss(got)})` : ""}. Pros: median ${mmss(pro.p50)}.`,
    ],
  };
}

const MINE_GOLD = 12_500;
const tier3Of = (p: PlayerRecord) => p.build.find((b) => b.code === RACES[p.race as RaceCode]?.tier3)?.ms ?? null;

/**
 * Warcraft 3 Gym (all races): "the goal is always to reach 50 supply with level 3 on both heroes",
 * then attack, expand, or tech to tier 3 (Rifle Caster guide; Grubby: "then seek a fight").
 * Fires when 4 minutes after first reaching 50 food you had done none of the three.
 */
function unusedSpikeFinding(c: Ctx): Finding | null {
  const t50 = seriesOf(c.r, c.me).find((s) => s.foodUsed >= 50)?.t ?? null;
  const until = t50 === null ? null : t50 + 240_000;
  if (t50 === null || until === null || c.r.game.durationMs < until) return null;
  const attacked = fightsNear(c, t50, until).some((f) => f.initiatorId === c.me.playerId && f.playerIds.includes(c.opp.playerId));
  const expanded = expansionTimes(c.me).some((t) => t >= t50 - 60_000 && t <= until);
  const t3 = tier3Of(c.me);
  const teched = t3 !== null && t3 <= until;
  if (attacked || expanded || teched) return null;
  return {
    id: "unused_spike",
    severity: BASIC + 0.05,
    headline: "You reached 50 food and waited",
    evidence: [`You first had 50 food at ${mmss(t50)}. In the next 4 minutes you started no fight with the opponent, took no expansion and didn't start tier 3. Guides: at 50 food (heroes level 3), attack, expand or tech.`],
  };
}

/**
 * Warcraft 3 Gym (Orc auras guide) and Grubby: don't go over 50 food before investing (attack/armor
 * upgrades), unless you have an expansion.
 */
function upkeepBeforeUpgradesFinding(c: Ctx): Finding | null {
  const over = seriesOf(c.r, c.me).find((s) => s.foodUsed > 50)?.t ?? null;
  if (over === null) return null;
  const m = c.me.metrics;
  const upgraded = Math.min(m.first_attack_upgrade_ms ?? Infinity, m.first_armor_upgrade_ms ?? Infinity) <= over;
  const expanded = expansionTimes(c.me).some((t) => t <= over);
  // Tier 3 is an investment too. (Excusing a fight around that time silenced the rule: the
  // simulation sees some fight nearly all the time.)
  const t3 = tier3Of(c.me);
  const teched = t3 !== null && t3 <= over;
  if (upgraded || expanded || teched) return null;
  return {
    id: "upkeep_before_upgrades",
    severity: BASIC,
    headline: "Into upkeep before any upgrade",
    evidence: [`You went over 50 food at ${mmss(over)} with no attack or armor upgrade and no expansion yet (first upgrade: ${mmss(Math.min(m.first_attack_upgrade_ms ?? Infinity, m.first_armor_upgrade_ms ?? Infinity) === Infinity ? null : Math.min(m.first_attack_upgrade_ms ?? Infinity, m.first_armor_upgrade_ms ?? Infinity))}). Guides: invest at 50 food (upgrades, items, a production building), then break upkeep.`],
  };
}

/** Warcraft 3 Gym: "expand when your gold mine runs out". A mine holds 12,500 gold. */
function mineDryFinding(c: Ctx): Finding | null {
  const collected = c.me.metrics.gold_collected;
  if (collected === null || collected === undefined || collected < MINE_GOLD - 1000) return null;
  const exp = expansionTimes(c.me);
  if (exp.length) return null;
  return {
    id: "mine_dry",
    severity: BASIC + 0.1,
    headline: "Your gold mine ran dry with no second base",
    evidence: [`You collected ≈${Math.round(collected)} gold from one base; a mine holds ${MINE_GOLD}. No expansion was ordered.`],
  };
}

/**
 * Build discipline: compared with pros who played the same build (closest library build, pros'
 * median food at each step), your tier upgrades, expansion or heroes came much later (6+ food).
 */
function buildDriftFinding(c: Ctx): Finding | null {
  const principles = c.ref?.principles;
  if (!principles || principles.race !== c.me.race) return null;
  const [best] = matchBuilds(c.r, c.me);
  const pro = proBuildOf(principles, best);
  if (!best || !pro || pro.players < 8) return null;
  // Tier upgrades and expansions only, 8+ food late: pros adapt their builds, and smaller or other
  // differences fired for a third of pro winners.
  const late = deviationsFromPros(best, pro, 8).filter((d) => ["tech", "expand"].includes(d.action) && d.yours !== null && d.yours > d.pros);
  if (!late.length) return null;
  return {
    id: "build_drift",
    severity: BASIC,
    headline: "Your key steps came late for your build",
    evidence: [
      `Closest build: "${best.build.name}" (${best.build.source.author ?? "guide"}); ${pro.players} pros played it (${Math.round(pro.winRate * 100)}% won).`,
      ...late.map((d) => (d.yours === null ? `No ${d.label}; pros on this build: at ${d.pros} food.` : `${d.label} at ${d.yours} food; pros on this build: ${d.pros} food.`)),
      "Food counts finished units (the game's counter also includes units in training).",
    ],
  };
}

/** Every rule that fires, most costly first. */
/** Every rule that fires, most costly first. */
export function allFindings(r: GameRecord, ref: FactsRef | null, subjectId?: number): Finding[] {
  const me = subjectId === undefined ? r.players.find((p) => p.isMe) : r.players.find((p) => p.playerId === subjectId);
  const opp = r.players.find((p) => p.playerId !== me?.playerId && p.teamId !== me?.teamId);
  if (!me || !opp || r.game.durationMs < MIN_GAME_MS) return [];
  const c: Ctx = { r, me, opp, ref };
  const window = windowFinding(c, true);
  const found = [
    window,
    windowFinding(c, false),
    economyFinding(c),
    heroFinding(c),
    fightFinding(c),
    supplyFinding(c),
    heroDeathsFinding(c),
    noHeroesFinding(c),
    upkeepFinding(c),
    window ? null : expansionFinding(c), // the window finding already says whether you expanded
    firstCreepFinding(c),
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
  ]
    .filter((f): f is Finding => !!f && f.severity >= MIN_SEVERITY)
    .sort((a, b) => b.severity - a.severity);
  // Mechanics are a real but constant, slow-to-fix gap: shown only when the game itself had
  // little else to point at.
  const mech = found.length < 2 ? mechanicsFinding(c) : null;
  return [...found, ...(mech ? [mech] : [])];
}

/** The most important problems in a game, most costly first (at most 3). */
export const findings = (r: GameRecord, ref: FactsRef | null, subjectId?: number) => allFindings(r, ref, subjectId).slice(0, MAX_FINDINGS);

/** Core metrics at pro level, best first: what went well (at most 2). */
export function strengths(r: GameRecord, ref: FactsRef | null): string[] {
  const me = r.players.find((p) => p.isMe);
  const opp = r.players.find((p) => p.playerId === r.classification.opponentId);
  if (!me || !opp || !ref || r.game.durationMs < MIN_GAME_MS) return [];
  const c: Ctx = { r, me, opp, ref };
  return METRICS.filter((m) => m.section === "core" && m.better && !NOT_STRENGTHS.has(m.key))
    .map((m) => ({ m, g: proGap(c, m.key) }))
    .filter((x) => x.g && x.g.worseThan <= 0.4)
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
    const halls = b.filter((x) => x.kind === "building" && race.townHalls.includes(x.code));
    lines.push(`Expansions: ${halls.length ? halls.map((x) => mmss(x.ms)).join(", ") : "none"}.`);
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
