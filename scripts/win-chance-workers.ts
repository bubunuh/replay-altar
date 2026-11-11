// Research: how should the win-chance model count workers, so it stops leaning against Undead?
//
//   node scripts/win-chance-workers.ts <out-folder> [--game <game key of one of your games>]
//
// The model (scripts/win-chance.ts) compares the two players' worker counts and food used as they
// are. An Undead mines gold with five Acolytes while Ghouls cut the lumber, so a Human or an Orc
// always looks some ten workers ahead, and the food used counts those workers again. This script
// measures that per matchup and compares ways of counting, all else equal: the same seven
// differences, the same time curve and ridge as the shipped model, fitted on the same calibration
// games and scored on the same validation games. Writes workers.md and workers.json to the
// folder; reads the reference sets and writes nothing there.
//
// THE CANDIDATES, written down before any was fitted (2026-11-11). What the records hold per unit
// type: the simulation's `workers` is the count of the race's worker unit alone (Peasant, Peon,
// Acolyte, Wisp), `foodUsed` is everything; Ghouls appear only in the build order (when each was
// ordered), not as a count of those alive, and WC3V's own "ghouls on lumber" is every Ghoul ever
// made (a Ghoul starts as a lumber worker in WC3V and is never taken off), so the data cannot
// tell a Ghoul cutting lumber from one in the army.
//
// One fact narrows the field: the model is a weighted sum, so "the amount of units without the
// workers" (food − workers) next to the workers is the same model as food next to the workers,
// with the weights moved around. Only what is subtracted PER RACE changes anything.
//
//   A  Workers against the race's usual: workers − the average worker count of that race at that
//      minute among the pros (calibration games still going). Food used as it is. Ghouls are never
//      workers; they stay in the food as army.
//   B  A, and the food used with the race's usual WORKERS taken off as well (food − usual
//      workers of the race): the workers inside the amount of units no longer favour a race.
//      Ghouls as in A.
//   C  Workers by what they bring in, no averages: gold workers = workers up to 5 per mine;
//      lumber workers = the rest (Human, Orc, Night Elf) or, for Undead, the first 5 Ghouls
//      trained (build order); each weighted by the income model's rates (gold 1.801/s, lumber per
//      race). Amount of units = food − workers − (Undead) 2 food per lumber Ghoul. So an Undead's
//      first 5 Ghouls are workers, the rest army. The cap of 5 was fixed beforehand.
//   D  Both against the race's usual: workers − usual workers, food − usual FOOD of the race at
//      that minute. The usual Ghouls of an Undead (and any other race habit in the food) cancel
//      out; Ghouls are never workers.
//
// Extensions, looked at only if a matchup is still clearly off with the best of A–D:
//   X1 every kept difference against the race's usual (hero experience, expansions, resources
//      lost, heroes alive, upgrades too).
//   X2 a weight per race for workers and the amount of units, shrunk towards the shared one.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths, readRecord } from "@replay-altar/core";
import { mmss } from "@replay-altar/core/time";
import { BY_RACE, diffs, FEATURES, sideOf, START_MS, STEP_MS, usualAt, weightAt, winCurve, type Side, type Usual, type WinModel } from "@replay-altar/rules/winchance";
import {
  accuracyAt, bootstrapDiff, brierOf, CALIBRATION, calibrationSlope, costs, evenResults, finiteGames, fitModel, fold, FOLDS, loadGames, lossOf, matchupCalibration, momentsOf, predsOn, RESEARCH, usualOf,
  VALIDATION, validationMeta, type MatchupRow, type Moment, type Pred, type Spec,
} from "./win-chance-lib.ts";
import economy from "../packages/sim/src/economy-constants.json" with { type: "json" };

const args = process.argv.slice(2);
const gameAt = args.indexOf("--game");
const gameKey = gameAt < 0 ? null : args.splice(gameAt, 2)[1];
const outDir = args[0];
if (!outDir) throw new Error("usage: node scripts/win-chance-workers.ts <out-folder> [--game <game key>]");

