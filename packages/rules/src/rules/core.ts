// The main findings: the openings, economy, heroes, fights, supply and bases that decide games
// between players of any level (they rank above the basics and the army rules).
import { at, fightLabel, fightLosses, mmss, sampleBoth, seriesOf, STEP_MS } from "../series.ts";
import { type Ctx, type Finding, expansionTimes, heroLevelSum, heroLevels, num, proGap, proQ, simHeroes, vsPros, workerTarget, BASIC, fightsNear } from "./shared.ts";

/** Opponent had no army units for at least two samples (4 minutes) while you had one. */
export function windowFinding(c: Ctx, mine: boolean): Finding | null {
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

/** Below the worker target (5 per gold mine + lumber crew) at 6:00 or 10:00, usually from an idle town hall. */
export function economyFinding(c: Ctx): Finding | null {
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

export function heroFinding(c: Ctx): Finding | null {
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

export function fightFinding(c: Ctx): Finding | null {
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

export function supplyFinding(c: Ctx): Finding | null {
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

export function mechanicsFinding(c: Ctx): Finding | null {
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


/** Official basics: keep heroes alive "at all costs"; a Town Portal is the way out. */
export function heroDeathsFinding(c: Ctx): Finding | null {
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
export function noHeroesFinding(c: Ctx): Finding | null {
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

/**
 * High upkeep (above 80 food: you keep 40% of mined gold). Official page: avoid it unless you have
 * 2-3 expansions. Grubby: only go there "if you intend to use it to fight very soon". Counted
 * with fewer than 2 expansions (also requiring "no fight within 90 s" almost never fired: the
 * simulation sees some fight nearly all the time); the fights are given as evidence instead.
 */
export function upkeepFinding(c: Ctx): Finding | null {
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
export function expansionFinding(c: Ctx): Finding | null {
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
