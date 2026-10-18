// What mattered in a game, decided by rules rather than by the language model: tested on Gemma 4
// 26B, the model restated facts reliably but could not tell what decided a game (it missed a
// 6-minute window where the opponent had no army). Told the situation, it explains it well.
// Each finding carries its evidence as plain lines; the model writes the words around them.
import type { GameRecord, PlayerRecord } from "@w3stats/core/ui";
import { RACES, type RaceCode } from "@w3stats/core/gamedata";
import { METRICS, per10Minutes } from "@w3stats/core/metrics";
import { percentileOf } from "@w3stats/reference/quantiles";
import { metricValue, type FactsRef } from "./facts.ts";
import { at, fightLosses, mmss, sampleBoth, seriesOf, STEP_MS } from "./series.ts";

export type Finding = {
  id: "window" | "exposed" | "economy" | "heroes" | "fights" | "supply" | "mechanics" | "hero_deaths" | "no_heroes" | "upkeep" | "turtling" | "expansion" | "creeping";
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

function economyFinding(c: Ctx): Finding | null {
  // Workers decide it; an idle hall only counts when workers are behind too (a hall can look
  // idle while workers come from an expansion).
  const workers = proGap(c, "workers_alive_10m") ?? proGap(c, "workers_alive_6m");
  const idle = proGap(c, "hall_idle_6m_s");
  if (!workers) return null;
  const severity = workers.worseThan >= 0.5 && idle && idle.worseThan >= 0.85 ? (workers.worseThan + idle.worseThan) / 2 : workers.worseThan;
  if (severity < 0.7) return null;
  const m = c.me.metrics;
  const o = c.opp.metrics;
  return {
    id: "economy",
    severity,
    headline: "Your economy stalled early",
    evidence: [
      `Workers alive at 6:00: you ${num(m.workers_alive_6m)}, opp ${num(o.workers_alive_6m)}${vsPros(c, "workers_alive_6m")}.`,
      ...(m.workers_alive_10m !== null && m.workers_alive_10m !== undefined ? [`Workers alive at 10:00: you ${num(m.workers_alive_10m)}, opp ${num(o.workers_alive_10m)}${vsPros(c, "workers_alive_10m")}.`] : []),
      `Your main hall was idle ${num(m.hall_idle_6m_s)} of the first 360 seconds${vsPros(c, "hall_idle_6m_s")}.`,
      `Workers ordered by 6:00: you ${num(m.workers_by_6m)}, opp ${num(o.workers_by_6m)}${vsPros(c, "workers_by_6m")}.`,
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

/** Official upkeep page: above 80 food you keep 40% of mined gold; avoid it unless you have 2-3 expansions. */
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
  if (seconds < 120) return null;
  const top = Math.max(...series.map((s) => s.foodUsed));
  return {
    id: "upkeep",
    severity: Math.min(0.8, 0.5 + seconds / 1200),
    headline: "You sat in high upkeep on too few bases",
    evidence: [
      `You were above 80 food (high upkeep: you keep 40% of the gold your workers mine) for ${Math.round(seconds)} s, from ${mmss(first)}; at most ${top} food.`,
      `Expansions by ${mmss(first)}: ${exp.filter((t) => t <= (first ?? 0)).length} (your expansions: ${exp.length ? exp.map((t) => mmss(t)).join(", ") : "none"}).`,
      `Opp's highest food: ${Math.max(0, ...seriesOf(c.r, c.opp).map((s) => s.foodUsed))}.`,
    ],
  };
}

/** StrategyWiki: building static defense concedes map control. Many towers plus a passive map game. */
function turtlingFinding(c: Ctx): Finding | null {
  const towers = c.me.metrics.towers_total ?? 0;
  const share = proShareBelow(c, "towers_total");
  if (towers < 6 || share === null || share < 0.85) return null;
  const xp = proGap(c, "hero_xp_10m");
  const exp = proShareBelow(c, "expansion_ms");
  const passive = (xp && xp.worseThan >= 0.7) || c.me.metrics.expansion_ms === null || (exp !== null && exp >= 0.75);
  if (!passive) return null;
  return {
    id: "turtling",
    severity: 0.6 + (share - 0.85),
    headline: "Towers instead of map control",
    evidence: [
      `Tower build/upgrade orders: you ${towers}, opp ${num(c.opp.metrics.towers_total)} (more than ${Math.round(share * 100)}% of pro games, per 10 minutes).`,
      `Your first expansion: ${mmss(c.me.metrics.expansion_ms)}${c.ref?.mp.metrics.expansion_ms ? ` (pros median ${mmss(c.ref.mp.metrics.expansion_ms.p50)})` : ""}.`,
      ...(c.me.metrics.hero_xp_10m !== null && c.me.metrics.hero_xp_10m !== undefined ? [`Your hero XP by 10:00: ${num(c.me.metrics.hero_xp_10m)}${vsPros(c, "hero_xp_10m")}.`] : []),
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

/** Official basics: heroes of level 5 and above get no experience from creeps. */
function creepingFinding(c: Ctx): Finding | null {
  const fights = c.r.sim?.status === "ok" ? (c.r.sim.fights ?? []) : [];
  const heroes = c.me.heroes;
  const wasted = fights.filter((f) => {
    if (f.category !== "creep-fight" || !f.playerIds.includes(c.me.playerId)) return false;
    const present = heroes.filter((h) => (h.levelUps[0] ?? Infinity) <= f.start);
    return present.length > 0 && present.every((h) => h.levelUps.filter((x) => x <= f.start).length >= 5);
  });
  if (wasted.length < 2) return null;
  return {
    id: "creeping",
    severity: 0.5,
    headline: "Creeping with heroes that no longer gain XP from it",
    evidence: [`Creep fights after all your heroes reached level 5 (no experience from creeps from then on): ${wasted.map((f) => mmss(f.start)).join(", ")}.`],
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
    creepingFinding(c),
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
