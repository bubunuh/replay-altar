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
import { at, expansionsOf, fightLabel, fightLosses, levelSum, mmss, sampleBoth, sampleTimes, seriesOf, STEP_MS } from "./series.ts";
import { adviceFor } from "./advice.ts";
import { ATTACK_NAME, airShare, antiAirShare, armyMix, bestAgainst, canHitAir, describeMix, mixValue, mixVsMix } from "./combat.ts";
import { CORE_UPGRADES, POTION_ITEMS, TOWN_PORTAL } from "@replay-altar/core/gamedata";

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
  /** Fallback title when the model is not available. */
  headline: string;
  evidence: string[];
  /** What to do differently next time (advice.ts, or the rule's own). */
  advice?: string;
  /** Facts from elsewhere in the game that explain it ("you fought with 2 items against their 21"). */
  because?: string[];
};

const MIN_SEVERITY = 0.5;
const MAX_FINDINGS = 3;
/** Shorter games (someone left early) say nothing about how you play. */
export const MIN_GAME_MS = 180_000;
/** Core metrics that are not skills worth praising (being attacked less is not your doing). */
const NOT_STRENGTHS = new Set(["fights_defending"]);
/** Per race: Undead mine with 5 Acolytes, so more early Acolytes mean an expansion, not better play. */
const NOT_STRENGTHS_FOR: Partial<Record<RaceCode, Set<string>>> = { U: new Set(["workers_by_6m"]) };

export type Ctx = { r: GameRecord; me: PlayerRecord; opp: PlayerRecord; ref: FactsRef | null };

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
  const expansions = expansionTimes(c.r, c.me);
  const expandedInWindow = expansions.some((t) => t >= since && t <= to);
  const xp = c.me.metrics.hero_xp_10m;
  const xpGap = proGap(c, "hero_xp_10m");
  const used = expandedInWindow || theyLost >= 400 || (xpGap !== null && xpGap.worseThan < 0.5);
  const evidence = [
    `Opp had no army units (army value 0) at every check from ${mmss(since)} to ${mmss(to)}, only heroes and buildings; your army value was ${at(sm, to)?.armyValue ?? "—"} at ${mmss(to)}.`,
    expandedInWindow
      ? `You expanded in that time (${expansions.filter((t) => t >= since && t <= to).map((t) => mmss(t)).join(", ")}).`
      : `You did not expand in that time (your first expansion: ${expansions.length ? mmss(expansions[0]) : "none"}).`,
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
function workerTarget(r: GameRecord, p: PlayerRecord, t: number) {
  const bases = 1 + expansionTimes(r, p).filter((x) => x + TOWN_HALL_BUILD_MS <= t).length;
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
      const target = workerTarget(c.r, c.me, t);
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
      ...(m.hall_idle_6m_s !== null && m.hall_idle_6m_s !== undefined && (proGap(c, "hall_idle_6m_s")?.worseThan ?? 1) >= 0.5 ? [`Your main hall was idle ${num(m.hall_idle_6m_s)} of the first 360 seconds${vsPros(c, "hall_idle_6m_s")}; it should train workers non-stop until the target.`] : []),
      ...(m.workers_lost_12m ? [`Workers lost by 12:00: ≈${m.workers_lost_12m}.`] : []),
    ],
  };
}

/**
 * The longest stretch in which one of your first two heroes gained no level (from appearing, or
 * from its last level, until the next level or the end), with how many levels their heroes
 * gained meanwhile.
 */
export function heroStall(c: Ctx) {
  const end = c.r.game.durationMs;
  const appear = new Map(simHeroes(c, c.me).map((h) => [h.code, h.appearAt]));
  let best: { name: string; level: number; from: number; to: number; theirs: number; theirTop: string } | null = null;
  for (const h of [...c.me.heroes].sort((a, b) => a.order - b.order).slice(0, 2)) {
    const start = appear.get(h.code) ?? h.levelUps[0];
    if (start === null || start === undefined) continue;
    // A hero starts at level 1; its first skill point is spent at once, later ones at each level.
    const marks = [start, ...h.levelUps.slice(1), end];
    for (let i = 0; i + 1 < marks.length; i++) {
      const [from, to] = [marks[i], marks[i + 1]];
      if (best && to - from <= best.to - best.from) continue;
      // Levels gained, not skill points: a hero's first point comes with it at level 1.
      const gained = (x: (typeof c.opp.heroes)[number]) => x.levelUps.slice(1).filter((t) => t > from && t <= to).length;
      const theirs = c.opp.heroes.reduce((n, x) => n + gained(x), 0);
      const top = [...c.opp.heroes].sort((a, b) => gained(b) - gained(a))[0];
      const lv = (t: number) => Math.max(1, top?.levelUps.filter((x) => x <= t).length ?? 1);
      best = { name: h.name, level: i + 1, from, to, theirs, theirTop: top ? `their ${top.name} went from level ${lv(from)} to ${lv(to)}` : "" };
    }
  }
  return best;
}
const STALL_MS = 6 * 60_000;

