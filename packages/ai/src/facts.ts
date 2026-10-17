// The fact sheet a local language model gets for one game. Everything that can be computed is
// computed here (times, counts, comparisons, the app's verdicts), so the model only has to read
// and explain; small models are good at that and bad at arithmetic and Warcraft III trivia.
import type { GameRecord, PlayerRecord } from "@w3stats/core/ui";
import { RACE_NAMES, RACES, researchLevels, TIER_NAMES, upgradeMaxLevel, type RaceCode } from "@w3stats/core/gamedata";
import { CORE_METRICS, MECHANICS_METRICS, METRICS, per10Minutes, type MetricDef } from "@w3stats/core/metrics";
import { nameOf } from "@w3stats/core/names";
import { assess, TIER_LABEL, TYPICAL_LABEL } from "@w3stats/reference/compare";
import type { MatchupProfile } from "@w3stats/reference/types";
import { at, fightLosses, leads, levelSum, mmss, sampleBoth, seriesOf, STEP_MS, type Sampled } from "./series.ts";

export type FactsRef = { label: string; key: string; mp: MatchupProfile };

/** Whole-game details worth a line besides Core and Mechanics. */
const DETAIL_KEYS = [
  "hero_xp_total",
  "resources_lost_total",
  "resources_killed_total",
  "largest_army",
  "towers_total",
  "items_bought",
  "potions_bought",
  "tp_bought",
  "hall_idle_6m_s",
  "first_attack_upgrade_ms",
  "first_armor_upgrade_ms",
];
const MAX_FIGHTS = 25;

/** A metric value as the app shows it; ≈ for estimates unless the value is official. */
export function metricValue(def: MetricDef, v: number | null | undefined, official = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const approx = def.source === "estimate" && !official ? "≈" : "";
  switch (def.unit) {
    case "ms":
      return approx + mmss(v);
    case "ratio":
      return `${approx}${Math.round(v * 100)}%`;
    case "apm":
    case "per_min":
      return approx + String(Math.round(v));
    default:
      return approx + (Number.isInteger(v) ? String(v) : v.toFixed(1));
  }
}

/** "Rifleman ×25 (4:11–23:38)" for repeated orders, "Knight 13:56" for single ones. */
function grouped(events: { ms: number; name: string }[]) {
  const by = new Map<string, number[]>();
  for (const e of events) by.set(e.name, [...(by.get(e.name) ?? []), e.ms]);
  return [...by.entries()].map(([name, t]) => (t.length === 1 ? `${name} ${mmss(t[0])}` : `${name} ×${t.length} (${mmss(t[0])}–${mmss(t.at(-1))})`)).join(", ");
}

function buildLines(p: PlayerRecord): string[] {
  const race = RACES[p.race as RaceCode];
  const b = p.build;
  const isTower = (c: string) => race?.towers.includes(c);
  const isHall = (c: string) => race?.townHalls.includes(c);
  const tierCodes = race ? [race.tier2, race.tier3] : [];
  const [t2, t3] = TIER_NAMES[p.race as RaceCode] ?? ["Tier 2", "Tier 3"];
  const firstOrder = (code: string) => b.find((x) => x.code === code)?.ms ?? null;
  const lines = [
    `- Tech: ${t2} ${mmss(race ? firstOrder(race.tier2) : null)}, ${t3} ${mmss(race ? firstOrder(race.tier3) : null)}`,
    `- Expansions: ${b.filter((x) => x.kind === "building" && isHall(x.code)).map((x) => mmss(x.ms)).join(", ") || "none"}`,
    `- Buildings: ${grouped(b.filter((x) => x.kind === "building" && !isTower(x.code) && !isHall(x.code) && x.code !== race?.supply && !tierCodes.includes(x.code))) || "none"}`,
    `- Supply buildings: ${b.filter((x) => x.code === race?.supply).length}`,
    `- Towers (build and upgrade orders): ${grouped(b.filter((x) => isTower(x.code))) || "none"}`,
    `- Units: ${grouped(b.filter((x) => x.kind === "unit")) || "none"}`,
    `- Research: ${
      researchLevels(b)
        .map((r) => `${nameOf(r.code, "upgrades")}${upgradeMaxLevel(r.code) > 1 ? ` L${r.level}` : ""} ${mmss(r.ms)}`)
        .join(", ") || "none"
    }`,
    `- Items bought: ${grouped(b.filter((x) => x.kind === "item")) || "none"}`,
  ];
  return lines;
}

