// Research: a win-chance model from the pro games. At every moment of a game, how often does a side
// with these leads go on to win? Fitted on the curated pro games (the calibration set), compared by
// cross-validation on them, then scored on the validation set (reference/validation, from
// scripts/download-validation.ts: tournament games 2022 to today, never used for fitting).
// Writes docs/WIN-CHANCE.md (pro games only); your games go to the file given as an argument,
// never into the repository.
//
//   node scripts/win-chance.ts [your-games.md] [--workers by-race] [--out <folder>]
//
// --workers by-race: workers and the amount of units are counted against what is usual for the
// player's race at that minute (packages/rules/src/winchance.ts, Usual), not as they are.
// --workers by-race-workers: only the workers are; the amount of units as counted.
// --workers by-race-plus: workers, the amount of units, hero experience and resources lost (the
// model shipped from 0.2.6, candidate D+ of scripts/win-chance-workers.ts). Without the
// option, the counting of the model the app shipped until 0.2.x. --out: write everything
// (WIN-CHANCE.md, win-chance/, winchance.json) into that folder instead of docs/ and data/, to
// try a fit without replacing the model the app ships. The reference sets are only read.
// --same-differences: no search for which differences to keep; the ones of the model in
// data/winchance.json, counted as --workers says. The search scores models on the calibration
// set, where a race can lose most of its games (it follows some players more than others), so it
// rewards whatever tells the races apart; counted by race, it dropped the workers and took army
// value, resources spent and items bought in their place (docs/WIN-CHANCE.md).
//
// The models: logistic regression on the differences between the two players at each moment, each
// weighted by functions of the game time so a lead can matter more or less as the game goes on.
// No intercept and only differences, so the two players' chances always add up to 100%. Each game
// weighs the same, whatever its length.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listGames, openDb, paths, readRecord, referencePaths } from "@replay-altar/core";
import { mmss } from "@replay-altar/core/time";
import { basis, BY_RACE, FEATURES, KNOTS_MIN, sigmoid, weightAt, winCurve, type Side, type SwingEvent, type WinModel } from "@replay-altar/rules/winchance";
import { fightLabel } from "@replay-altar/rules/series";
import {
  accuracyAt, bootstrapDiff, brierOf, CALIBRATION, calibrationSlope, crossValidate as cvOn, finiteGames, fitModel, fold, FOLDS, loadGames, lossOf, matchupCalibration, MATCHUPS, momentsOf, mulberry32,
  predsOn, RESEARCH, usualOf, VALIDATION, validationMeta, type Game, type Model, type Moment, type Pred, type Spec,
} from "./win-chance-lib.ts";

// ---- Options ---------------------------------------------------------------------------------
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args.splice(i, 2)[1] ?? "";
};
const workersOption = option("--workers") ?? "as-counted";
if (!["as-counted", "by-race", "by-race-workers", "by-race-plus"].includes(workersOption)) throw new Error("--workers: as-counted, by-race, by-race-workers or by-race-plus");
const BY_RACE_ON = workersOption !== "as-counted";
const sameAt = args.indexOf("--same-differences");
const SAME = sameAt >= 0 && args.splice(sameAt, 1).length > 0;
const outRoot = option("--out");
const docsDir = outRoot ?? join(import.meta.dirname, "../docs");
const modelFile = outRoot ? join(outRoot, "winchance.json") : join(import.meta.dirname, "../data/winchance.json");
/** The differences the search may use: workers and food used as counted, or against the race's usual. */
// by-race: workers and food used (D); by-race-workers: workers only (A); by-race-plus: also hero
// experience and resources lost (D+, scripts/win-chance-workers.ts).
const SWAPPED: Record<string, number[]> = { "as-counted": [], "by-race": [2, 8], "by-race-workers": [2], "by-race-plus": [2, 8, 3, 7] };
const swap = (f: number) => (SWAPPED[workersOption].includes(f) ? BY_RACE[f] : f);

