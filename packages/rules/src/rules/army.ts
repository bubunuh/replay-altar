// Army and habits: composition against the opponent's, items, production, scouting.
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import { POTION_ITEMS, TOWN_PORTAL, type RaceCode } from "@replay-altar/core/gamedata";
import { fightLosses, mmss, sampleBoth, sampleTimes } from "../series.ts";
import { ATTACK_NAME, airShare, antiAirShare, armyMix, bestAgainst, canHitAir, describeMix, mixValue, mixVsMix } from "../combat.ts";
import { type Ctx, type Finding, TOWN_HALL_BUILD_MS, expansionTimes, simHeroes, BASIC } from "./shared.ts";

/** The fights the composition is judged at: your costliest fight against the opponent, else the end. */
function judgedAt(c: Ctx): number {
  const worst = fightLosses(c.r, c.me, c.opp)
    .filter((x) => x.f.playerIds.includes(c.opp.playerId) && x.f.category !== "creep-fight")
    .sort((a, b) => b.me - b.opp - (a.me - a.opp))[0];
  return worst && worst.me > worst.opp ? worst.f.start : c.r.game.durationMs;
}
const MIX_WINDOW_MS = 360_000;

/** Their army was largely air and little of yours could shoot up. */
export function noAntiAirFinding(c: Ctx): Finding | null {
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
export function armyMismatchFinding(c: Ctx): Finding | null {
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
export function noSustainFinding(c: Ctx): Finding | null {
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
export function noScoutFinding(c: Ctx): Finding | null {
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
export function unusedLeadFinding(c: Ctx): Finding | null {
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
export function outExpandedFinding(c: Ctx): Finding | null {
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