/** The shipped model's differences, curve and ridge (data/winchance.json, 0.2.x). */
const SHIPPED: Spec = { keep: [2, 3, 4, 7, 8, 10, 12], basis: "curve", matchup: false, lambda: 0.1 };
const WORKERS = 2, FOOD = 8;

// ---- What a candidate needs to know about one side at one moment ------------------------------
const NOBODY = { series: [{ t: 0, goldSpent: 0, lumberSpent: 0, goldLost: 0, lumberLost: 0, foodUsed: 0, foodMax: 0, workers: 0, armyValue: 0 }], bases: [], t2: null, t3: null, levels: [], deaths: [], upgrades: [], weaponArmor: [], items: [], camps: [], race: "" } as unknown as Side;
const GHOUL_MS = costs.units.ugho?.buildMs ?? 18_000;
const X_WORKERS = 0, X_FOOD = 1, X_BASES = 2, X_GHOULS = 3, X_VALUES = 4;
/** workers, food, expansions standing, Ghouls trained so far, then the side's own value of each difference. */
const extra = (s: Side, t: number): number[] => {
  const d = diffs(s, NOBODY, t);
  const ghouls = s.p.build.filter((b) => b.kind === "unit" && b.code === "ugho" && b.ms + GHOUL_MS <= t).length;
  return [d[WORKERS] * 10, d[FOOD] * 10, d[4], ghouls, ...d];
};

/**
 * Averages of `x` per race and whole minute over these moments (each player once). `balanced`:
 * the middle between the average of that race's eventual winners and of its losers, so a race
 * that mostly lost in these games (the calibration set follows some players more than others) is
 * not measured against its losers.
 */
type Averages = Map<string, number[][]>;
function averages(ms: Moment[], balanced = false): Averages {
  const sums = new Map<string, { n: number; v: number[] }[][]>();
  for (const m of ms) {
    if (m.t % 60_000) continue;
    const minute = m.t / 60_000, race = m.races[0];
    const rows = sums.get(race) ?? sums.set(race, []).get(race)!;
    const pair = (rows[minute] ??= [0, 1].map(() => ({ n: 0, v: m.x![0].map(() => 0) })));
    const row = pair[balanced ? m.y : 0];
    row.n++;
    m.x![0].forEach((v, i) => (row.v[i] += v));
  }
  const out: Averages = new Map();
  for (const [race, rows] of sums) {
    const table: number[][] = [];
    for (let m = 1; m < rows.length && rows[m]; m++) {
      const [a, b] = rows[m];
      if (a.n + b.n < 30 || (balanced && (a.n < 10 || b.n < 10))) break;
      table[m] = a.v.map((v, i) => (balanced ? (v / a.n + b.v[i] / b.n) / 2 : v / a.n));
    }
    if (!table[1]) continue;
    table[0] = table[1];
    out.set(race, table);
  }
  return out;
}
const usualOfRace = (u: Averages, race: string, t: number, i: number) => usualAt(u.get(race)?.map((row) => row[i]), t);

// ---- The candidates --------------------------------------------------------------------------
type Candidate = { id: string; name: string; ghouls: string; balanced?: boolean; even?: boolean; change: (m: Moment, u: Averages) => number[] };
const againstUsual = (m: Moment, u: Averages, value: number, usual: number) =>
  m.x![0][value] - usualOfRace(u, m.races[0], m.t, usual) - (m.x![1][value] - usualOfRace(u, m.races[1], m.t, usual));
