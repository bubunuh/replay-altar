// The win-chance technical report: docs/win-chance/report.html and report.pdf, from the numbers
// scripts/win-chance.ts wrote to docs/win-chance/results.json and games.csv. Every number in the
// report comes from those files, so running both scripts again reproduces it.
//
//   node scripts/win-chance.ts && node scripts/win-chance-report.ts
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { START_MS, STEP_MS } from "@replay-altar/rules/winchance";

const dir = join(import.meta.dirname, "../docs/win-chance");
type Bin = { from: number; to: number; moments: number; said: number; won: number };
type Results = {
  generatedAt: string;
  commit: string;
  calibration: { games: number; moments: number };
  validation: { downloaded: number; simulationFailed: number; simulated: number; scored: number; moments: number };
  features: string[];
  models: { label: string; keep: string[]; basis: string; matchup: boolean; lambda: number; cv: number; validation: number; brier: number; best: boolean }[];
  trees: { trees: number; depth: number; cv: number; validation: number; brier: number };
  bootstrap: { bestMinusFirst: { diff: number; lo: number; hi: number }; treesMinusBest: { diff: number; lo: number; hi: number } };
  slope: { cv: number; validation: number };
  favourite: { minute: number; n: number; acc: number; sure: number }[];
  calibrationBins: { cv: Bin[]; validation: Bin[] };
  byYear: { key: string; games: number; best: number; first: number; favouriteAt10: { n: number; acc: number } }[];
  byMatchup: { key: string; games: number; best: number; first: number; favouriteAt10: { n: number; acc: number } }[];
  weights: { feature: string; sd: number; atKnots: { minute: number; weight: number }[]; effect: { minute: number; points: number }[] }[];
  sensitivity: { name: string; cv: number; validation: number | null }[];
};
const R = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as Results;
const games = readFileSync(join(dir, "games.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
const calSources = { w3info: games.filter((g) => g[0] === "calibration" && g[1] === "warcraft3.info").length, w3c: games.filter((g) => g[0] === "calibration" && g[1] === "w3champions").length };

const f3 = (v: number) => v.toFixed(3);
const f4 = (v: number) => v.toFixed(4);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number, d = 4) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const best = R.models.find((m) => m.best)!;
const first = R.models[0];
const COLORS = { ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", grid: "#e4e3df", blue: "#2a78d6", orange: "#eb6834" };

// ---- Figures (inline SVG) ----------------------------------------------------------------------
function calibrationFigure(): string {
  const W = 520, H = 360, L = 56, Rr = 150, T = 16, B = 46;
  const pw = W - L - Rr, ph = H - T - B;
  const x = (v: number) => L + v * pw, y = (v: number) => T + ph - v * ph;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${x(0)}" x2="${x(1)}" y1="${y(v)}" y2="${y(v)}" stroke="${COLORS.grid}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${COLORS.muted}">${pct(v)}</text><text x="${x(v)}" y="${T + ph + 18}" text-anchor="middle" font-size="11" fill="${COLORS.muted}">${pct(v)}</text>`);
  const series = (bins: Bin[], color: string, name: string, dy: number) => {
    const pts = bins.filter((b) => b.moments >= 50);
    return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts.map((b) => `${x(b.said).toFixed(1)},${y(b.won).toFixed(1)}`).join(" ")}"/>` +
      pts.map((b) => `<circle cx="${x(b.said).toFixed(1)}" cy="${y(b.won).toFixed(1)}" r="4.5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`).join("") +
      `<line x1="${W - Rr + 16}" x2="${W - Rr + 34}" y1="${T + 20 + dy}" y2="${T + 20 + dy}" stroke="${color}" stroke-width="2"/><text x="${W - Rr + 40}" y="${T + 24 + dy}" font-size="11.5" fill="${COLORS.ink}">${name}</text>`;
  };
  return `<svg class="narrow" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Calibration of the win chance">${grid.join("")}
<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="${COLORS.muted}" stroke-dasharray="4 4"/>
${series(R.calibrationBins.cv, COLORS.blue, "Pro games (unseen)", 0)}${series(R.calibrationBins.validation, COLORS.orange, "Validation set", 20)}
<line x1="${W - Rr + 16}" x2="${W - Rr + 34}" y1="${T + 60}" y2="${T + 60}" stroke="${COLORS.muted}" stroke-dasharray="4 4"/><text x="${W - Rr + 40}" y="${T + 64}" font-size="11.5" fill="${COLORS.ink}">Perfect</text>
<text x="${L + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="12" fill="${COLORS.ink2}">Chance the model gave (average within each tenth)</text>
<text transform="translate(14 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="${COLORS.ink2}">How often that side won</text></svg>`;
}

/** Small multiples: each kept difference's effect over the game (win-chance points for a lead of one standard deviation). */
function weightsFigure(): string {
  const cols = 4, cw = 170, chh = 120, L = 34, T = 22;
  const rows = Math.ceil(R.weights.length / cols);
  const W = cols * cw + 10, H = rows * (chh + 34) + 10;
  const all = R.weights.flatMap((w) => w.atKnots.map((k) => Math.abs(sigmoid(w.sd * k.weight) - 0.5)));
  const ymax = Math.ceil((Math.max(...all) * 100) / 10) * 10;
  const panels = R.weights.map((w, i) => {
    const ox = (i % cols) * cw, oy = Math.floor(i / cols) * (chh + 34);
    const pw = cw - L - 12, ph = chh - T - 18;
    const x = (m: number) => ox + L + ((m - 1) / 29) * pw;
    const y = (pts: number) => oy + T + ph / 2 - (pts / ymax) * (ph / 2);
    const minutes = Array.from({ length: 30 }, (_, k) => k + 1);
    const weightAtMinute = (m: number) => {
      const k = w.atKnots;
      if (m <= k[0].minute) return k[0].weight;
      if (m >= k.at(-1)!.minute) return k.at(-1)!.weight;
      const j = k.findIndex((p) => p.minute > m) - 1;
      const f = (m - k[j].minute) / (k[j + 1].minute - k[j].minute);
      return k[j].weight * (1 - f) + k[j + 1].weight * f;
    };
    const line = minutes.map((m) => `${x(m).toFixed(1)},${y((sigmoid(w.sd * weightAtMinute(m)) - 0.5) * 100).toFixed(1)}`).join(" ");
    return `<g><text x="${ox + L}" y="${oy + 14}" font-size="11.5" font-weight="600" fill="${COLORS.ink}">${esc(w.feature)}</text>
<line x1="${x(1)}" x2="${x(30)}" y1="${y(0)}" y2="${y(0)}" stroke="${COLORS.muted}"/>
${[ymax, -ymax].map((v) => `<line x1="${x(1)}" x2="${x(30)}" y1="${y(v)}" y2="${y(v)}" stroke="${COLORS.grid}"/><text x="${ox + L - 4}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="${COLORS.muted}">${v > 0 ? "+" : "−"}${Math.abs(v)}</text>`).join("")}
${[1, 10, 20, 30].map((m) => `<text x="${x(m)}" y="${oy + T + ph + 12}" text-anchor="middle" font-size="9" fill="${COLORS.muted}">${m}'</text>`).join("")}
<polyline fill="none" stroke="${COLORS.blue}" stroke-width="2" stroke-linejoin="round" points="${line}"/></g>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Weight of each difference over the game">${panels.join("")}</svg>`;
}

function favouriteFigure(): string {
  const W = 520, H = 230, L = 46, Rr = 16, T = 14, B = 40;
  const pw = W - L - Rr, ph = H - T - B;
  const rows = R.favourite.filter((f) => f.n >= 20);
  const bw = pw / rows.length;
  const y = (v: number) => T + ph - ((v - 0.4) / 0.4) * ph;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="How often the favourite won">
${[0.4, 0.5, 0.6, 0.7, 0.8].map((v) => `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0.5 ? COLORS.muted : COLORS.grid}" ${v === 0.5 ? 'stroke-dasharray="4 4"' : ""}/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${COLORS.muted}">${pct(v)}</text>`).join("")}
${rows.map((f, i) => `<rect x="${(L + i * bw + bw * 0.22).toFixed(1)}" y="${y(f.acc).toFixed(1)}" width="${(bw * 0.56).toFixed(1)}" height="${(y(0.4) - y(f.acc)).toFixed(1)}" rx="3" fill="${COLORS.blue}"/><text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${(y(f.acc) - 5).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${COLORS.ink}">${pct(f.acc)}</text><text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${T + ph + 16}" text-anchor="middle" font-size="11" fill="${COLORS.muted}">${f.minute}:00</text>`).join("")}
<text x="${L + pw / 2}" y="${H - 4}" text-anchor="middle" font-size="12" fill="${COLORS.ink2}">Game time (games still going at that minute; validation set)</text></svg>`;
}
function sigmoid(z: number) {
  return 1 / (1 + Math.exp(-z));
}

// ---- The report ------------------------------------------------------------------------------
const sens = (name: string) => R.sensitivity.find((s) => s.name.startsWith(name));
const asFitted = sens("as fitted")!, noArmy = sens("without"), noise500 = sens("army value with extra noise (sd 500"), noise1000 = sens("army value with extra noise (sd 1000");
const knotsText = best.basis === "curve" ? "1, 5, 10, 15, 22 and 30 minutes" : "";
const date = R.generatedAt.slice(0, 10);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Replay Altar: the win-chance curve</title>
<style>
  @page { size: A4; }
  body { font-family: "Inter", "Helvetica Neue", Arial, sans-serif; color: ${COLORS.ink}; font-size: 10.5pt; line-height: 1.5; max-width: 760px; margin: 0 auto; }
  h1 { font-size: 21pt; margin: 0 0 4px; } h2 { font-size: 13.5pt; margin: 22px 0 6px; break-after: avoid; } h3 { font-size: 11pt; margin: 14px 0 4px; break-after: avoid; }
  .sub { color: ${COLORS.ink2}; margin: 0 0 14px; } .abstract { background: #f3f2ee; border-radius: 8px; padding: 10px 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; margin: 6px 0 10px; }
  tr { break-inside: avoid; }
  figure svg.narrow { max-width: 430px; display: block; margin: 0 auto; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid ${COLORS.grid}; vertical-align: top; } th { color: ${COLORS.ink2}; font-weight: 600; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  figure { margin: 10px 0 14px; break-inside: avoid; } figcaption { color: ${COLORS.ink2}; font-size: 9pt; margin-top: 4px; }
  code { font-family: "JetBrains Mono", Menlo, Consolas, monospace; font-size: 9pt; background: #f3f2ee; padding: 0 3px; border-radius: 3px; }
  pre { background: #f3f2ee; padding: 8px 10px; border-radius: 6px; font-size: 8.8pt; white-space: pre-wrap; break-inside: avoid; }
  .eq { text-align: center; margin: 8px 0; font-family: "Cambria Math", "STIX Two Math", Georgia, serif; font-size: 11pt; }
  .best { font-weight: 600; }
</style></head><body>
<h1>The win-chance curve</h1>
<p class="sub">Replay Altar technical report · ${date} · results from commit <code>${R.commit}</code> · GPL-3.0</p>

<div class="abstract"><p><b>Summary.</b> For any 1v1 Warcraft III game, Replay Altar draws a curve of <i>how often professional players in the same position went on to win</i>, moment by moment, and explains its three biggest swings. The position is described by differences between the two players that can be reconstructed from the replay: army, workers, hero experience, heroes alive, expansions, resources lost and upgrades. A logistic regression whose weights change smoothly with game time was fitted on ${R.calibration.games} curated pro games of the current patch and scored, without any refitting, on ${R.validation.scored} tournament games from 2022 to 2026 that it never saw. Its log loss is ${f4(best.validation)} on those games (a coin flip scores 0.6931), it picks the eventual winner of ${pct(R.favourite.find((f) => f.minute === 10)!.acc)} of games at 10 minutes and ${pct(R.favourite.find((f) => f.minute === 20)!.acc)} at 20, and its confidence is honest on unseen pro games (calibration slope ${R.slope.cv.toFixed(2)}). This report describes the data, the model, how it was chosen and tested, and how to reproduce every number.</p></div>

<h2>1. What the curve means, and what it does not</h2>
<p>The number at minute <i>t</i> answers one question: <i>among pro games, how often did a player with these leads and deficits at minute t go on to win?</i> It is a measure of <b>position</b>, learned from players who rarely throw a lead away. It is <b>not</b> a forecast of the game being analyzed: between players who miss more chances, leads are lost more often, so the curve is too sure for them, and that is intended. A player who sees the curve fall from 60% to 20% in one minute learns that a pro in that spot would have lost ground there; that is the use the curve is built for. The two players' chances always add up to 100%.</p>

<h2>2. Data</h2>
<h3>2.1 What a replay holds</h3>
<p>A Warcraft III replay records only the players' commands (the game is deterministic and replays it), never the state of the game: no unit positions, no hit points, no deaths. Replay Altar reconstructs the state with WC3V, an open-source simulation of replays, with three fixes of its own (<code>patches/wc3v/</code>, proposed upstream). Unit deaths, which WC3V infers from units that stop receiving orders, are corrected with the selection lists the replay does record: when a player changes selection, the replay lists every unit that was selected, already without the dead ones (<code>packages/sim/src/deaths.ts</code>). Against Warcraft III's own unit counts on 50 recorded player-games, the reconstructed army value is typically off by about 30% from minute 3 on; the estimated difference between the two players' armies correlates 0.70 with the real one (<code>docs/DATA.md</code>, “How accurate the estimates are”).</p>
<h3>2.2 Calibration set (fitting and model choice)</h3>
<p>${R.calibration.games} 1v1 games by curated pro players on the current patch (3.0): ${calSources.w3info} tournament games from <a href="https://warcraft3.info/replays/">warcraft3.info</a> (players with a curated profile, at least 3 minutes, at most 20 games per player) and ${calSources.w3c} W3Champions ladder games by players rated 2400 or more, collected earlier in the same way. They were collected per race (about 200 games each); a game between two pros of different races sits in two collections and is counted once. A game is used when its simulation ran to the end and its winner is known from the replay. That gives ${R.calibration.moments.toLocaleString("en")} moments (Section 3).</p>
<h3>2.3 Validation set (scoring only)</h3>
<p>Tournament 1v1s from warcraft3.info, created 2022 to 2026, 600 per year. Within each year the archive's pages were visited in a fixed random order, at most 4 games per page (so a year is not a few tournaments), at most ${Math.ceil((600 / 10) * 1.6)} games per matchup and ${Math.ceil(600 / 15)} per player per year, games of at least 3 minutes between two players with a profile, and never a calibration game. Downloads were made one request every 5 seconds or slower. ${R.validation.downloaded.toLocaleString("en")} games were downloaded; ${R.validation.simulationFailed} could not be simulated (mostly old W3Champions map versions that are not on warcraft3.info) and ${R.validation.simulated - 3000} had no known winner; of the 3,000 usable, ${3000 - R.validation.scored} were left out for a broken simulation (non-finite numbers), leaving <b>${R.validation.scored.toLocaleString("en")}</b> games and ${R.validation.moments.toLocaleString("en")} moments. These games come from older patches and from players of several levels (from the very top to semi-pros), so they test how well the model carries over, not only how well it fits. They were never used to fit or to choose the model.</p>
<p>The list of games (warcraft3.info replay ids, W3Champions match ids) is in <code>docs/win-chance/games.csv</code>; the replays themselves are not redistributed.</p>

<h2>3. The position at each moment</h2>
<p>Each game is looked at every ${STEP_MS / 1000} seconds from minute ${START_MS / 60_000} until it ends. At each moment, for players A and B, the model sees differences A − B. ${R.features.length} candidate differences were tried:</p>
<table><tr><th>Difference</th><th>How it is measured (at time <i>t</i>)</th><th class="n">Scale</th></tr>
<tr><td>army value</td><td>gold + lumber of the army units alive (heroes and workers excluded), valued in the form they had then</td><td class="n">/1000</td></tr>
<tr><td>army value ratio (log)</td><td>log((A + 200) / (B + 200)) of the same army values</td><td class="n">—</td></tr>
<tr><td>workers</td><td>workers alive (simulation)</td><td class="n">/10</td></tr>
<tr><td>hero experience</td><td>sum over heroes of the experience of the levels reached so far (levels are exact: each level-up is a skill pick)</td><td class="n">/1000</td></tr>
<tr><td>bases</td><td>town halls standing (expansions built and not destroyed)</td><td class="n">—</td></tr>
<tr><td>tier</td><td>tier 2 and tier 3 finished (0–2)</td><td class="n">—</td></tr>
<tr><td>resources spent</td><td>gold + lumber spent so far</td><td class="n">/1000</td></tr>
<tr><td>resources lost</td><td>gold + lumber of units lost so far (heroes excluded)</td><td class="n">/1000</td></tr>
<tr><td>food used</td><td>food in use</td><td class="n">/10</td></tr>
<tr><td>highest hero level</td><td>level of the highest hero</td><td class="n">—</td></tr>
<tr><td>heroes alive</td><td>heroes that have appeared minus those dead and not yet revived</td><td class="n">—</td></tr>
<tr><td>hero deaths</td><td>hero deaths so far</td><td class="n">—</td></tr>
<tr><td>upgrades</td><td>research finished: order time plus the game's research time for that level (repeated clicks counted once)</td><td class="n">—</td></tr>
<tr><td>attack and armor upgrades</td><td>the same, for weapon and armor research only</td><td class="n">—</td></tr>
<tr><td>items bought</td><td>item purchases so far</td><td class="n">/5</td></tr>
<tr><td>creep camps (levels)</td><td>sum of the levels of the creep camps cleared so far</td><td class="n">/20</td></tr></table>
<p><b>Only what is known at time t.</b> Every difference uses information up to <i>t</i> and nothing after it. This matters more than it seems: an earlier version estimated hero experience between two level-ups by interpolating towards the <i>next</i> level-up (and, after the last one, towards the end of the game), as the app's charts still do. That let the model see a won fight coming, because a hero about to level up was already credited with the experience. With it, the cross-validated log loss looked like 0.588; without it, it is ${f4(best.cv)}. The honest number is the one reported here. Cancelled research and buildings cannot be told apart in a replay and are counted as ordered.</p>

<h2>4. The model</h2>
<p>For a moment at time <i>t</i> with differences <b>d</b> = (d<sub>1</sub>, …, d<sub>K</sub>) (A − B, scaled as above), the chance that A wins is</p>
<p class="eq">P(A wins | <b>d</b>, t) = σ( Σ<sub>k</sub> w<sub>k</sub>(t) · d<sub>k</sub> ),&nbsp;&nbsp;&nbsp; σ(z) = 1 / (1 + e<sup>−z</sup>)</p>
<p>with no intercept. Swapping A and B flips the sign of every d<sub>k</sub>, so P(B wins) = 1 − P(A wins) exactly, and equal players are at 50%. The weight of each difference follows the game time: w<sub>k</sub>(t) = Σ<sub>j</sub> β<sub>kj</sub> · b<sub>j</sub>(t), where b<sub>j</sub> are either a straight line (b = 1 and t / 10 min) or “hat” functions with knots at ${knotsText || "1, 5, 10, 15, 22 and 30 minutes"} (each 1 at its knot, falling linearly to 0 at the neighbouring knots, constant beyond the last), so a weight is a piecewise-linear curve through one value per knot.</p>
<p><b>Fitting.</b> Every moment enters twice, once from each player's side (with its outcome 1 or 0), and each moment of a game with <i>n</i> moments weighs 1 / (2n), so every game counts the same whatever its length. The coefficients β minimise the weighted log loss plus a ridge penalty λ‖β‖² / 2, by Newton's method (30 iterations). A variant adds a fixed edge per race pairing (antisymmetric, so the sum stays at 100%).</p>
<p><b>Model choice</b> used only the calibration set: 4-fold cross-validation with folds by game (a game's moments are never split between fitting and scoring). Starting from all differences, a difference was dropped whenever leaving it out did not make the cross-validated log loss worse (backward elimination). The first model started from the nine differences of an earlier study (the first nine of the table above) and was reduced the same way. Boosted decision trees (gradient boosting on log loss, depth 2–3, 150–300 trees, antisymmetrised the same way) were compared as a more flexible alternative.</p>

<h2>5. Results</h2>
<table><tr><th>Model</th><th>Differences kept</th><th class="n">Log loss, pro games (CV)</th><th class="n">Log loss, validation</th><th class="n">Brier, validation</th></tr>
${R.models.map((m) => `<tr class="${m.best ? "best" : ""}"><td>${esc(m.label)}${m.basis === "curve" || m.lambda !== 0.01 ? ` (ridge ${m.lambda})` : ""}${m.best ? " — chosen" : ""}</td><td>${esc(m.keep.join(", "))}</td><td class="n">${f4(m.cv)}</td><td class="n">${f4(m.validation)}</td><td class="n">${f4(m.brier)}</td></tr>`).join("\n")}
<tr><td>Boosted trees (${R.trees.trees} trees of depth ${R.trees.depth})</td><td>all ${R.features.length}, and the game time</td><td class="n">${f4(R.trees.cv)}</td><td class="n">${f4(R.trees.validation)}</td><td class="n">${f4(R.trees.brier)}</td></tr>
<tr><td>Coin flip</td><td></td><td class="n">0.6931</td><td class="n">0.6931</td><td class="n">0.2500</td></tr></table>
<p>The chosen model is the one with the lowest cross-validated log loss on the pro games. On the validation set it beats the first model by ${signed(R.bootstrap.bestMinusFirst.diff)} log loss (95% interval from resampling games: ${signed(R.bootstrap.bestMinusFirst.lo)} to ${signed(R.bootstrap.bestMinusFirst.hi)}). Boosted trees do ${R.bootstrap.treesMinusBest.lo > 0 ? "worse" : "no better"}: ${signed(R.bootstrap.treesMinusBest.diff)} on the validation set (${signed(R.bootstrap.treesMinusBest.lo)} to ${signed(R.bootstrap.treesMinusBest.hi)}) and ${signed(R.trees.cv - best.cv)} on the pro games. The logistic model is also small (${best.keep.length} curves) and lets each swing be explained difference by difference.</p>

<h3>5.1 Calibration</h3>
<figure>${calibrationFigure()}<figcaption>Figure 1. Moments grouped by the chance the model gave (tenths); for each group, how often that side won. Blue: pro games, each predicted by a model fitted without its fold. Orange: the validation set.</figcaption></figure>
<p>On unseen pro games the model's confidence is right: the calibration slope (b in P = σ(b · logit p), fitted on the predictions; 1 is perfect, below 1 too confident) is <b>${R.slope.cv.toFixed(2)}</b>, so no correction was added. On the validation set it is ${R.slope.validation.toFixed(2)}: there the model is too sure, as Section 1 expects for older patches and less consistent players. A correction fitted on those games would make the curve honest for them but would also flatten the swings that show missed chances, so the curve stays a pro baseline by design.</p>

<h3>5.2 How often the favourite wins</h3>
<figure>${favouriteFigure()}<figcaption>Figure 2. Share of validation games, among those still going, where the side the model favoured at that minute went on to win.</figcaption></figure>
<table><tr><th>Minute</th>${R.favourite.filter((f) => f.n >= 20).map((f) => `<th class="n">${f.minute}:00</th>`).join("")}</tr>
<tr><td>Games still going</td>${R.favourite.filter((f) => f.n >= 20).map((f) => `<td class="n">${f.n}</td>`).join("")}</tr>
<tr><td>Model above 80% or below 20%</td>${R.favourite.filter((f) => f.n >= 20).map((f) => `<td class="n">${pct(f.sure)}</td>`).join("")}</tr></table>

<h3>5.3 By year and matchup (validation set)</h3>
<table><tr><th>Year</th><th class="n">Games</th><th class="n">Log loss, chosen</th><th class="n">Log loss, first</th><th class="n">Favourite won at 10:00</th></tr>
${R.byYear.map((r) => `<tr><td>${r.key}</td><td class="n">${r.games}</td><td class="n">${f3(r.best)}</td><td class="n">${f3(r.first)}</td><td class="n">${pct(r.favouriteAt10.acc)} of ${r.favouriteAt10.n}</td></tr>`).join("\n")}</table>
<table><tr><th>Matchup</th><th class="n">Games</th><th class="n">Log loss, chosen</th><th class="n">Log loss, first</th><th class="n">Favourite won at 10:00</th></tr>
${R.byMatchup.map((r) => `<tr><td>${r.key}</td><td class="n">${r.games}</td><td class="n">${f3(r.best)}</td><td class="n">${f3(r.first)}</td><td class="n">${pct(r.favouriteAt10.acc)} of ${r.favouriteAt10.n}</td></tr>`).join("\n")}</table>
<p>The scores do not simply get worse with older games, which suggests the differences between years come more from the tournaments and players than from patch changes.</p>

<h3>5.4 What weighs most</h3>
<figure>${weightsFigure()}<figcaption>Figure 3. For each difference the chosen model uses: the change in win chance, in percentage points, for a lead of one standard deviation of that difference (across all calibration moments), at each minute, with the others even. The leads overlap (a bigger army usually comes with more experience), so the panels are read together, not one by one.</figcaption></figure>
<table><tr><th>A lead of one standard deviation in…</th><th class="n">One standard deviation</th><th class="n">at 5:00</th><th class="n">at 10:00</th><th class="n">at 15:00</th></tr>
${R.weights.map((w) => `<tr><td>${esc(w.feature)}</td><td class="n">${w.sd.toFixed(2)}</td>${w.effect.map((e) => `<td class="n">${e.points >= 0 ? "+" : "−"}${Math.abs(Math.round(e.points * 100))} pts</td>`).join("")}</tr>`).join("\n")}</table>
<p>Resources lost carries a negative weight, as it should (losing more is worse). Upgrades weigh slightly against early on, when research competes with units for the same resources, and for the player from about minute 8. The standard deviation column is in the scaled units of Section 3.</p>

<h3>5.5 How much the army value's error matters</h3>
<p>The army value is the least certain input. To see how much its error costs, the model was refitted with extra random noise added to each player's army value at every sample, and once without the army value at all.</p>
<table><tr><th>Army value</th><th class="n">Log loss, pro games (CV)</th><th class="n">Log loss, validation</th></tr>
<tr><td>As reconstructed</td><td class="n">${f4(asFitted.cv)}</td><td class="n">${asFitted.validation === null ? "—" : f4(asFitted.validation)}</td></tr>
${noise500 ? `<tr><td>With extra noise, sd 500 per player (about the measured error again)</td><td class="n">${f4(noise500.cv)}</td><td class="n">${noise500.validation === null ? "—" : f4(noise500.validation)}</td></tr>` : ""}
${noise1000 ? `<tr><td>With extra noise, sd 1000 per player</td><td class="n">${f4(noise1000.cv)}</td><td class="n">${noise1000.validation === null ? "—" : f4(noise1000.validation)}</td></tr>` : ""}
${noArmy ? `<tr><td>Left out</td><td class="n">${f4(noArmy.cv)}</td><td class="n">${noArmy.validation === null ? "—" : f4(noArmy.validation)}</td></tr>` : ""}</table>
<p>${noise500 && noArmy ? `Adding noise about as large as today's error again costs ${f4(noise500.cv - asFitted.cv)} on the pro games and ${f4((noise500.validation ?? 0) - (asFitted.validation ?? 0))} on the validation set; leaving the army value out costs ${f4(noArmy.cv - asFitted.cv)} and ${f4((noArmy.validation ?? 0) - (asFitted.validation ?? 0))}. By the same slope, removing today's error altogether would gain a few thousandths at most.` : ""} A better army estimate would make the app's army chart and loss numbers more accurate, but would change the curve little.</p>

<h2>6. Explaining the swings</h2>
<p>The app marks the three largest changes of the curve over one minute (at least 8 points, at least 90 seconds apart). For a swing from t<sub>0</sub> to t<sub>1</sub>, each difference's share of the change in the model's score is c<sub>k</sub> = w<sub>k</sub>(t<sub>1</sub>)·d<sub>k</sub>(t<sub>1</sub>) − w<sub>k</sub>(t<sub>0</sub>)·d<sub>k</sub>(t<sub>0</sub>); the two largest in the direction of the swing (above 0.05) are named, with whom they favoured. A difference whose weight has the unexpected sign at that moment (the model is using it to correct another one) is not named, because the sentence would read backwards. Next to them the app lists what happened in the 90 seconds before t<sub>1</sub>: fights (with the losses on each side as the report counts them), hero deaths, expansions destroyed and tiers finished. These are descriptions of the moment, not proof of cause.</p>

<h2>7. Limitations</h2>
<ul>
<li><b>Reconstructed inputs.</b> Army value and losses are estimates (Section 2.1); hero deaths are approximate; cancelled orders count as done.</li>
<li><b>One patch of pro games.</b> The weights are those of patch 3.0 pro play. After a balance patch they may drift; the validation years suggest slowly.</li>
<li><b>No skill or matchup term.</b> The same leads are worth the same in every matchup (race edges did not help), and the curve does not know who is playing.</li>
<li><b>What the replay cannot show</b>: positions, vision, who is about to win a fight. The curve reacts to the results of a fight once its losses and experience show, not before.</li>
<li><b>Moments are not independent.</b> All intervals are from resampling whole games, never single moments.</li>
</ul>

<h2>8. Reproducing it</h2>
<p>Everything is in the repository at <a href="https://github.com/bubunuh/replay-altar">github.com/bubunuh/replay-altar</a> (GPL-3.0). From a Linux checkout with the simulation set up (README, “Linux”):</p>
<pre># The calibration games (or download again the ids in games.csv)
replay-altar ref refresh --all
# The validation games (one request every 5 seconds: several hours), then re-summarized
node scripts/download-validation.ts --target 3000
node scripts/observer/resummarize.ts --group validation
# Fit, choose and score: docs/WIN-CHANCE.md, data/winchance.json, results.json, games.csv
node scripts/win-chance.ts
# This report (HTML, then PDF through Electron)
node scripts/win-chance-report.ts</pre>
<p>The model's inputs and the curve are computed by one file shared by the research script and the app, <code>packages/rules/src/winchance.ts</code>; the fitted model the app ships is <code>data/winchance.json</code>. The army value measurement is in <code>scripts/observer/</code> and <code>docs/DATA.md</code>. Replays are not redistributed: the games are listed by id in <code>games.csv</code> and can be downloaded again from warcraft3.info and W3Champions.</p>
</body></html>
`;
writeFileSync(join(dir, "report.html"), html);
execFileSync("npx", ["electron", "--ozone-platform=headless", join(import.meta.dirname, "html-to-pdf.cjs"), join(dir, "report.html"), join(dir, "report.pdf")], { cwd: join(import.meta.dirname, ".."), stdio: ["ignore", "ignore", "inherit"] });
console.log(`wrote ${join(dir, "report.html")} and report.pdf`);
