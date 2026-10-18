// Mines shared principles from the pro reference games: for every race, how pros' milestones
// (food and time at tier 2, heroes, expansion, upgrades, upkeep habits...) are distributed, whether
// they differ between wins and losses, and whether they hold across builds (openings) and
// matchups. Writes reference/<group>/principles.json (read by the rules) and docs/PRINCIPLES.md.
//
//   node scripts/mine-principles.ts
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, readRecord, referencePaths, RACE_NAMES, type GameRecord } from "@w3stats/core";
import { milestonesOf, subjectsOf, type Milestones } from "../packages/ai/src/milestones.ts";
import { keyEvents, matchBuilds, type KeyEvent } from "../packages/ai/src/builds.ts";
import { RACES as RACE_DATA, type RaceCode } from "@w3stats/core";

type Feature = { key: string; label: string; unit: "food" | "ms" | "count" | "share"; get: (m: Milestones) => number | null | undefined };

const food = (k: keyof Milestones["at"], label: string): Feature => ({ key: `${k}.food`, label: `${label} (food)`, unit: "food", get: (m) => m.at[k]?.food });
const time = (k: keyof Milestones["at"], label: string): Feature => ({ key: `${k}.ms`, label: `${label} (time)`, unit: "ms", get: (m) => m.at[k]?.ms });
const flag = (key: string, label: string, get: (m: Milestones) => boolean | null): Feature => ({ key, label, unit: "share", get: (m) => { const v = get(m); return v === null ? null : v ? 1 : 0; } });

export const FEATURES: Feature[] = [
  food("tier2", "Tier 2 started"), time("tier2", "Tier 2 started"),
  food("hero1_l3", "First hero level 3"), time("hero1_l3", "First hero level 3"),
  food("hero2", "Second hero"), time("hero2", "Second hero"),
  food("hero2_l3", "Second hero level 3"), time("hero2_l3", "Second hero level 3"),
  time("hero1_l5", "First hero level 5"),
  food("expansion", "First expansion"), time("expansion", "First expansion"),
  food("tier3", "Tier 3 started"), time("tier3", "Tier 3 started"),
  food("first_attack_upgrade", "First attack upgrade"), time("first_attack_upgrade", "First attack upgrade"),
  time("food50", "50 food reached"), time("food60", "60 food reached"), time("goal3360", "3-3-60 reached"),
  { key: "workers6", label: "Workers at 6:00", unit: "count", get: (m) => m.workers6 },
  { key: "workersMax", label: "Most workers", unit: "count", get: (m) => m.workersMax },
  { key: "share.at50", label: "Time at 46-50 food", unit: "share", get: (m) => m.timeShare?.at50 },
  { key: "share.low", label: "Time in low upkeep (51-80)", unit: "share", get: (m) => m.timeShare?.low },
  { key: "share.high", label: "Time in high upkeep (81+)", unit: "share", get: (m) => m.timeShare?.high },
  { key: "creep6", label: "Creep camps by 6:00", unit: "count", get: (m) => m.creepCamps6 },
  { key: "creep10", label: "Creep camps by 10:00", unit: "count", get: (m) => m.creepCamps10 },
  { key: "items", label: "Items bought", unit: "count", get: (m) => m.itemsBought },
  { key: "towers", label: "Tower orders", unit: "count", get: (m) => m.towerOrders },
  { key: "heroDeaths", label: "Hero deaths", unit: "count", get: (m) => m.heroDeaths },
  { key: "creepDelay", label: "Hero to first creep", unit: "ms", get: (m) => m.creepDelayMs },
  { key: "workersLost12", label: "Workers lost by 12:00", unit: "count", get: (m) => m.workersLost12 },
  { key: "towersPerBase", label: "Tower orders per base", unit: "count", get: (m) => m.towersPerBase },
  { key: "highUpkeepFewBases", label: "Seconds above 80 food on fewer than 2 expansions", unit: "count", get: (m) => m.highUpkeepFewBasesS },
  { key: "bankAvg", label: "Unspent gold, first 10 min (≈)", unit: "count", get: (m) => m.bankAvg },
  { key: "workers10", label: "Workers at 10:00", unit: "count", get: (m) => m.workers10 },
  flag("expanded", "Expanded at all", (m) => m.at.expansion !== null),
  flag("hero2.any", "Had a second hero (games 10+ min)", (m) => (m.durationMs >= 600_000 ? m.at.hero2 !== null : null)),
  flag("tier3.any", "Reached tier 3 (games 15+ min)", (m) => (m.durationMs >= 900_000 ? m.at.tier3 !== null : null)),
  flag("spikeUsed", "Used the 50-food spike within 4 min", (m) => m.spikeUsed),
];