const set = (m: Moment, workers: number, food: number) => {
  const d = [...m.d];
  d[WORKERS] = workers / 10;
  d[FOOD] = food / 10;
  return d;
};
const LUMBER_GHOULS = 5, GHOUL_FOOD = 2;
const rates = economy.lumberPerWorkerSecond as Record<string, number>;
/** Workers by what they bring in, in gold workers; and the food that is not a worker. */
function byIncome(x: number[], race: string): [number, number] {
  const gold = Math.min(x[X_WORKERS], economy.workersPerMine * (1 + x[X_BASES]));
  const lumber = race === "U" ? Math.min(x[X_GHOULS], LUMBER_GHOULS) : x[X_WORKERS] - gold;
  const income = gold * economy.goldPerWorkerSecond + lumber * (rates[race] ?? rates.H);
  return [income / economy.goldPerWorkerSecond, x[X_FOOD] - x[X_WORKERS] - (race === "U" ? GHOUL_FOOD * lumber : 0)];
}
const CANDIDATES: Candidate[] = [
  { id: "today", name: "Today: workers and food used as counted", ghouls: "army, inside the food used", change: (m) => m.d },
  { id: "A", name: "A: workers against the race's usual", ghouls: "army, inside the food used", change: (m, u) => set(m, againstUsual(m, u, X_WORKERS, X_WORKERS), m.x![0][X_FOOD] - m.x![1][X_FOOD]) },
  { id: "B", name: "B: workers, and the workers inside the food, against the race's usual workers", ghouls: "army, inside the food used", change: (m, u) => set(m, againstUsual(m, u, X_WORKERS, X_WORKERS), againstUsual(m, u, X_FOOD, X_WORKERS)) },
  {
    id: "C",
    name: "C: workers by what they bring in (an Undead's first 5 Ghouls cut lumber)",
    ghouls: "the first 5 trained are lumber workers, the rest army",
    change: (m) => {
      const a = byIncome(m.x![0], m.races[0]), b = byIncome(m.x![1], m.races[1]);
      return set(m, a[0] - b[0], a[1] - b[1]);
    },
  },
  { id: "D", name: "D: workers and food used, each against the race's usual", ghouls: "army; the usual Ghouls of an Undead cancel out with the usual food", change: (m, u) => set(m, againstUsual(m, u, X_WORKERS, X_WORKERS), againstUsual(m, u, X_FOOD, X_FOOD)) },
];
/** X1: every kept difference against the race's usual. Fitted only when asked (see the header). */
const X1: Candidate = {
  id: "X1",
  name: "X1: every kept difference against the race's usual",
  ghouls: "as D",
  change: (m, u) => {
    const d = [...m.d];
    for (const f of SHIPPED.keep) d[f] = m.d[f] - (usualOfRace(u, m.races[0], m.t, X_VALUES + f) - usualOfRace(u, m.races[1], m.t, X_VALUES + f));
    return d;
  },
};
// Looked at after A–D were scored (see docs/WIN-CHANCE.md for why): X1, and the usual taken as the
// middle between a race's winners and losers, for A, D and X1.
const dOf = CANDIDATES.find((c) => c.id === "D")!, aOf = CANDIDATES.find((c) => c.id === "A")!;
if (process.env.WIN_CHANCE_EXTENSIONS === "1")
  CANDIDATES.push(
    X1,
    { ...aOf, id: "A2", name: "A2: A, the usual between the race's winners and losers", balanced: true },
    { ...dOf, id: "D2", name: "D2: D, the usual between the race's winners and losers", balanced: true },
    { ...X1, id: "X1b", name: "X1b: X1, the usual between the race's winners and losers", balanced: true },
    // The fit weighted so each race's wins weigh the same in each matchup (evenResults).
    { ...CANDIDATES[0], id: "today-even", name: "Today's counting, each race's wins weighing the same in the fit", even: true },
    { ...aOf, id: "A-even", name: "A, each race's wins weighing the same in the fit", even: true },
    { ...dOf, id: "D-even", name: "D, each race's wins weighing the same in the fit", even: true },
  );

// ---- Data ------------------------------------------------------------------------------------
const log = (s: string) => console.error(s);
const calGames = loadGames(CALIBRATION);
const valMeta = validationMeta();
const valGames = valMeta.size ? loadGames([VALIDATION], valMeta) : [];
const cal = finiteGames(calGames.flatMap((g) => momentsOf(g, { extra })));
const val = finiteGames(valGames.flatMap((g) => momentsOf(g, { extra })));
log(`calibration: ${new Set(cal.map((m) => m.game)).size} games; validation: ${new Set(val.map((m) => m.game)).size} games`);