function heroLines(r: GameRecord, p: PlayerRecord, who: string): string[] {
  const sim = r.sim?.status === "ok" ? r.sim.players.find((x) => x.playerId === p.playerId)?.heroes : undefined;
  const heroes = sim ?? p.heroes.map((h) => ({ name: h.name, appearAt: h.levelUps[0] ?? null, levelUps: h.levelUps, deaths: [] }));
  if (!heroes.length) return [`- ${who}: no heroes`];
  return heroes.map((h) => {
    const ups = h.levelUps.slice(1).map((t, i) => `${i + 2} at ${mmss(t)}`);
    const deaths = h.deaths.map((d) => `died ≈${mmss(d.diedAt)}${d.revivedAt === null ? " (not revived)" : d.revivedAt > r.game.durationMs ? " (revive unfinished at the end)" : `, back ${mmss(d.revivedAt)}`}`);
    return `- ${who} ${h.name}: appeared ${mmss(h.appearAt)}; level ${ups.length ? ups.join(", ") : "1 only"}; final level ${Math.max(1, h.levelUps.length)}${deaths.length ? `; ${deaths.join("; ")}` : "; never died"}`;
  });
}

function overTime(r: GameRecord, me: PlayerRecord, opp: PlayerRecord): string[] {
  if (r.sim?.status !== "ok") return ["(not simulated: no economy or army data)"];
  const sm = seriesOf(r, me);
  const so = seriesOf(r, opp);
  const rows = ["| time | workers you/opp | army food you/opp | ≈army value you/opp | hero levels (sum) you/opp | supply used/cap you | supply used/cap opp |", "|---|---|---|---|---|---|---|"];
  for (let t = STEP_MS; t < r.game.durationMs + STEP_MS; t += STEP_MS) {
    const tt = Math.min(t, r.game.durationMs);
    const a = at(sm, tt);
    const b = at(so, tt);
    if (!a || !b) continue;
    rows.push(
      `| ${mmss(tt)} | ${a.workers}/${b.workers} | ${a.armyFood ?? "—"}/${b.armyFood ?? "—"} | ${a.armyValue ?? "—"}/${b.armyValue ?? "—"} | ${levelSum(me, tt)}/${levelSum(opp, tt)} | ${a.foodUsed}/${Math.min(100, a.foodMax)} | ${b.foodUsed}/${Math.min(100, b.foodMax)} |`,
    );
    if (tt === r.game.durationMs) break;
  }
  return rows;
}

function trendLines(r: GameRecord, me: PlayerRecord, opp: PlayerRecord): string[] {
  if (r.sim?.status !== "ok") return [];
  const army = sampleBoth(r, me, opp, (s) => s.armyValue ?? 0);
  const biggest = [...army].sort((a, b) => Math.abs(b.me - b.opp) - Math.abs(a.me - a.opp))[0];
  const lines = [
    `- Army value: ${leads(army)}. Biggest gap: ${biggest ? `${biggest.me} vs ${biggest.opp} at ${mmss(biggest.t)}` : "—"}.`,
    `- Hero levels (sum): ${leads(army.map(({ t }) => ({ t, me: levelSum(me, t), opp: levelSum(opp, t) })))}.`,
    `- Workers: ${leads(sampleBoth(r, me, opp, (s) => s.workers))}.`,
  ];
  // Stretches where one side had no army units at all (only heroes and towers).
  for (const [who, pick] of [["You", (x: Sampled) => x.me], ["Opp", (x: Sampled) => x.opp]] as const) {
    const none = army.filter((x) => pick(x) === 0 && x.t > STEP_MS);
    if (none.length) lines.push(`- ${who} had no army units (army value 0) at ${none.map((x) => mmss(x.t)).join(", ")}.`);
  }
  const losses = fightLosses(r, me, opp);
  for (const [who, side] of [["You", "me"], ["Opp", "opp"]] as const) {
    const l = losses.filter((x) => x[side] > 0);
    const top = [...l].sort((a, b) => b[side] - a[side]).slice(0, 3).map((x) => `${mmss(x.f.start)} ≈${x[side]}`);
    lines.push(`- ${who} lost ≈${l.reduce((n, x) => n + x[side], 0)} in fights${top.length ? `; biggest: ${top.join(", ")}` : ""}.`);
  }
  return lines;
}

function fightLines(r: GameRecord, me: PlayerRecord, opp: PlayerRecord): string[] {
  if (r.sim?.status !== "ok" || !r.sim.fights) return ["(not simulated)"];
  const who = (id: number | null) => (id === me.playerId ? "you" : id === opp.playerId ? "opp" : "?");
  const rows = fightLosses(r, me, opp).map(({ f, me: mine, opp: theirs }) => {
    const tags = [f.initiatorId !== null ? `started by ${who(f.initiatorId)}` : null, f.involvesHero ? "heroes" : null, f.involvesAir ? "air units" : null].filter(Boolean).join(", ");
    return { f, weight: mine + theirs + (f.category === "pitched-battle" ? 1_000 : 0), line: `- ${mmss(f.start)}–${mmss(f.end)} ${f.category.replace(/-/g, " ")}${tags ? ` (${tags})` : ""}: you lost ≈${mine}, opp lost ≈${theirs}` };
  });
  const kept = rows.length > MAX_FIGHTS ? [...rows].sort((a, b) => b.weight - a.weight).slice(0, MAX_FIGHTS).sort((a, b) => a.f.start - b.f.start) : rows;
  return kept.length ? kept.map((x) => x.line) : ["(none detected)"];
}