type Stat = { n: number; p10: number; p25: number; p50: number; p75: number; p90: number; mean: number };
const quant = (v: number[], p: number) => {
  const s = [...v].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i));
};
const stat = (v: number[]): Stat | null => (v.length ? { n: v.length, p10: quant(v, 0.1), p25: quant(v, 0.25), p50: quant(v, 0.5), p75: quant(v, 0.75), p90: quant(v, 0.9), mean: v.reduce((a, b) => a + b, 0) / v.length } : null);

/** The build a player ran, coarse: posture plus the opening's signature labels. */
export const buildKey = (m: Milestones) => {
  const sig = m.opening.map((l) => l.replace(/ \(.*$/, "").replace(/: .*$/, "")).filter((l) => !/^fast altar/.test(l));
  return sig.length ? sig.sort().join(" + ") : "standard";
};

const fmt = (unit: Feature["unit"], v: number) =>
  unit === "ms" ? `${Math.floor(v / 60000)}:${String(Math.round(v / 1000) % 60).padStart(2, "0")}` : unit === "share" ? `${Math.round(v * 100)}%` : unit === "food" ? `${Math.round(v)}` : (Math.round(v * 10) / 10).toString();

const MIN_GROUP = 8;
const config = loadConfig();
// --sample even|odd: only games whose key ends in an even/odd hex digit (for scoring rules on
// games that did not set their thresholds); --out <dir>: write principles there instead.
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const sample = arg("--sample");
const outDir = arg("--out");
export const inSample = (gameKey: string, which: string | null) => which === null || (parseInt(gameKey.at(-1)!, 16) % 2 === 0) === (which === "even");
const md: string[] = [
  "# Shared principles in pro games",
  "",
  "Generated by `node scripts/mine-principles.ts` from the pro reference games (warcraft3.info tournament players, plus older W3Champions 2400+ ladder games), both players of the group's race in every game, current patch only. Food = food in use when the milestone happened. **Across builds** compares the medians of the different openings with each other: a small spread (relative to the normal middle-50% range) means pros do it the same way whatever they build. **Wins vs losses** shows the median in wins and in losses; **win rate by quarter** is the share of games won by pros in the lowest quarter of that milestone (e.g. the earliest 25% of tier 2 timings) and in the highest quarter.",
  "",
];

for (const group of config.reference.groups) {
  const rp = referencePaths(group.id);
  let files: string[];
  try {
    files = readdirSync(rp.games);
  } catch {
    continue;
  }
  const all: Milestones[] = [];
  // Library builds as pros play them: matched step food counts, per build.
  const buildStats = new Map<string, { name: string; n: number; wins: number; scores: number[]; steps: Map<string, { label: string; guideFood: number; foods: number[]; seen: number }> }>();
  // Plans: the order of heroes, tier upgrades and expansions, with the food at each.
  const plans = new Map<string, { n: number; wins: number; foods: number[][] }>();
  for (const f of files) {
    const r = readRecord(rp, f.replace(/\.json$/, "")) as GameRecord | null;
    if (!r || r.sim?.status !== "ok" || r.game.durationMs < 300_000 || !inSample(r.gameKey, sample)) continue;
    for (const p of subjectsOf(r, group.race)) {
      const m = milestonesOf(r, p.playerId);
      if (!m) continue;
      all.push(m);
      const [best] = matchBuilds(r, p);
      if (best) {
        const b = buildStats.get(best.build.id) ?? { name: best.build.name, n: 0, wins: 0, scores: [] as number[], steps: new Map() };
        b.n++;
        if (m.win) b.wins++;
        b.scores.push(best.score);
        best.steps.forEach(({ step, event }, i) => {
          const key = `${i}:${step.action}:${step.code}`;
          const st = b.steps.get(key) ?? { label: `${step.action} ${step.name}`, guideFood: step.food, foods: [], seen: 0 };
          if (event) {
            st.foods.push(event.food);
            st.seen++;
          }
          b.steps.set(key, st);
        });
        buildStats.set(best.build.id, b);
      }
      const R = RACE_DATA[group.race as RaceCode];
      const plan = keyEvents(r, p, 15 * 60_000).filter((e: KeyEvent) => e.action === "hero" || e.action === "tech" || e.action === "expand").slice(0, 6);
      const key = plan.map((e) => (e.action === "expand" ? "expand" : e.action === "hero" && /^N/.test(e.code) ? "tavern hero" : e.name)).join(" > ");
      if (key && R) {
        const pl = plans.get(key) ?? { n: 0, wins: 0, foods: [] as number[][] };
        pl.n++;
        if (m.win) pl.wins++;
        pl.foods.push(plan.map((e) => e.food));
        plans.set(key, pl);
      }
    }
  }
  if (all.length < 20) continue;
  const byBuild = new Map<string, Milestones[]>();
  for (const m of all) byBuild.set(buildKey(m), [...(byBuild.get(buildKey(m)) ?? []), m]);
  const builds = [...byBuild.entries()].filter(([, v]) => v.length >= MIN_GROUP).sort((a, b) => b[1].length - a[1].length);
  const byMatchup = new Map<string, Milestones[]>();
  for (const m of all) byMatchup.set(m.opponentRace, [...(byMatchup.get(m.opponentRace) ?? []), m]);

  const features: Record<string, unknown> = {};
  const rows: string[] = [];
  for (const f of FEATURES) {
    const vals = (set: Milestones[]) => set.map(f.get).filter((x): x is number => x !== null && x !== undefined && Number.isFinite(x));
    const overall = stat(vals(all));
    if (!overall || overall.n < MIN_GROUP) continue;
    const wins = stat(vals(all.filter((m) => m.win === true)));
    const losses = stat(vals(all.filter((m) => m.win === false)));
    const buildMedians = builds.map(([k, v]) => ({ build: k, ...(stat(vals(v)) ?? { n: 0, p50: NaN }) })).filter((x) => x.n >= MIN_GROUP);
    const iqr = overall.p75 - overall.p25 || (f.unit === "share" ? 0.1 : 1);
    const spread = buildMedians.length >= 2 ? (Math.max(...buildMedians.map((x) => x.p50)) - Math.min(...buildMedians.map((x) => x.p50))) / iqr : null;
    const statOf = (s: Stat | null) => s && { n: s.n, p10: s.p10, p25: s.p25, p50: s.p50, p75: s.p75, p90: s.p90, mean: s.mean };
    // Win rate in the lowest and highest quarter of the feature: does earlier/more go with winning?
    const withWin = all.map((m) => ({ v: f.get(m), win: m.win })).filter((x): x is { v: number; win: boolean } => x.v !== null && x.v !== undefined && Number.isFinite(x.v) && x.win !== null);
    const rate = (xs: { win: boolean }[]) => (xs.length >= MIN_GROUP ? xs.filter((x) => x.win).length / xs.length : null);
    const quarters = f.unit === "share" && (f.key === "expanded" || f.key === "spikeUsed" || f.key.endsWith(".any")) ? null : { low: rate(withWin.filter((x) => x.v <= overall.p25)), high: rate(withWin.filter((x) => x.v >= overall.p75)) };
    features[f.key] = {
      label: f.label,
      unit: f.unit,
      all: statOf(overall),
      wins: statOf(wins),
      losses: statOf(losses),
      byBuild: Object.fromEntries(buildMedians.map((x) => [x.build, { n: x.n, p50: x.p50 }])),
      byMatchup: Object.fromEntries([...byMatchup.entries()].map(([k, v]) => [k, statOf(stat(vals(v)))]).filter(([, s]) => s && (s as Stat).n >= MIN_GROUP)),
      acrossBuilds: spread,
      winRateByQuarter: quarters,
    };
    const v = (s: Stat | null, unit = f.unit) => (s ? (f.unit === "share" && f.key.includes(".any") || f.key === "expanded" || f.key === "spikeUsed" ? `${Math.round(s.mean * 100)}%` : fmt(unit, s.p50)) : "—");
    const rateLike = f.key === "expanded" || f.key === "spikeUsed" || f.key.endsWith(".any");
    const pctOrDash = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
    rows.push(
      `| ${f.label} | ${rateLike ? `${Math.round(overall.mean * 100)}%` : `${fmt(f.unit, overall.p50)} (${fmt(f.unit, overall.p25)}–${fmt(f.unit, overall.p75)})`} | ${overall.n} | ${v(wins)} / ${v(losses)} | ${quarters ? `${pctOrDash(quarters.low)} / ${pctOrDash(quarters.high)}` : "—"} | ${spread === null ? "—" : spread < 0.5 ? `same (${spread.toFixed(1)})` : spread < 1 ? `similar (${spread.toFixed(1)})` : `depends (${spread.toFixed(1)})`} |`,
    );
  }
  const med = (v: number[]) => (v.length ? quant(v, 0.5) : null);
  const library = [...buildStats.entries()]
    .filter(([, b]) => b.n >= 3)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([id, b]) => ({
      id,
      name: b.name,
      players: b.n,
      winRate: b.wins / b.n,
      matchScore: med(b.scores),
      steps: [...b.steps.values()].map((st) => ({ step: st.label, guideFood: st.guideFood, proFood: med(st.foods), share: st.seen / b.n })),
    }));
  const planList = [...plans.entries()]
    .filter(([, p]) => p.n >= 4)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([plan, p]) => ({ plan, players: p.n, winRate: p.wins / p.n, food: plan.split(" > ").map((_, i) => med(p.foods.map((f) => f[i]).filter((x) => x !== undefined))) }));
  writeFileSync(
    join(outDir ?? rp.root, outDir ? `principles-${group.id}.json` : "principles.json"),
    JSON.stringify({ race: group.race, players: all.length, openings: builds.map(([k, v]) => ({ build: k, n: v.length, winRate: v.filter((m) => m.win).length / v.length })), features, library, plans: planList, at: new Date().toISOString() }, null, 1) + "\n",
  );
  const wins = all.filter((m) => m.win).length;
  md.push(
    `## ${RACE_NAMES[group.race] ?? group.race} (${all.length} player-games, ${wins} wins)`,
    "",
    `Builds with ${MIN_GROUP}+ games: ${builds.map(([k, v]) => `${k} (${v.length}, ${Math.round((v.filter((m) => m.win).length / v.length) * 100)}% won)`).join("; ") || "none yet"}.`,
    "",
    "| Milestone | Median (middle 50%) | n | Median in wins / losses | Win rate: lowest / highest quarter | Across builds |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    "**Library builds as pros play them** (each pro matched to the closest guide build; the food at each step is the pros' median when they did it):",
    "",
    ...library.slice(0, 8).flatMap((b) => [
      `- **${b.name}**: ${b.players} pros, ${Math.round(b.winRate * 100)}% won. ${b.steps
        .filter((st) => st.share >= 0.5 && st.proFood !== null)
        .map((st) => `${st.step.replace(/^(build|train|hero|tech|expand|research|item) /, "")} ${Math.round(st.proFood!)}${st.proFood !== st.guideFood ? ` (guide ${st.guideFood})` : ""}`)
        .join(", ")}`,
    ]),
    "",
    "**Plans** (order of heroes, tier upgrades and expansions; food at each step, median):",
    "",
    ...planList.slice(0, 10).map((p) => `- ${p.plan.split(" > ").map((x, i) => `${x} ${p.food[i] === null ? "" : Math.round(p.food[i]!)}`).join(" → ")}: ${p.players} pros, ${Math.round(p.winRate * 100)}% won`),
    "",
  );
  console.log(`${group.id}: ${all.length} player-games, ${builds.length} builds with ${MIN_GROUP}+ games`);
}
if (!outDir) writeFileSync(join(import.meta.dirname, "../docs/PRINCIPLES.md"), md.join("\n") + "\n");
console.log("wrote docs/PRINCIPLES.md");