const changed = (ms: Moment[], c: Candidate, u: Averages): Moment[] => ms.map((m) => ({ ...m, d: c.change(m, u) }));
const forFit = (ms: Moment[], c: Candidate) => (c.even ? evenResults(ms) : ms);
type Score = {
  id: string; name: string; ghouls: string;
  cvLoss: number; valLoss: number; valBrier: number; slope: number; at10: number; at20: number;
  diff: { diff: number; lo: number; hi: number } | null;
  matchups: { validation: MatchupRow[]; cv: MatchupRow[] };
  offMean: number; offMax: number;
  weights: number[];
};
const CROSS = ["HvO", "HvU", "HvN", "OvU", "OvN", "UvN"];
const offBy = (rows: MatchupRow[]) => rows.filter((r) => CROSS.includes(r.matchup)).map((r) => Math.abs(r.gap));
let todayVal: Pred[] | null = null;
const preds = new Map<string, { model: ReturnType<typeof fitModel>; usual: Averages }>();
const scores: Score[] = CANDIDATES.map((c) => {
  // Cross-validated on the calibration games; the race's usual comes from the fitting games only.
  const cv: Pred[] = [];
  for (let f = 0; f < FOLDS; f++) {
    const train = cal.filter((m) => fold(m.game) !== f), u = averages(train, c.balanced);
    cv.push(...predsOn(fitModel(forFit(changed(train, c, u), c), SHIPPED), changed(cal.filter((m) => fold(m.game) === f), c, u)));
  }
  const u = averages(cal, c.balanced);
  const model = fitModel(forFit(changed(cal, c, u), c), SHIPPED);
  preds.set(c.id, { model, usual: u });
  const v = predsOn(model, changed(val, c, u));
  if (c.id === "today") todayVal = v;
  const mv = matchupCalibration(v), off = offBy(mv);
  const d = c.id !== "today" && todayVal ? { diff: lossOf(v) - lossOf(todayVal), ...bootstrapDiff(v, todayVal) } : null;
  const s: Score = {
    id: c.id, name: c.name, ghouls: c.ghouls,
    cvLoss: lossOf(cv), valLoss: lossOf(v), valBrier: brierOf(v), slope: calibrationSlope(v), at10: accuracyAt(v, 10).acc, at20: accuracyAt(v, 20).acc,
    diff: d,
    matchups: { validation: mv, cv: matchupCalibration(cv) },
    offMean: off.reduce((a, b) => a + b, 0) / off.length, offMax: Math.max(...off),
    weights: model.w,
  };
  log(`${c.id}: cv ${s.cvLoss.toFixed(4)}, validation ${s.valLoss.toFixed(4)}, off by ${(s.offMean * 100).toFixed(1)} pts on average, ${(s.offMax * 100).toFixed(1)} at most`);
  return s;
});

// ---- The report ------------------------------------------------------------------------------
const lines: string[] = [];
const out = (s = "") => lines.push(s);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const pts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(0)}`;
out("# Workers by race: the candidates on today's data");
out();
out(`Fitted on ${new Set(cal.map((m) => m.game)).size} calibration games, scored on ${new Set(val.map((m) => m.game)).size} validation games. All with the shipped model's seven differences, curved time weights and ridge 0.1; only how workers and the amount of units are counted changes.`);
out();
out("| Counting | Log loss, calibration (cross-validated) | Log loss, validation | Against today (95% range) | Brier | Slope | Favourite won at 10:00 | at 20:00 | Matchups off by, average | at most |");
out("|---|---|---|---|---|---|---|---|---|---|");
for (const s of scores)
  out(`| ${s.name} | ${s.cvLoss.toFixed(4)} | ${s.valLoss.toFixed(4)} | ${s.diff ? `${s.diff.diff.toFixed(4)} (${s.diff.lo.toFixed(4)} to ${s.diff.hi.toFixed(4)})` : ""} | ${s.valBrier.toFixed(4)} | ${s.slope.toFixed(2)} | ${(s.at10 * 100).toFixed(1)}% | ${(s.at20 * 100).toFixed(1)}% | ${(s.offMean * 100).toFixed(1)} pts | ${(s.offMax * 100).toFixed(1)} pts |`);