function heroFinding(c: Ctx): Finding | null {
  const gap = proGap(c, "hero_xp_10m") ?? proGap(c, "hero_xp_6m");
  const share = c.me.metrics.hero_xp_share;
  // A low share of both players' XP goes with losing even when your own pace was like pros'
  // (holdout: 68% of pro losses vs 30% of wins; requiring a slow pace too dropped it to 47%).
  // Then the gap is theirs, not your creeping, and the advice says so.
  const losingShare = share !== null && share !== undefined && share < 0.45;
  if ((gap?.worseThan ?? 0) < 0.75 && !losingShare) return null;
  const ownPaceFine = (gap?.worseThan ?? 1) < 0.5;
  const m = c.me.metrics;
  const end = c.r.game.durationMs;
  return {
    id: "heroes",
    severity: Math.max(gap?.worseThan ?? 0, losingShare ? 0.6 + (0.45 - share!) : 0),
    // Ahead of the opponent but slow by pro standards: say so, not "fell behind" (scan-reports).
    headline: ownPaceFine ? "Their heroes out-levelled yours" : (share ?? 0) >= 0.5 ? "Your heroes levelled slower than pros, though faster than theirs" : "Your heroes fell behind",
    ...(ownPaceFine
      ? { advice: "Your own levelling was at pro pace; theirs was faster, much of it from your units. Fight with your heroes alive and focus theirs, don't trade units in small skirmishes, and creep the camps on their side to take that experience away." }
      : {}),
    evidence: [
      `Hero XP by 6:00: you ${num(m.hero_xp_6m)}, opp ${num(c.opp.metrics.hero_xp_6m)}${vsPros(c, "hero_xp_6m")}.`,
      ...(m.hero_xp_10m !== null && m.hero_xp_10m !== undefined ? [`Hero XP by 10:00: you ${num(m.hero_xp_10m)}, opp ${num(c.opp.metrics.hero_xp_10m)}${vsPros(c, "hero_xp_10m")}.`] : []),
      ...(m.hero_level3_ms !== null && m.hero_level3_ms !== undefined ? [`First hero level 3 at ${mmss(m.hero_level3_ms)}${vsPros(c, "hero_level3_ms", mmss)}.`] : []),
      `Creep camps cleared by 6:00: ${num(m.creep_camps_6m)}${vsPros(c, "creep_camps_6m")}.`,
      ...(share !== null && share !== undefined ? [`Your share of both players' hero XP: ${Math.round(share * 100)}%.`] : []),
      `Hero levels at the end: yours ${heroLevels(c.me, end)}; opp's ${heroLevels(c.opp, end)}.`,
      ...stallLine(c),
    ],
  };
}

const stallLine = (c: Ctx) => {
  const s = heroStall(c);
  return s && s.level <= 3 && s.to - s.from >= STALL_MS && s.theirs >= 2 ? [`Your ${s.name} stayed level ${s.level} from ${mmss(s.from)} to ${mmss(s.to)}; meanwhile ${s.theirTop}.`] : [];
};