function verdictLines(r: GameRecord, me: PlayerRecord, opp: PlayerRecord, ref: FactsRef | null, keys: string[]): string[] {
  const defs = keys.map((k) => METRICS.find((m) => m.key === k)).filter((m): m is MetricDef => !!m);
  return defs.flatMap((m) => {
    const mine = me.metrics[m.key];
    const theirs = opp.metrics[m.key];
    if ((mine === null || mine === undefined) && (theirs === null || theirs === undefined)) return [];
    const official = r.metricSources?.[m.key] === "official";
    const a = ref ? assess(m, ref.mp, { value: mine, per10: mine === null || mine === undefined ? null : per10Minutes(mine, r.game.durationMs) }, theirs) : null;
    const label = m.raceLabels?.[me.race as RaceCode] ?? m.label;
    const pro = a?.proMedian !== null && a?.proMedian !== undefined ? ` · pros median ${metricValue(m, a.proMedian, true)}${a.per10 ? " per 10 min" : ""}` : "";
    const verdict = a?.tier ? ` → ${(a.typicality ? TYPICAL_LABEL : TIER_LABEL)[a.tier]} (${a.text})` : a && a.text !== "—" ? ` → ${a.text}` : "";
    return [`- [${m.key}] ${label}: you ${metricValue(m, mine, official)} · opp ${metricValue(m, theirs, official)}${pro}${verdict}`];
  });
}

/** Markdown fact sheet for one game, from your side. */
export function gameFacts(r: GameRecord, opts: { result: string; ref: FactsRef | null }): string {
  const me = r.players.find((p) => p.isMe);
  const opp = r.players.find((p) => p.playerId === r.classification.opponentId);
  if (!me || !opp) throw new Error("not a 1v1 game of yours");
  const name = (p: PlayerRecord) => p.name.replace(/#\d+$/, "");
  const ended = r.result.method?.startsWith("leave") ? ` Ended by a player leaving (${r.result.method}).` : "";
  return [
    `# Game facts`,
    `Result: you ${opts.result === "win" ? "WON" : opts.result === "loss" ? "LOST" : opts.result}. You: ${name(me)} (${RACE_NAMES[me.race]}). Opponent ("opp"): ${name(opp)} (${RACE_NAMES[opp.race]}). Map: ${r.game.map.file.replace(/^.*[\\/]/, "").replace(/\.w3x$/i, "")}. Length ${mmss(r.game.durationMs)}. Source: ${r.classification.source}.${ended}`,
    `Times are game time (m:ss). Build times are when the order was given (cancelled orders included). ≈ marks estimates; hero death times are approximate. Army value = resources in living army units, heroes excluded.`,
    ``,
    `## Heroes`,
    ...heroLines(r, me, "you"),
    ...heroLines(r, opp, "opp"),
    ``,
    `## Your build`,
    ...buildLines(me),
    ``,
    `## Opponent build`,
    ...buildLines(opp),
    ``,
    `## Trends (computed from the table below)`,
    ...trendLines(r, me, opp),
    ``,
    `## Over time (simulated from the replay)`,
    ...overTime(r, me, opp),
    ``,
    `## Fights (detected by the simulation; losses in resources are estimates)`,
    ...fightLines(r, me, opp),
    ``,
    `## Key numbers compared with ${ref(opts.ref)}`,
    `Verdicts: "Pro level" = at or above the pro median; "Above opponents" = below pros but at least as good as this opponent; "Below opponents" = worse than both. For timings with no better direction: "Like pros" = inside the pros' middle 50%, "Unusual", "Far from pros".`,
    `### Core (decides games)`,
    ...verdictLines(r, me, opp, opts.ref, CORE_METRICS),
    `### Mechanics`,
    ...verdictLines(r, me, opp, opts.ref, MECHANICS_METRICS),
    `### Details`,
    ...verdictLines(r, me, opp, opts.ref, DETAIL_KEYS),
  ].join("\n");
}

const ref = (r: FactsRef | null) => (r ? `${r.label} (${r.key === "all" ? "all matchups" : r.key}, ${r.mp.n} games) and your opponent` : "your opponent (no pro games for your race yet)");