out();
out("(Matchups off by: over the six matchups between different races at 5, 10, 15 and 20 minutes on the validation set, the distance between the average chance the model gave a race and how often it won.)");
for (const [set, title] of [["validation", "validation set"], ["cv", "calibration set, cross-validated"]] as const) {
  out();
  out(`## Each matchup's evaluation against its results, ${title}`);
  out();
  out("The gap in points between the average chance given to the first race and how often it won (± its 95% range), among games still going. Today's row also says what was said and what happened.");
  for (const minute of [5, 10, 15, 20]) {
    out();
    const first = scores[0].matchups[set].filter((r) => r.minute === minute && r.games >= 20);
    out(`At ${minute}:00:`);
    out();
    out(`| Counting | ${first.map((r) => `${r.matchup} (${r.games})`).join(" | ")} |`);
    out(`|---|${first.map(() => "---|").join("")}`);
    for (const s of scores) {
      out(`| ${s.id} | ${first.map((f) => {
        const r = s.matchups[set].find((x) => x.matchup === f.matchup && x.minute === minute)!;
        return s.id === "today" ? `${pct(r.said)} vs ${pct(r.won)}: ${pts(r.gap)} ±${(r.half * 100).toFixed(0)}` : `${pts(r.gap)} ±${(r.half * 100).toFixed(0)}`;
      }).join(" | ")} |`);
    }
  }
}

// Where a lean comes from: each difference's average push (in points of win chance around 50%)
// for the first race of a matchup, on the validation games.
out();
out("## Where the lean comes from");
out();
out("Each difference's average push for the first race of the matchup, in points of win chance around 50% (validation set). A race that is pushed up by a difference without winning more is being favoured by it.");
for (const id of ["today", "D", "D-even"]) {
  const c = CANDIDATES.find((x) => x.id === id), fitted = preds.get(id);
  if (!c || !fitted) continue;
  for (const minute of [10, 15]) {
    out();
    out(`${c.name}, at ${minute}:00:`);
    out();
    out(`| Matchup | ${SHIPPED.keep.map((f) => FEATURES[f].replace("food used", "amount of units")).join(" | ")} | All | Won |`);
    out(`|---|${SHIPPED.keep.map(() => "---|").join("")}---|---|`);
    for (const mu of CROSS) {
      const at = changed(val.filter((m) => m.t === minute * 60_000 && m.races[0] === mu[0] && m.races[1] === mu[2]), c, fitted.usual);
      const push = SHIPPED.keep.map((f, k) => at.reduce((s, m) => s + weightAt({ basis: SHIPPED.basis, weights: fitted.model.w }, k, m.t) * m.d[f], 0) / at.length);
      const points = (z: number) => pts(1 / (1 + Math.exp(-z)) - 0.5);
      out(`| ${mu} | ${push.map(points).join(" | ")} | ${points(push.reduce((a, b) => a + b, 0))} | ${pct(at.filter((m) => m.y).length / at.length)} |`);
    }
  }
}

// The race's usual, and a check that the rules' own tables (what the app would use) agree.
const u = averages(cal);
out();
out("## What is usual for each race (calibration set)");
out();
out("| Minute | " + ["H", "O", "U", "N"].map((r) => `${r} workers | ${r} food | ${r} Ghouls trained`).join(" | ").replace(/(H|O|N) Ghouls trained \| /g, "").replace(/ \| N Ghouls trained/, "") + " |");
out("|---|" + "---|".repeat(9));
for (const m of [2, 5, 10, 15, 20, 25]) {
  const cell = (r: string, i: number) => u.get(r)?.[m]?.[i]?.toFixed(1) ?? "–";
  out(`| ${m}:00 | ${cell("H", 0)} | ${cell("H", 1)} | ${cell("O", 0)} | ${cell("O", 1)} | ${cell("U", 0)} | ${cell("U", 1)} | ${cell("U", 3)} | ${cell("N", 0)} | ${cell("N", 1)} |`);
}
out();
out("How often each race won in each set (games between different races): " + [["calibration", cal], ["validation", val]].map(([name, ms]) => {
  const rows = (ms as Moment[]).filter((m) => m.t === START_MS && m.races[0] !== m.races[1]);
  return `${name}: ` + ["H", "O", "U", "N"].map((r) => { const mine = rows.filter((m) => m.races[0] === r); return `${r} ${pct(mine.filter((m) => m.y).length / mine.length)} of ${mine.length}`; }).join(", ");
}).join("; ") + ".");
const rulesUsual: Usual = usualOf(calGames);
const worst = Math.max(...["H", "O", "U", "N"].flatMap((r) => [5, 10, 15, 20].map((m) => Math.abs((rulesUsual.workers[r]?.[m] ?? NaN) - (u.get(r)?.[m]?.[0] ?? NaN)))));
out();
out(`(The tables the fit script writes into the model, from every calibration game with a simulation, differ from these by at most ${worst.toFixed(2)} workers at 5, 10, 15 and 20 minutes.)`);