function fightFinding(c: Ctx): Finding | null {
  const losses = fightLosses(c.r, c.me, c.opp);
  const youLost = losses.reduce((n, x) => n + x.me, 0);
  const theyLost = losses.reduce((n, x) => n + x.opp, 0);
  const trade = proGap(c, "trade_efficiency");
  if (youLost <= theyLost * 1.3 || youLost < 800) return null;
  // The whole-game trade (all losses, not only detected fights) at or above the pro median
  // contradicts "your fights cost far more"; seen in reviews of pro games.
  if (trade && trade.worseThan < 0.5) return null;
  const sim = c.r.sim?.status === "ok" ? c.r.sim.players.find((p) => p.playerId === c.me.playerId)?.heroes ?? [] : [];
  const worst = losses.filter((x) => x.me > x.opp).sort((a, b) => b.me - b.opp - (a.me - a.opp)).slice(0, 3).sort((a, b) => a.f.start - b.f.start);
  const deathsNear = (from: number, to: number) => sim.flatMap((h) => h.deaths.filter((d) => d.diedAt >= from - 30_000 && d.diedAt <= to + 30_000).map((d) => `your ${h.name} died ≈${mmss(d.diedAt)}`));
  return {
    id: "fights",
    severity: Math.max(trade?.worseThan ?? 0.6, 0.6),
    headline: "Your fights cost far more than theirs",
    evidence: [
      `In fights you lost ≈${youLost}, opp lost ≈${theyLost} (trade efficiency ≈${Math.round((c.me.metrics.trade_efficiency ?? 0) * 100)}%${trade ? `, pros median ${Math.round(trade.median * 100)}%` : ""}).`,
      ...worst.map((x) => {
        const d = deathsNear(x.f.start, x.f.end);
        return `${mmss(x.f.start)}–${mmss(x.f.end)} ${fightLabel(x.f.category)}: you lost ≈${x.me}, opp ≈${x.opp}${d.length ? `; ${d.join(", ")}` : ""}.`;
      }),
    ],
  };
}