/** Input names as the app shows them ("food used" is "amount of units" there). */
const inputName = (name: string) => name.replace("food used", "amount of units").replace(/, (against the race's usual)$/, " ($1)");



/** Every difference the search may keep (the first sixteen, with the swap above). */
const allFeatures = [...new Set(FEATURES.map((_, i) => i).filter((i) => i < 16).map(swap))].sort((a, b) => a - b);
/** The first model's differences: the original nine. */
const ORIGINAL = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(swap);
const label = (s: Spec) => `${s.keep.length} differences, ${s.basis === "linear" ? "straight-line" : "curved"} time weights${s.matchup ? ", matchup edges" : ""}`;


// ---- A more flexible model: boosted decision trees --------------------------------------------
// Small trees on the differences and the game time, added up (gradient boosting on log loss). A
// side's score is half its trees' value minus half the other side's, so the chances still add to
// 100%. Compared with the logistic models above; not used for the explanations.
type TreeSpec = { trees: number; depth: number; rate: number };
type Node = { f: number; thr: number; left: Node | number; right: Node | number };
type Trees = { spec: TreeSpec; nodes: (Node | number)[] };
const treeInput = (m: Moment, sign = 1) => [...allFeatures.map((f) => m.d[f] * sign), m.t / 60_000];
const BINS = 32;

function fitTrees(ms: Moment[], spec: TreeSpec): Trees {
  const xs = ms.map((m) => treeInput(m));
  const k = xs[0].length;
  const scale = ms.length / ms.reduce((s, m) => s + m.w, 0); // weights average 1 per moment
  const ws = ms.map((m) => m.w * scale);
  // Split points: quantiles of each input.
  const cuts = Array.from({ length: k }, (_, f) => {
    const v = xs.map((x) => x[f]).sort((a, b) => a - b);
    return [...new Set(Array.from({ length: BINS - 1 }, (_, i) => v[Math.floor(((i + 1) * v.length) / BINS)]))];
  });
  const bin = xs.map((x) => x.map((v, f) => {
    let b = 0;
    while (b < cuts[f].length && v > cuts[f][b]) b++;
    return b;
  }));
  const score = new Array(ms.length).fill(0);
  const nodes: (Node | number)[] = [];
  const lambda = 1, minHess = 20;
  for (let t = 0; t < spec.trees; t++) {
    const g = ms.map((m, i) => ws[i] * (sigmoid(score[i]) - m.y));
    const h = ms.map((_, i) => { const p = sigmoid(score[i]); return ws[i] * p * (1 - p); });
    const grow = (rows: number[], depth: number): Node | number => {
      let G = 0, H = 0;
      for (const i of rows) { G += g[i]; H += h[i]; }
      const leaf = (-G / (H + lambda)) * spec.rate;
      if (depth >= spec.depth || H < 2 * minHess) return leaf;
      let best = { gain: 0, f: -1, b: -1 };
      for (let f = 0; f < k; f++) {
        const hg = new Array(BINS).fill(0), hh = new Array(BINS).fill(0);
        for (const i of rows) { hg[bin[i][f]] += g[i]; hh[bin[i][f]] += h[i]; }
        let gl = 0, hl = 0;
        for (let b = 0; b < cuts[f].length; b++) {
          gl += hg[b]; hl += hh[b];
          const gr = G - gl, hr = H - hl;
          if (hl < minHess || hr < minHess) continue;
          const gain = (gl * gl) / (hl + lambda) + (gr * gr) / (hr + lambda) - (G * G) / (H + lambda);
          if (gain > best.gain) best = { gain, f, b };
        }
      }
      if (best.f < 0) return leaf;
      const left = rows.filter((i) => bin[i][best.f] <= best.b), right = rows.filter((i) => bin[i][best.f] > best.b);
      return { f: best.f, thr: cuts[best.f][best.b], left: grow(left, depth + 1), right: grow(right, depth + 1) };
    };
    const tree = grow(ms.map((_, i) => i), 0);
    nodes.push(tree);
    for (let i = 0; i < ms.length; i++) score[i] += treeValue(tree, xs[i]);
  }
  return { spec, nodes };
}
const treeValue = (n: Node | number, x: number[]): number => (typeof n === "number" ? n : treeValue(x[n.f] <= n.thr ? n.left : n.right, x));
const predictTrees = (model: Trees, m: Moment) => {
  const a = treeInput(m, 1), b = treeInput(m, -1);
  return sigmoid(model.nodes.reduce<number>((s, n) => s + (treeValue(n, a) - treeValue(n, b)) / 2, 0));
};

// ---- Data ------------------------------------------------------------------------------------
const calibration = loadGames(CALIBRATION);
const valMeta = validationMeta();
const valDb = referencePaths(VALIDATION).db;
const validation = valMeta.size ? loadGames([VALIDATION], valMeta) : [];
// Each race's usual workers and food used, from the calibration games only.
const usual = BY_RACE_ON ? usualOf(calibration) : undefined;

const calMoments = finiteGames(calibration.flatMap((g) => momentsOf(g, { usual })));
const valMoments = finiteGames(validation.flatMap((g) => momentsOf(g, { usual })));
const calUsed = new Set(calMoments.map((m) => m.game));
const valUsed = new Set(valMoments.map((m) => m.game));
const gameOf = new Map([...calibration, ...validation].map((g) => [g.key, g]));

const crossValidate = (spec: Spec) => cvOn(calMoments, spec);
const cvLoss = (spec: Spec) => lossOf(crossValidate(spec));

/** Drop, one at a time, any difference whose absence doesn't hurt (simpler and easier to explain). */
function backward(start: Spec, log: (s: string) => void): Spec {
  let spec = start;
  let base = cvLoss(spec);
  for (;;) {
    if (spec.keep.length <= 3) return spec;
    const tries = spec.keep.map((i) => ({ i, loss: cvLoss({ ...spec, keep: spec.keep.filter((j) => j !== i) }) })).sort((a, b) => a.loss - b.loss);
    if (tries[0].loss > base + 0.0005) return spec;
    log(`  drop ${FEATURES[tries[0].i]}: ${base.toFixed(4)} → ${tries[0].loss.toFixed(4)}`);
    spec = { ...spec, keep: spec.keep.filter((j) => j !== tries[0].i) };
    base = tries[0].loss;
  }
}

// ---- Model search on the calibration set -----------------------------------------------------
const progress = (s: string) => console.error(s);
progress(`calibration: ${calUsed.size} games, ${calMoments.length} moments; validation: ${valUsed.size} games`);
const firstModel = backward({ keep: ORIGINAL, basis: "linear", matchup: false, lambda: 0.01 }, progress);
progress(`first model: ${label(firstModel)} ${cvLoss(firstModel).toFixed(4)}`);
const shippedKeep = () => (JSON.parse(readFileSync(join(import.meta.dirname, "../data/winchance.json"), "utf8")) as WinModel).keep;
// A model already counted by race maps onto itself; one counted as it is, onto what --workers says.
const unswap = (f: number) => Number(Object.entries(BY_RACE).find(([, to]) => to === f)?.[0] ?? f);
const widerLinear = SAME
  ? { keep: shippedKeep().map((f) => swap(unswap(f))), basis: "linear" as const, matchup: false, lambda: 0.01 }
  : backward({ keep: allFeatures, basis: "linear", matchup: false, lambda: 0.01 }, progress);
progress(`more differences: ${label(widerLinear)} ${cvLoss(widerLinear).toFixed(4)}`);
const candidates: Spec[] = [firstModel, widerLinear];
for (const lambda of [0.01, 0.1, 0.5]) candidates.push({ ...widerLinear, basis: "curve", lambda });
const bestCurve = candidates.slice(2).sort((a, b) => cvLoss(a) - cvLoss(b))[0];
candidates.push({ ...bestCurve, matchup: true });
const scored = candidates.map((spec) => ({ spec, cv: crossValidate(spec) })).map((c) => ({ ...c, loss: lossOf(c.cv), brier: brierOf(c.cv) }));
for (const c of scored) progress(`${label(c.spec)} λ=${c.spec.lambda}: ${c.loss.toFixed(4)}`);
// Counted by race, a fixed edge per matchup is only shown for comparison, never chosen: one curve
// for every matchup (and on the calibration set the edges learn who was followed, not the races).
// With --same-differences the first model (its own search on the calibration set) is only shown too:
// on the 0.2.6 simulation it won there with army value and resources spent in place of the workers
// (0.5997 cross-validated) and lost on the validation set (0.6332 against 0.6219).
const best = [...scored].filter((c) => !(BY_RACE_ON && c.spec.matchup) && !(SAME && c.spec === firstModel)).sort((a, b) => a.loss - b.loss)[0];
const finals = scored.map((c) => ({ ...c, model: fitModel(calMoments, c.spec) }));
const finalBest = finals.find((f) => f.spec === best.spec)!;
const finalFirst = finals[0];

// Boosted trees, chosen by the same cross-validation.
const treeCv = (spec: TreeSpec): Pred[] => {
  const out: Pred[] = [];
  for (let f = 0; f < FOLDS; f++) {
    const model = fitTrees(calMoments.filter((m) => fold(m.game) !== f), spec);
    for (const m of calMoments.filter((m) => fold(m.game) === f)) out.push({ ...m, p: predictTrees(model, m) });
  }
  return out;
};
const treeTries = [
  { trees: 150, depth: 2, rate: 0.05 },
  { trees: 300, depth: 2, rate: 0.05 },
  { trees: 150, depth: 3, rate: 0.05 },
  { trees: 300, depth: 3, rate: 0.03 },
].map((spec) => {
  const cv = treeCv(spec);
  progress(`trees ${spec.trees}×depth ${spec.depth}: ${lossOf(cv).toFixed(4)}`);
  return { spec, cv, loss: lossOf(cv) };
});
const bestTrees = treeTries.sort((a, b) => a.loss - b.loss)[0];
const treeModel = fitTrees(calMoments, bestTrees.spec);
const valTrees: Pred[] = valMoments.map((m) => ({ ...m, p: predictTrees(treeModel, m) }));

// ---- Scores ----------------------------------------------------------------------------------
const pct = (v: number) => `${Math.round(v * 100)}%`;
const valBest = predsOn(finalBest.model, valMoments);
const valFirst = predsOn(finalFirst.model, valMoments);

const lines: string[] = [];
const out = (s = "") => lines.push(s);
out("# Win chance from pro games (research)");
out();
out(`Generated by \`node scripts/win-chance.ts${BY_RACE_ON ? ` --workers ${workersOption}` : ""}\`, which also writes the best model to \`data/winchance.json\` for the app. The method in full: [the technical report](win-chance/report.pdf).`);
out();
out(`**The data.** Fitted on the **calibration set**: ${calUsed.size} curated pro games of the current patch with a full simulation and a known winner. Scored on the **validation set**: ${valUsed.size} tournament games from warcraft3.info, 2022 to today, spread over the years and matchups (\`scripts/download-validation.ts\`), never used for fitting or for choosing the model.`);
out();
out("**The models.** At every 30 seconds of a game, the differences between the two players. A logistic regression with no intercept turns them into a chance to win; the two players' chances always add up to 100%. Each game weighs the same, whatever its length. A lead's weight can follow the game time as a straight line (the first model) or as a curve (straight pieces between 1, 5, 10, 15, 22 and 30 minutes). *Matchup edges* add a fixed advantage per race pairing.");
out();
out(`**Choosing a model** used only the calibration set: ${FOLDS}-fold cross-validation (fitted on three quarters of the games, scored on the rest, four times). A difference was dropped when leaving it out made the model no worse.`);
out();
out("| Model | Differences | Log loss, calibration (cross-validated) | Log loss, validation | Brier, validation |");
out("|---|---|---|---|---|");
for (const f of finals) {
  const v = predsOn(f.model, valMoments);
  out(`| ${label(f.spec)}${f.spec.basis === "curve" ? ` (ridge ${f.spec.lambda})` : ""}${f === finalBest ? " **(best)**" : ""} | ${f.spec.keep.map((i) => inputName(FEATURES[i])).join(", ")} | ${f.loss.toFixed(4)} | ${valMoments.length ? lossOf(v).toFixed(4) : "–"} | ${valMoments.length ? brierOf(v).toFixed(4) : "–"} |`);
}
out(`| Boosted trees (${bestTrees.spec.trees} trees of depth ${bestTrees.spec.depth}) | all ${allFeatures.length}, and the game time | ${bestTrees.loss.toFixed(4)} | ${valMoments.length ? lossOf(valTrees).toFixed(4) : "–"} | ${valMoments.length ? brierOf(valTrees).toFixed(4) : "–"} |`);
out(`| Coin flip | | 0.6931 | 0.6931 | 0.2500 |`);
out();
if (valMoments.length && finalBest !== finalFirst) {
  const d = bootstrapDiff(valBest, valFirst);
  out(`On the validation set, the best model's log loss minus the first model's: ${(lossOf(valBest) - lossOf(valFirst)).toFixed(4)} (95% range over games resampled: ${d.lo.toFixed(4)} to ${d.hi.toFixed(4)}; below zero means better).`);
  out();
}
if (valMoments.length) {
  const d = bootstrapDiff(valTrees, valBest);
  out(`Boosted trees minus the best logistic model, on the validation set: ${(lossOf(valTrees) - lossOf(valBest)).toFixed(4)} (95% range: ${d.lo.toFixed(4)} to ${d.hi.toFixed(4)}).`);
  out();
}
const shown = valMoments.length ? valBest : best.cv;
const where = valMoments.length ? "validation set" : "calibration set, cross-validated";
out(`**How often the favourite wins** (best model, ${where}), at each minute, among games still going, and how often the model was sure (above 80% or below 20%):`);
out();
out("| Minute | Games | Favourite won | Model sure |");
out("|---|---|---|---|");
for (const m of [3, 5, 7, 10, 12, 15, 20, 25]) {
  const a = accuracyAt(shown, m);
  if (a.n >= 20) out(`| ${m}:00 | ${a.n} | ${pct(a.acc)} | ${pct(a.sure)} |`);
}
out();
out(`**Calibration** (best model, ${where}): when the model says X%, does that side win about X% of the time?`);
out();
out("| Model said | Moments | Won |");
out("|---|---|---|");
for (let lo = 0; lo < 1; lo += 0.1) {
  const rows = shown.filter((r) => r.p >= lo && r.p < lo + 0.1);
  if (rows.length) out(`| ${pct(lo)}–${pct(lo + 0.1)} | ${rows.length} | ${pct(rows.reduce((s, r) => s + r.y, 0) / rows.length)} |`);
}
out();
if (valMoments.length) {
  const table = (title: string, keyOf: (g: Game) => string, order: string[]) => {
    out(`**By ${title}** (validation set):`);
    out();
    out(`| ${title[0].toUpperCase() + title.slice(1)} | Games | Log loss, best | Log loss, first | Favourite won at 10:00 |`);
    out("|---|---|---|---|---|");
    for (const k of order) {
      const pick = (ps: Pred[]) => ps.filter((r) => keyOf(gameOf.get(r.game)!) === k);
      const b = pick(valBest), f = pick(valFirst);
      if (!b.length) continue;
      const a10 = accuracyAt(b, 10);
      out(`| ${k} | ${new Set(b.map((r) => r.game)).size} | ${lossOf(b).toFixed(3)} | ${lossOf(f).toFixed(3)} | ${a10.n ? `${pct(a10.acc)} of ${a10.n}` : "–"} |`);
    }
    out();
  };
  table("year", (g) => String(g.year), ["2022", "2023", "2024", "2025", "2026"]);
  table("matchup", (g) => g.matchup, ["HvH", "HvO", "HvU", "HvN", "OvO", "OvU", "OvN", "UvU", "NvU", "NvN"]);
}

out("**What weighs most** (best model fitted on the calibration set; the change in win chance for a lead of one typical step, at 5, 10 and 15 minutes):");
out();
const sd = FEATURES.map((_, i) => {
  const v = calMoments.map((m) => m.d[i]);
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
});
const weightOf = (model: Model, k: number, t: number) => weightAt({ basis: model.spec.basis, weights: model.w }, k, t);
out("| A lead of one typical step in… | at 5:00 | at 10:00 | at 15:00 |");
out("|---|---|---|---|");
finalBest.spec.keep.forEach((f, k) => {
  const eff = (t: number) => {
    const e = sigmoid(sd[f] * weightOf(finalBest.model, k, t)) - 0.5;
    return `${e >= 0 ? "+" : ""}${Math.round(e * 100)} pts`;
  };
  out(`| ${inputName(FEATURES[f])} | ${eff(300_000)} | ${eff(600_000)} | ${eff(900_000)} |`);
});
out();
out("(A typical step is one standard deviation of that difference across all moments. The leads overlap, so read these together, not one by one.)");
if (finalBest.spec.matchup) {
  out();
  const nb = basis(finalBest.spec.basis, 0).length * finalBest.spec.keep.length;
  out(`Matchup edges (the first race's chance with no other difference): ${MATCHUPS.map((mu, i) => `${mu} ${pct(sigmoid(finalBest.model.w[nb + i]))}`).join(", ")}.`);
}

// ---- Per matchup: does the model lean towards a race? -----------------------------------------
const pts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(0)}`;
const matchupTables = [
  ...(valMoments.length ? [{ name: "validation set", rows: matchupCalibration(valBest) }] : []),
  { name: "calibration set, cross-validated", rows: matchupCalibration(best.cv) },
];
out();
out("**Each matchup's evaluation against its results** (best model). For the first race of each matchup, among games still going at that minute: the average chance the model gave, how often that race won, and the gap between the two in points (with its 95% range). A gap well away from 0 means the model leans towards a race. Mirror matchups (the record's first player) are a check.");
for (const tb of matchupTables) {
  out();
  out(`On the ${tb.name}:`);
  out();
  out("| Matchup | 5:00 | 10:00 | 15:00 | 20:00 |");
  out("|---|---|---|---|---|");
  for (const mu of [...new Set(tb.rows.map((r) => r.matchup))]) {
    const cell = (minute: number) => {
      const r = tb.rows.find((x) => x.matchup === mu && x.minute === minute);
      return r && r.games >= 20 ? `said ${pct(r.said)}, won ${pct(r.won)}: ${pts(r.gap)} ±${(r.half * 100).toFixed(0)} (${r.games})` : "–";
    };
    out(`| ${mu} | ${cell(5)} | ${cell(10)} | ${cell(15)} | ${cell(20)} |`);
  }
}
if (usual) {
  out();
  out("**What is usual for each race** (calibration set; the workers and the amount of units are counted against these):");
  out();
  out("| Minute | " + ["H", "O", "U", "N"].map((r) => `${r} workers | ${r} amount of units`).join(" | ") + " |");
  out("|---|" + "---|".repeat(8));
  for (const m of [2, 5, 10, 15, 20, 25]) out(`| ${m}:00 | ${["H", "O", "U", "N"].map((r) => `${usual.workers[r]?.[m]?.toFixed(1) ?? "–"} | ${usual.food[r]?.[m]?.toFixed(1) ?? "–"}`).join(" | ")} |`);
}

// What was written by hand below the marker stays (the notes on how workers are counted).
const KEEP_MARKER = "<!-- Written by hand from here on; scripts/win-chance.ts keeps it. -->";
mkdirSync(docsDir, { recursive: true });
const docFile = join(docsDir, "WIN-CHANCE.md");
const repoDoc = join(import.meta.dirname, "../docs/WIN-CHANCE.md");
const before = existsSync(repoDoc) ? readFileSync(repoDoc, "utf8") : "";
const kept = before.includes(KEEP_MARKER) ? "\n" + before.slice(before.indexOf(KEEP_MARKER)) : "";
writeFileSync(docFile, lines.join("\n") + "\n" + kept);

// ---- Sensitivity: how much does the army value's error matter? -------------------------------
// The army value is an estimate (docs/DATA.md: typically off by about 30%). Extra noise of that
// size, added to each player's army value at every sample, shows how much the model loses with an
// army value twice as wrong; leaving the army out entirely bounds what a perfect one could add.
const ARMY = [0, 1];
const sensitivity: { name: string; cv: number; validation: number | null }[] = [];
const scoreOn = (name: string, cal: Moment[], val: Moment[], spec: Spec) => {
  const model = fitModel(cal, spec);
  sensitivity.push({ name, cv: lossOf(cvOn(cal, spec)), validation: val.length ? lossOf(predsOn(model, val)) : null });
  progress(`sensitivity, ${name}: ${sensitivity.at(-1)!.cv.toFixed(4)}`);
};
scoreOn("as fitted", calMoments, valMoments, finalBest.spec);
const usesArmy = finalBest.spec.keep.some((f) => ARMY.includes(f));
if (usesArmy) scoreOn("without the army value", calMoments, valMoments, { ...finalBest.spec, keep: finalBest.spec.keep.filter((f) => !ARMY.includes(f)) });
// A model without the army value: what adding it back would give (the noise test below is moot).
else scoreOn("with the army value ratio (log) added", calMoments, valMoments, { ...finalBest.spec, keep: [...finalBest.spec.keep, 1].sort((a, b) => a - b) });
for (const sigma of usesArmy ? [500, 1000] : []) {
  const rand = mulberry32(sigma);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const noisy = (s: Side): Side => ({ ...s, series: s.series.map((x) => ({ ...x, armyValue: Math.max(0, (x.armyValue ?? 0) + sigma * gauss()) })) });
  const keep = (ms: Moment[], used: Set<string>) => ms.filter((m) => used.has(m.game));
  scoreOn(`army value with extra noise (sd ${sigma} per player)`, keep(calibration.flatMap((g) => momentsOf(g, { tweak: noisy, usual })), calUsed), keep(validation.flatMap((g) => momentsOf(g, { tweak: noisy, usual })), valUsed), finalBest.spec);
}

// ---- Everything the technical report quotes: docs/win-chance/results.json, games.csv --------
const reportDir = join(docsDir, "win-chance");
mkdirSync(reportDir, { recursive: true });
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: import.meta.dirname, encoding: "utf8" }).trim();
const valCounts = (() => {
  if (!existsSync(valDb)) return null;
  const db = openDb(valDb, { readOnly: true });
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return { downloaded: one("SELECT count(*) n FROM val_games"), simulationFailed: one("SELECT count(*) n FROM games WHERE sim_status = 'failed'"), simulated: one("SELECT count(*) n FROM games WHERE sim_status = 'ok'") };
})();
const binsOf = (ps: Pred[]) =>
  Array.from({ length: 10 }, (_, i) => {
    const rows = ps.filter((r) => r.p >= i / 10 && (r.p < (i + 1) / 10 || (i === 9 && r.p <= 1)));
    const w = rows.reduce((s, r) => s + r.w, 0);
    return { from: i / 10, to: (i + 1) / 10, moments: rows.length, said: rows.reduce((s, r) => s + r.w * r.p, 0) / w, won: rows.reduce((s, r) => s + r.w * r.y, 0) / w };
  });
const groupScores = (keyOf: (g: Game) => string, order: string[]) =>
  order
    .map((k) => {
      const pick = (ps: Pred[]) => ps.filter((r) => keyOf(gameOf.get(r.game)!) === k);
      const b = pick(valBest), f = pick(valFirst);
      return b.length ? { key: k, games: new Set(b.map((r) => r.game)).size, best: lossOf(b), first: lossOf(f), favouriteAt10: accuracyAt(b, 10) } : null;
    })
    .filter((x) => x);
const knotTimes = finalBest.spec.basis === "curve" ? KNOTS_MIN.map((m) => m * 60_000) : [60_000, 600_000, 1_800_000];
const results = {
  generatedAt: new Date().toISOString(),
  commit,
  calibration: { games: calUsed.size, moments: calMoments.length },
  // usable: simulated with a known winner (before games with unreadable numbers are left out).
  validation: { ...valCounts, usable: new Set(validation.flatMap((g) => momentsOf(g, { usual })).map((m) => m.game)).size, scored: valUsed.size, moments: valMoments.length },
  workers: workersOption,
  features: allFeatures.map((f) => FEATURES[f]),
  matchupCalibration: Object.fromEntries(matchupTables.map((tb) => [tb.name.startsWith("validation") ? "validation" : "cv", tb.rows])),
  usual: usual ?? null,
  models: scored.map((c) => ({ label: label(c.spec), keep: c.spec.keep.map((f) => FEATURES[f]), basis: c.spec.basis, matchup: c.spec.matchup, lambda: c.spec.lambda, cv: c.loss, validation: valMoments.length ? lossOf(predsOn(finals.find((f) => f.spec === c.spec)!.model, valMoments)) : null, brier: valMoments.length ? brierOf(predsOn(finals.find((f) => f.spec === c.spec)!.model, valMoments)) : null, best: c.spec === best.spec })),
  trees: { trees: bestTrees.spec.trees, depth: bestTrees.spec.depth, cv: bestTrees.loss, validation: valMoments.length ? lossOf(valTrees) : null, brier: valMoments.length ? brierOf(valTrees) : null },
  bootstrap: valMoments.length ? { bestMinusFirst: { diff: lossOf(valBest) - lossOf(valFirst), ...bootstrapDiff(valBest, valFirst) }, treesMinusBest: { diff: lossOf(valTrees) - lossOf(valBest), ...bootstrapDiff(valTrees, valBest) } } : null,
  slope: { cv: calibrationSlope(best.cv), validation: valMoments.length ? calibrationSlope(valBest) : null },
  favourite: [3, 5, 7, 10, 12, 15, 20, 25].map((m) => ({ minute: m, ...accuracyAt(valMoments.length ? valBest : best.cv, m) })),
  calibrationBins: { cv: binsOf(best.cv), validation: valMoments.length ? binsOf(valBest) : null },
  byYear: groupScores((g) => String(g.year), ["2022", "2023", "2024", "2025", "2026"]),
  byMatchup: groupScores((g) => g.matchup, ["HvH", "HvO", "HvU", "HvN", "OvO", "OvU", "OvN", "UvU", "NvU", "NvN"]),
  weights: finalBest.spec.keep.map((f, k) => ({
    feature: FEATURES[f],
    sd: sd[f],
    atKnots: knotTimes.map((t) => ({ minute: t / 60_000, weight: weightOf(finalBest.model, k, t) })),
    effect: [5, 10, 15].map((m) => ({ minute: m, points: sigmoid(sd[f] * weightOf(finalBest.model, k, m * 60_000)) - 0.5 })),
  })),
  sensitivity,
};
writeFileSync(join(reportDir, "results.json"), JSON.stringify(results, null, 1) + "\n");
// Which games: their warcraft3.info replay ids (or W3Champions match ids), never the replays.
const sourceOf = new Map<string, string>();
for (const g of CALIBRATION) {
  const db = referencePaths(g).db;
  if (!existsSync(db)) continue;
  for (const r of openDb(db, { readOnly: true }).prepare("SELECT game_key, w3c_match_id FROM ref_matches").all() as { game_key: string; w3c_match_id: string }[]) if (!sourceOf.has(r.game_key)) sourceOf.set(r.game_key, r.w3c_match_id);
}
const csv = ["set,source,id,matchup"];
for (const key of [...calUsed].sort()) {
  const id = sourceOf.get(key) ?? "";
  csv.push(`calibration,${id.startsWith("w3info:") ? "warcraft3.info" : "w3champions"},${id.replace(/^w3info:/, "")},${gameOf.get(key)!.matchup}`);
}
if (existsSync(valDb)) {
  const ids = new Map((openDb(valDb, { readOnly: true }).prepare("SELECT game_key, w3info_id FROM val_games").all() as { game_key: string; w3info_id: number }[]).map((r) => [r.game_key, r.w3info_id]));
  for (const key of [...valUsed].sort()) csv.push(`validation,warcraft3.info,${ids.get(key)},${gameOf.get(key)!.matchup}`);
}
writeFileSync(join(reportDir, "games.csv"), csv.join("\n") + "\n");

// ---- The model the app uses: data/winchance.json ----------------------------------------------
if (finalBest.spec.matchup) throw new Error("the app's model has no matchup edges (packages/rules/src/winchance.ts)");
const exported: WinModel = {
  keep: finalBest.spec.keep,
  basis: finalBest.spec.basis,
  weights: finalBest.model.w.map((w) => Number(w.toPrecision(6))),
  research: RESEARCH,
  ...(usual && finalBest.spec.keep.some((f) => f >= 16) ? { usual } : {}),
  about: {
    games: calUsed.size,
    patch: "3.0",
    fittedAt: new Date().toISOString().slice(0, 10),
    commit,
    cvLogLoss: Number(best.loss.toFixed(4)),
    validationGames: valUsed.size,
    validationLogLoss: valMoments.length ? Number(lossOf(valBest).toFixed(4)) : NaN,
  },
};
writeFileSync(modelFile, JSON.stringify(exported) + "\n");

// ---- Your games: the curve and the moments that swung it (as the app shows them) -------------
lines.length = 0;
const p = paths();
const db = openDb(p.db, { readOnly: true });
const mine = listGames(db).filter((g) => g.analyzed === 1 && g.sim_status === "ok");
out();
out("## Your games");
out();
let right = 0, counted = 0;
const examples: string[] = [];
for (const row of mine) {
  const r = readRecord(p, row.game_key);
  if (!r || r.sim?.status !== "ok") continue;
  const me = r.players.find((x) => x.isMe), opp = r.players.find((x) => x.playerId === r.classification.opponentId);
  if (!me || !opp) continue;
  const curve = winCurve(r, exported, me, opp);
  if (!curve) continue;
  // Judged at 2/3 of the game: the end itself gives the answer away.
  const mid = curve.points[Math.floor(curve.points.length * 0.66)];
  counted++;
  if ((mid.p > 0.5) === (row.result === "win")) right++;
  const whose = (who: "me" | "opp") => (who === "me" ? "your" : "their");
  const event = (e: SwingEvent) =>
    e.kind === "fight"
      ? `${fightLabel(e.category)} at ${mmss(e.at)} (you lost ${e.myLoss}, they lost ${e.oppLoss})`
      : e.kind === "heroDied"
        ? `${whose(e.who)} hero died at ≈${mmss(e.at)}`
        : e.kind === "expansionLost"
          ? `${whose(e.who)} expansion fell at ${mmss(e.at)}`
          : `${whose(e.who)} tier ${e.tier} finished`;
  if (examples.length < 8)
    examples.push(
      `**${row.result === "win" ? "Win" : "Loss"} ${row.matchup ?? ""} on ${row.map_name}, ${mmss(r.game.durationMs)}.** Your chance: ${curve.points
        .filter((_, i) => i % 4 === 0)
        .map((c) => `${mmss(c.t)} ${pct(c.p)}`)
        .join(" · ")}\n\n` +
        curve.swings
          .map((s) => {
            const moved = s.drivers.map((d) => `${inputName(FEATURES[d.feature])} (${d.favours === "me" ? "in your favour" : "in theirs"})`).join(", ");
            const events = s.events.map(event).join("; ");
            return `- ${mmss(s.from)}–${mmss(s.to)}: ${pct(s.pFrom)} → ${pct(s.pTo)}. Moved by: ${moved || "many small changes"}.${events ? ` Then: ${events}.` : ""}`;
          })
          .join("\n"),
    );
}
out(`Trained on pro games only, the model picked the winner of ${right} of your ${counted} games from the state at two thirds of the game.`);
out();
for (const e of examples) {
  out(e);
  out();
}

if (args[0]) writeFileSync(args[0], lines.join("\n") + "\n");
else console.log(lines.join("\n"));