// ---- One of your games, before and after ------------------------------------------------------
if (gameKey) {
  const r = readRecord(paths(), gameKey);
  const me = r?.players.find((x) => x.isMe), opp = r?.players.find((x) => x.playerId === r.classification.opponentId);
  const a = r && me ? sideOf(r, me, RESEARCH) : null, b = r && opp ? sideOf(r, opp, RESEARCH) : null;
  if (r && me && opp && a && b) {
    out();
    out(`## One game: ${me.race} against ${opp.race}, ${mmss(r.game.durationMs)}, ${me.result}`);
    out();
    out("Your chance at each minute under each way of counting, and both players' workers and food used as the simulation has them:");
    out();
    out(`| Time | ${scores.map((s) => s.id).join(" | ")} | Your workers | Their workers | Your food | Their food |`);
    out(`|---|${scores.map(() => "---|").join("")}---|---|---|---|`);
    const curve: Record<string, { t: number; p: number }[]> = {};
    for (let t = START_MS; t < r.game.durationMs; t += STEP_MS) {
      const xa = extra(a, t), xb = extra(b, t);
      const m: Moment = { game: r.gameKey, d: diffs(a, b, t), t, y: 0, w: 1, races: [a.race, b.race], first: true, x: [xa, xb] };
      const cells = CANDIDATES.map((c) => {
        const { model, usual } = preds.get(c.id)!;
        const p = predsOn(model, changed([m], c, usual))[0].p;
        (curve[c.id] ??= []).push({ t, p });
        return pct(p);
      });
      if (t % 60_000 === 0) out(`| ${mmss(t)} | ${cells.join(" | ")} | ${xa[X_WORKERS]} | ${xb[X_WORKERS]} | ${xa[X_FOOD]} | ${xb[X_FOOD]} |`);
    }
    (globalThis as { curve?: unknown }).curve = curve;
    // The same game through the app's own code, with D's weights as the fit script would write them.
    const d = scores.find((s) => s.id === "D");
    if (d) {
      const asShipped: WinModel = { keep: SHIPPED.keep.map((f) => BY_RACE[f] ?? f), basis: "curve", weights: d.weights, research: RESEARCH, usual: rulesUsual, about: { games: 0, patch: "", fittedAt: "", commit: "", cvLogLoss: 0, validationGames: 0, validationLogLoss: 0 } };
      const app = winCurve(r, asShipped, me, opp);
      const worstP = app ? Math.max(...app.points.map((p, i) => Math.abs(p.p - curve.D[i].p))) : NaN;
      out();
      out(`(The app's own code, given D's weights and the usual tables, draws the same curve to within ${(worstP * 100).toFixed(1)} points; the tables there come from every calibration game, here from the fitted ones.)`);
    }
  } else log(`--game ${gameKey}: not found, or no simulation`);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "workers.md"), lines.join("\n") + "\n");
writeFileSync(join(outDir, "workers.json"), JSON.stringify({ generatedAt: new Date().toISOString(), scores, usual: Object.fromEntries(u), curve: (globalThis as { curve?: unknown }).curve ?? null }, null, 1) + "\n");