function supplyFinding(c: Ctx): Finding | null {
  const g = proGap(c, "supply_blocked_s");
  // Compared per 10 minutes: in a 5-minute game 13 s looked like 26. Under 30 s isn't worth a finding.
  if (!g || g.worseThan < 0.75 || (c.me.metrics.supply_blocked_s ?? 0) < 30) return null;
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
const expansionTimes = (r: GameRecord, p: PlayerRecord) => expansionsOf(r, p);

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
  // Defending your own base when they attack it can't be avoided by retreating.
  const atHome = (x: { f: { category: string; initiatorId: number | null } }) => x.f.initiatorId === c.opp.playerId && (x.f.category === "tower-dive" || x.f.category === "base-defense");
  const losses = fightLosses(c.r, c.me, c.opp).filter((x) => !atHome(x) && (allDead(x.f.start) || allDead((x.f.start + x.f.end) / 2)));
  const lost = losses.reduce((n, x) => n + x.me, 0);
  if (lost < 300) return null;
  return {
    id: "no_heroes",
    severity: Math.min(0.85, 0.55 + lost / 4000),
    headline: "You kept fighting with all heroes dead",
    evidence: [
      ...losses.map((x) => `${mmss(x.f.start)}–${mmss(x.f.end)} ${fightLabel(x.f.category)} while all your heroes were dead: you lost ≈${x.me}, opp ≈${x.opp}.`),
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
  const exp = expansionTimes(c.r, c.me);
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
    // A basic since the base counts and food got more accurate (holdout lift 1.3 -> 1.0): the
    // simulation's food count keeps dead units, so long games overstate it.
    severity: BASIC,
    headline: "You sat in high upkeep on too few bases",
    evidence: [
      `You were above 80 food (high upkeep: you keep 40% of the gold your workers mine) for ${Math.round(seconds)} s, from ${mmss(first)}; at most ${top} food. Go that high only right before a fight.`,
      `Fights you were in from then on: ${fightsNear(c, first ?? 0, c.r.game.durationMs).map((f) => `${mmss(f.start)} ${fightLabel(f.category)}`).join(", ") || "none"}.`,
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
  // A hero that harassed instead of creeping and still kept pace isn't idle (fast-tech openings).
  const xp = proGap(c, "hero_xp_6m");
  if (xp && xp.worseThan < 0.5) return null;
  return {
    id: "first_creep",
    severity: BASIC,
    headline: "Your hero waited before creeping",
    evidence: [`Your first hero appeared at ${mmss(hero)} and first fought creeps at ${mmss(creep)}: ${Math.round((creep - hero) / 1000)} s later (pros: within about 10 s, almost always within 70 s).`],
  };
}

/** Caster trainings: caster builds invest in these instead of attack and armor upgrades. */
const CASTER_TRAINING = new Set(["Rhpt", "Rhst", "Redt", "Redc", "Rowd", "Rost", "Rowt", "Rune", "Ruba"]);
const firstCasterTraining = (p: PlayerRecord) => Math.min(...p.build.filter((b) => b.kind === "upgrade" && CASTER_TRAINING.has(b.code)).map((b) => b.ms));

/** Pros order their first attack upgrade by about 9:00 (90% by 12:00). None by 15:00 in a longer game is a gap. */
function upgradesFinding(c: Ctx): Finding | null {
  const m = c.me.metrics;
  // Caster training doesn't excuse it: counting it kept the lift (1.7) and dropped the rule from
  // 24% to 9% of pro losses.
  const first = Math.min(m.first_attack_upgrade_ms ?? Infinity, m.first_armor_upgrade_ms ?? Infinity);
  if (c.r.game.durationMs < 15 * 60_000 || first <= 15 * 60_000) return null;
  return {
    id: "upgrades",
    severity: BASIC + 0.05,
    headline: "No attack or armor upgrades for 15 minutes",
    evidence: [
      `Your first attack upgrade: ${mmss(m.first_attack_upgrade_ms)}; first armor upgrade: ${mmss(m.first_armor_upgrade_ms)} ${c.ref?.mp.metrics.first_attack_upgrade_ms ? ` (pros in this matchup: first attack upgrade by ${mmss(c.ref.mp.metrics.first_attack_upgrade_ms.p50)}, median of those who got one)` : ""}.`,
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
  const t = expansionTimes(c.r, c.opp).find((x) => x > 60_000);
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
  const bases = 1 + expansionTimes(c.r, c.me).length;
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
    evidence: [`Workers lost by ${c.r.game.durationMs < 12 * 60_000 ? `the end (${mmss(c.r.game.durationMs)})` : "12:00"}: ≈${lost} (pros: usually 0-4; deaths are inferred and tend to be undercounted).`],
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
  const expanded = expansionTimes(c.r, c.me).some((t) => t >= t50 - 60_000 && t <= until);
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
  // An upgrade (or caster training) ordered in the next 30 s counts: the food crossing and the
  // click are seconds apart.
  const upgraded = Math.min(m.first_attack_upgrade_ms ?? Infinity, m.first_armor_upgrade_ms ?? Infinity, firstCasterTraining(c.me)) <= over + 30_000;
  const expanded = expansionTimes(c.r, c.me).some((t) => t <= over);
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
  const exp = expansionTimes(c.r, c.me);
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

// ---- Army and habits: composition against the opponent's, items, production, scouting.

/** The fights the composition is judged at: your costliest fight against the opponent, else the end. */
function judgedAt(c: Ctx): number {
  const worst = fightLosses(c.r, c.me, c.opp)
    .filter((x) => x.f.playerIds.includes(c.opp.playerId) && x.f.category !== "creep-fight")
    .sort((a, b) => b.me - b.opp - (a.me - a.opp))[0];
  return worst && worst.me > worst.opp ? worst.f.start : c.r.game.durationMs;
}
const MIX_WINDOW_MS = 360_000;

/** Their army was largely air and little of yours could shoot up. */
function noAntiAirFinding(c: Ctx): Finding | null {
  const t = judgedAt(c);
  const theirs = armyMix(c.opp, t - MIX_WINDOW_MS, t);
  const mine = armyMix(c.me, t - MIX_WINDOW_MS, t);
  const air = theirs.filter((e) => e.unit.air);
  if (airShare(theirs) < 0.4 || mixValue(air) < 1200 || antiAirShare(mine) >= 0.25) return null;
  const answers = bestAgainst(c.me.race as RaceCode, air, canHitAir).filter((x) => x.vs >= 1).slice(0, 3);
  return {
    id: "no_anti_air",
    severity: 0.6,
    headline: "Their air army met little anti-air",
    evidence: [
      `Their units ordered ${mmss(t - MIX_WINDOW_MS)}–${mmss(t)}: ${describeMix(theirs, "armor")}; ${Math.round(airShare(theirs) * 100)}% of the value flies.`,
      `Yours: ${describeMix(mine, "attack") || "none"}; ${Math.round(antiAirShare(mine) * 100)}% of the value can attack air.`,
    ],
    advice: answers.length
      ? `When you see their first air units, add units that shoot up: ${answers.map((x) => `${x.name} (${Math.round(x.vs * 100)}% damage against their air)`).join(", ")}.`
      : "When you see their first air units, add units that can attack air.",
  };
}

/** Your army's attack types did poorly against their armor types, and your race had better options. */
function armyMismatchFinding(c: Ctx): Finding | null {
  const t = judgedAt(c);
  const theirs = armyMix(c.opp, t - MIX_WINDOW_MS, t);
  const mine = armyMix(c.me, t - MIX_WINDOW_MS, t);
  if (mixValue(mine) < 1500 || mixValue(theirs) < 1500) return null;
  const ours = mixVsMix(mine, theirs);
  const better = bestAgainst(c.me.race as RaceCode, theirs).filter((x) => x.vs >= ours + 0.4).slice(0, 3);
  if (ours > 0.8 || !better.length) return null;
  return {
    id: "army_mismatch",
    severity: 0.55,
    headline: "Your units' attacks were weak against their armor",
    evidence: [
      `Your units ordered ${mmss(t - MIX_WINDOW_MS)}–${mmss(t)}: ${describeMix(mine, "attack")}.`,
      `Theirs: ${describeMix(theirs, "armor")}.`,
      `On average your attacks did ${Math.round(ours * 100)}% damage against their armor (game damage table: e.g. piercing does 75% to medium armor, magic 200% to heavy).`,
    ],
    advice: `Against this army, ${better.map((x) => `${x.name} (${ATTACK_NAME[x.unit.attacks[0]?.type] ?? "?"} attack, ${Math.round(x.vs * 100)}%)`).join(", ")} do more damage; mix them in once you see their composition.`,
  };
}

/** Items that heal or save a hero: potions, healing scrolls and salves, Town Portal, staves. */
const SUSTAIN = new Set([...POTION_ITEMS, TOWN_PORTAL, "shea", "sreg", "hslv", "spre", "stel", "ssan", "rej1", "rej2", "rej3"]);

/**
 * You bought items (the no-items basic covers buying none) but nothing that heals, and no Town
 * Portal, before your first hero death.
 */
function noSustainFinding(c: Ctx): Finding | null {
  if (c.r.game.durationMs < 10 * 60_000 || !c.me.build.some((b) => b.kind === "item")) return null;
  // From 6:00: an early death usually comes before the first shop visit.
  const death = Math.min(...simHeroes(c, c.me).flatMap((h) => h.deaths.map((d) => d.diedAt).filter((t) => t >= 360_000)), Infinity);
  // Tested on pros: adding "or a fight lost by 800+" made it fire in 12% of their games, wins
  // and losses alike; a hero death is when it matters.
  const t = death;
  if (!Number.isFinite(t)) return null;
  const before = c.me.build.filter((b) => b.kind === "item" && b.ms <= t);
  if (before.some((b) => SUSTAIN.has(b.code))) return null;
  const theirs = c.opp.build.filter((b) => b.kind === "item" && b.ms <= t && SUSTAIN.has(b.code)).length;
  return {
    id: "no_sustain",
    severity: BASIC,
    headline: "No healing or Town Portal when your hero died",
    evidence: [
      `Your first hero death (≈${mmss(t)}) came with ${before.length ? `only ${before.map((b) => b.name).join(", ")} bought` : "no items bought yet"}; no potion, healing scroll or Town Portal. Opp had bought ${theirs} such items by then.`,
    ],
    advice: "Carry a Potion of Healing (or healing scroll/salve) on your main hero before every big fight, and a Town Portal to get out: they decide close fights and save heroes.",
  };
}

/** No unit reached the opponent's side of the map long after pros did. */
function noScoutFinding(c: Ctx): Finding | null {
  if (c.r.game.durationMs < 8 * 60_000) return null;
  const ms = c.me.metrics.first_scout_ms;
  const pro = c.ref?.mp.metrics.first_scout_ms;
  if (!pro || pro.values.length < 10) return null;
  const p90 = [...pro.values].sort((a, b) => a - b)[Math.floor(pro.values.length * 0.9)];
  // Unknown (null) is common in pro games too: the simulation doesn't always place units.
  if (ms === null || ms === undefined || ms <= Math.max(p90, 300_000)) return null;
  return {
    id: "no_scout",
    severity: BASIC,
    headline: "You scouted late",
    evidence: [`First unit of yours on the opponent's side of the map: ${mmss(ms)}; pros: median ${mmss(pro.p50)}.`],
    advice: "Scout their base around 2:00-3:00 (a worker, your hero on the way to a camp, or a cheap unit): their tech, towers and expansion tell you what is coming and what to build.",
  };
}

/**
 * Clearly ahead (army value 1.5x theirs and 600+ more, at least as many workers) at every check
 * for 4+ minutes, and you neither attacked them, expanded, nor made them lose 300+.
 */
function unusedLeadFinding(c: Ctx): Finding | null {
  const army = sampleBoth(c.r, c.me, c.opp, (s) => s.armyValue ?? 0);
  const workers = sampleBoth(c.r, c.me, c.opp, (s) => s.workers);
  const ahead = (i: number) => army[i].t > 240_000 && army[i].opp > 0 && army[i].me >= 1.5 * army[i].opp && army[i].me - army[i].opp >= 600 && (workers[i]?.me ?? 0) >= (workers[i]?.opp ?? 0);
  let best: { from: number; to: number; i: number; j: number } | null = null;
  for (let i = 0; i < army.length; i++) {
    if (!ahead(i)) continue;
    let j = i;
    while (j + 1 < army.length && ahead(j + 1)) j++;
    if (!best || army[j].t - army[i].t > best.to - best.from) best = { from: army[i].t, to: army[j].t, i, j };
    i = j;
  }
  if (!best || best.to - best.from < 240_000) return null;
  const { from, to } = best;
  // Used = something within the first 4 minutes of the lead (a late attack doesn't undo the wait).
  const attacked = fightLosses(c.r, c.me, c.opp).some((x) => x.f.start >= from - 60_000 && x.f.start <= from + 240_000 && x.f.category !== "creep-fight" && (x.f.initiatorId === c.me.playerId || x.opp >= 300));
  const expanded = expansionTimes(c.r, c.me).some((t) => t >= from - 60_000 && t <= from + 240_000);
  if (attacked || expanded) return null;
  const peak = army.slice(best.i, best.j + 1).reduce((m, x) => (x.me / Math.max(1, x.opp) > m.me / Math.max(1, m.opp) ? x : m));
  return {
    id: "unused_lead",
    severity: Math.min(0.85, 0.55 + (to - from) / 1_800_000),
    headline: "You were well ahead and didn't attack",
    evidence: [
      `From ${mmss(from)} to ${mmss(to)} your army value was at least 1.5x theirs (at ${mmss(peak.t)}: ${peak.me} vs ${peak.opp}) and you had at least as many workers (${workers[best.i]?.me} vs ${workers[best.i]?.opp} at ${mmss(from)}).`,
      `In that time you started no fight against them, didn't expand, and they lost under 300 in fights.`,
    ],
    advice: "When you are this far ahead, use it before they catch up: attack their expansion or creeping hero, or their base with your heroes leading, or take an expansion yourself. Waiting lets them tech to stronger units.",
  };
}

/** Standing bases at t (1 + expansions started 2 minutes earlier and not lost). */
const basesAt = (r: GameRecord, p: PlayerRecord, t: number) => {
  const sim = r.sim?.status === "ok" ? r.sim.players.find((x) => x.playerId === p.playerId)?.bases : undefined;
  if (!sim) return null;
  return 1 + sim.filter((b) => b.at + TOWN_HALL_BUILD_MS <= t && (b.lostAt === null || b.lostAt > t)).length;
};

/**
 * They had more standing bases than you for 4+ minutes. (Only before 20:00 at first; counting the
 * whole game kept the lift at 1.8 and caught 26% of pro losses instead of 21%.)
 */
function outExpandedFinding(c: Ctx): Finding | null {
  const times = sampleTimes(c.r.game.durationMs);
  const rows = times.map((t) => ({ t, me: basesAt(c.r, c.me, t), opp: basesAt(c.r, c.opp, t) }));
  if (rows.some((x) => x.me === null || x.opp === null)) return null;
  let run = 0;
  let from: number | null = null;
  let best: { from: number; to: number } | null = null;
  for (const x of rows) {
    if (x.opp! > x.me!) {
      from ??= x.t;
      run = x.t - from;
      if (run >= 240_000 && (!best || run > best.to - best.from)) best = { from, to: x.t };
    } else {
      from = null;
    }
  }
  if (!best) return null;
  const at = rows.find((x) => x.t === best!.to)!;
  return {
    id: "out_expanded",
    severity: 0.55,
    headline: "They had more bases than you",
    evidence: [
      `From ${mmss(best.from)} to ${mmss(best.to)} they had more bases standing than you (at ${mmss(best.to)}: ${at.opp} vs ${at.me}). Your expansions: ${expansionTimes(c.r, c.me).map((t) => mmss(t)).join(", ") || "none"}; theirs: ${expansionTimes(c.r, c.opp).map((t) => mmss(t)).join(", ") || "none"}.`,
    ],
    advice: "When they take an extra base, either take one yourself or attack theirs while it builds (about two minutes); letting them mine more for minutes decides long games.",
  };
}

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
