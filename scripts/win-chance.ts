// Research: a win-chance model from the pro games. At every moment of a game, how often does a side
// with these leads go on to win? Trained on half the pro games, tested on the other half, then
// applied to your games to find the moments that swung them. Writes docs/WIN-CHANCE.md (pro
// games only); your games go to the file given as an argument, never into the repository.
//
//   node scripts/win-chance.ts [your-games.md]
//
// The model: logistic regression on the differences between the two players (army value, workers,
// hero experience, bases, tier, resources spent and lost, food), each also multiplied by the game
// time so a lead can matter more or less as the game goes on. No intercept and only differences,
// so the two players' chances always add up to 100%. Each game weighs the same, whatever its length.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listGames, openDb, paths, readRecord, referencePaths, type GameRecord, type PlayerRecord, type SimSample } from "@replay-altar/core";
import { heroesXpAt } from "@replay-altar/core/heroxp";
import { mmss } from "@replay-altar/core/time";

const GROUPS = ["pros", "pros-orc", "pros-undead", "pros-nightelf"];
const STEP_MS = 30_000;
const START_MS = 60_000;

type SimOk = Extract<NonNullable<GameRecord["sim"]>, { status: "ok" }>;
type Side = { p: PlayerRecord; series: SimSample[]; bases: { at: number; lostAt: number | null }[]; t2: number | null; t3: number | null; levels: number[][]; deaths: number[] };

const sideOf = (r: GameRecord, p: PlayerRecord): Side | null => {
  const sp = (r.sim as SimOk).players.find((x) => x.playerId === p.playerId);
  if (!sp || !sp.series.length) return null;
  return {
    p,
    series: sp.series,
    bases: sp.bases ?? [],
    t2: sp.metrics.tier2_done_ms ?? null,
    t3: sp.metrics.tier3_done_ms ?? null,
    levels: p.heroes.map((h) => h.levelUps ?? []),
    deaths: (sp.heroes ?? []).flatMap((h) => h.deaths.map((d) => d.diedAt)),
  };
};

const at = (series: SimSample[], t: number) => {
  let best = series[0];
  for (const s of series) if (s.t <= t) best = s;
  return best;
};

export const FEATURES = ["army value", "army value ratio (log)", "workers", "hero experience", "bases", "tier", "resources spent", "resources lost", "food used"];

/** The differences A − B at time t (base features; the model adds each × time). */
function diffs(a: Side, b: Side, t: number, end: number): number[] {
  const sa = at(a.series, t), sb = at(b.series, t);
  const bases = (s: Side) => s.bases.filter((x) => x.at <= t && (x.lostAt === null || x.lostAt > t)).length;
  const tier = (s: Side) => (s.t2 !== null && s.t2 <= t ? 1 : 0) + (s.t3 !== null && s.t3 <= t ? 1 : 0);
  const army = (s: SimSample) => s.armyValue ?? 0;
  return [
    (army(sa) - army(sb)) / 1000,
    Math.log((army(sa) + 200) / (army(sb) + 200)),
    (sa.workers - sb.workers) / 10,
    (heroesXpAt(a.levels, t, end) - heroesXpAt(b.levels, t, end)) / 1000,
    bases(a) - bases(b),
    tier(a) - tier(b),
    (sa.goldSpent + sa.lumberSpent - sb.goldSpent - sb.lumberSpent) / 1000,
    (sa.goldLost + sa.lumberLost - sb.goldLost - sb.lumberLost) / 1000,
    (sa.foodUsed - sb.foodUsed) / 10,
  ];
}
const expand = (d: number[], t: number) => [...d, ...d.map((x) => (x * t) / 600_000)];

type Row = { game: string; x: number[]; y: number; w: number; t: number };

function rowsOf(r: GameRecord): Row[] {
  if (r.sim?.status !== "ok" || r.players.length !== 2) return [];
  const [p, q] = r.players;
  if (!["win", "loss"].includes(p.result ?? "")) return [];
  const a = sideOf(r, p), b = sideOf(r, q);
  if (!a || !b) return [];
  const end = r.game.durationMs;
  const times: number[] = [];
  for (let t = START_MS; t < end; t += STEP_MS) times.push(t);
  const out: Row[] = [];
  // Both sides of every game, each game weighing 1 in all.
  for (const t of times) {
    const d = diffs(a, b, t, end);
    const w = 1 / (2 * times.length);
    out.push({ game: r.gameKey, x: expand(d, t), y: p.result === "win" ? 1 : 0, w, t });
    out.push({ game: r.gameKey, x: expand(d.map((v) => -v), t), y: p.result === "win" ? 0 : 1, w, t });
  }
  return out;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

/** Logistic regression by Newton's method, with a small ridge penalty. */
function fit(rows: Row[], lambda = 0.01): number[] {
  const k = rows[0].x.length;
  let w = new Array(k).fill(0);
  for (let iter = 0; iter < 30; iter++) {
    const g = new Array(k).fill(0);
    const h = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const r of rows) {
      const p = sigmoid(dot(w, r.x));
      for (let i = 0; i < k; i++) {
        g[i] += r.w * (p - r.y) * r.x[i];
        for (let j = 0; j < k; j++) h[i][j] += r.w * p * (1 - p) * r.x[i] * r.x[j];
      }
    }
    for (let i = 0; i < k; i++) {
      g[i] += lambda * w[i];
      h[i][i] += lambda;
    }
    const step = solve(h, g);
    w = w.map((v, i) => v - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-6) break;
  }
  return w;
}

function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || !m[c][c]) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / (row[i] || 1));
}

// ---- Data: pro games, each once --------------------------------------------------------------
const games = new Map<string, GameRecord>();
for (const g of GROUPS) {
  const rp = referencePaths(g);
  for (const f of readdirSync(rp.games)) {
    const key = f.replace(/\.json$/, "");
    if (games.has(key)) continue;
    const r = readRecord(rp, key) as GameRecord | null;
    if (r) games.set(key, r);
  }
}
const all = [...games.values()].flatMap(rowsOf);
const half = (key: string) => parseInt(key.at(-1)!, 16) % 2;
const used = new Set(all.map((r) => r.game));

// Two-fold: fit on one half, test on the other, both ways. `keep`: the base features used.
type Pred = Row & { p: number };
const masked = (rows: Row[], keep: number[]) => {
  const cols = [...keep, ...keep.map((i) => i + FEATURES.length)];
  return rows.map((r) => ({ ...r, x: cols.map((c) => r.x[c]) }));
};
function crossValidate(keep: number[]): Pred[] {
  const rows = masked(all, keep);
  const out: Pred[] = [];
  for (const fold of [0, 1]) {
    const w = fit(rows.filter((r) => half(r.game) !== fold));
    for (const r of rows.filter((r) => half(r.game) === fold)) out.push({ ...r, p: sigmoid(dot(w, r.x)) });
  }
  return out;
}
const everything = FEATURES.map((_, i) => i);
const lossOf = (ps: Pred[]) => -ps.reduce((s, r) => s + r.w * (r.y ? Math.log(r.p) : Math.log(1 - r.p)), 0) / ps.reduce((s, r) => s + r.w, 0);
// Leave each difference out in turn: what does the model lose without it?
const ablation = everything.map((i) => ({ name: FEATURES[i], loss: lossOf(crossValidate(everything.filter((j) => j !== i))) }));
// Then drop, one at a time, any difference whose absence doesn't hurt (simpler and easier to explain).
let keep = [...everything];
for (;;) {
  const base = lossOf(crossValidate(keep));
  const tries = keep.map((i) => ({ i, loss: lossOf(crossValidate(keep.filter((j) => j !== i))) })).sort((a, b) => a.loss - b.loss);
  if (keep.length <= 3 || tries[0].loss > base + 0.0005) break;
  keep = keep.filter((j) => j !== tries[0].i);
}
const preds = crossValidate(keep);
const finalSmall = fit(masked(all, keep));
// Weights back in the full layout (zeros for dropped differences), for the curves below.
const final = new Array(FEATURES.length * 2).fill(0);
keep.forEach((f, k) => {
  final[f] = finalSmall[k];
  final[f + FEATURES.length] = finalSmall[k + keep.length];
});

// ---- Scores ----------------------------------------------------------------------------------
const pct = (v: number) => `${Math.round(v * 100)}%`;
const logLoss = lossOf;
const brier = (ps: Pred[]) => ps.reduce((s, r) => s + r.w * (r.p - r.y) ** 2, 0) / ps.reduce((s, r) => s + r.w, 0);
/** Share of games (one side each) where the favourite at minute m went on to win. */
const accuracyAt = (minute: number) => {
  const t = minute * 60_000;
  const rows = preds.filter((r) => Math.abs(r.t - t) < STEP_MS / 2 && r.y === 1);
  return { n: rows.length, acc: rows.filter((r) => r.p > 0.5).length / rows.length, sure: rows.filter((r) => r.p > 0.8 || r.p < 0.2).length / rows.length };
};

const lines: string[] = [];
const out = (s = "") => lines.push(s);
out("# Win chance from pro games (research)");
out();
out(`Generated by \`node scripts/win-chance.ts\` from ${used.size} pro games with a full simulation. Not shown in the app yet.`);
out();
out("**The model.** At every 30 seconds of a game, the differences between the two players: army value (also as a ratio), workers, hero experience, bases, tier, resources spent, resources lost and food. Each is also multiplied by the game time, so a lead can weigh more or less as the game goes on. A logistic regression with no intercept turns them into a chance to win; the two players' chances always add up to 100%. Each game weighs the same, whatever its length.");
out();
out(`**Differences kept:** ${keep.map((i) => FEATURES[i]).join(", ")}. The others were dropped because leaving them out made the model no worse on unseen games (the table at the end).`);
out();
out("**The test.** Two-fold: fitted on half the games (by game key) and scored on the other half, then the other way round. Every number below is on games the model did not see.");
out();
out(`| Score on unseen games | Model | Coin flip |`);
out(`|---|---|---|`);
out(`| Log loss (lower is better) | ${logLoss(preds).toFixed(3)} | 0.693 |`);
out(`| Brier score (lower is better) | ${brier(preds).toFixed(3)} | 0.250 |`);
out();
out("**How often the favourite wins**, at each minute, among games still going (and how often the model was sure: above 80% or below 20%):");
out();
out("| Minute | Games | Favourite won | Model sure |");
out("|---|---|---|---|");
for (const m of [3, 5, 7, 10, 12, 15, 20, 25]) {
  const a = accuracyAt(m);
  if (a.n >= 20) out(`| ${m}:00 | ${a.n} | ${pct(a.acc)} | ${pct(a.sure)} |`);
}
out();
out("**Calibration:** when the model says X%, does that side win about X% of the time?");
out();
out("| Model said | Moments | Won |");
out("|---|---|---|");
for (let lo = 0; lo < 1; lo += 0.1) {
  const rows = preds.filter((r) => r.p >= lo && r.p < lo + 0.1);
  if (rows.length) out(`| ${pct(lo)}–${pct(lo + 0.1)} | ${rows.length} | ${pct(rows.reduce((s, r) => s + r.y, 0) / rows.length)} |`);
}
out();
out("**What weighs most** (fitted on all games; the change in win chance for a typical lead, early and late):");
out();
const sd = FEATURES.map((_, i) => {
  const v = all.map((r) => r.x[i]);
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
});
out("| A lead of one typical step in… | at 5:00 | at 15:00 |");
out("|---|---|---|");
for (const i of keep) {
  const name = FEATURES[i];
  const eff = (t: number) => sigmoid(sd[i] * (final[i] + (final[i + FEATURES.length] * t) / 600_000)) - 0.5;
  out(`| ${name} | ${eff(300_000) >= 0 ? "+" : ""}${Math.round(eff(300_000) * 100)} pts | ${eff(900_000) >= 0 ? "+" : ""}${Math.round(eff(900_000) * 100)} pts |`);
}
out();
out("(A typical step is one standard deviation of that difference across all moments. The leads overlap, so read these together, not one by one.)");
out();
out("**Without each difference** (all nine in the model, one left out; log loss on unseen games, all nine: " + lossOf(crossValidate(everything)).toFixed(4) + "):");
out();
out("| Left out | Log loss |");
out("|---|---|");
for (const a of ablation) out(`| ${a.name} | ${a.loss.toFixed(4)} |`);

writeFileSync(join(import.meta.dirname, "../docs/WIN-CHANCE.md"), lines.join("\n") + "\n");

// ---- Your games: the curve and the moments that swung it -------------------------------------
lines.length = 0;
const p = paths();
const db = openDb(p.db);
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
  const a = sideOf(r, me), b = sideOf(r, opp);
  if (!a || !b) continue;
  const end = r.game.durationMs;
  const curve: { t: number; p: number }[] = [];
  for (let t = START_MS; t < end; t += STEP_MS) curve.push({ t, p: sigmoid(dot(final, expand(diffs(a, b, t, end), t))) });
  if (!curve.length) continue;
  // Judged at 2/3 of the game: the end itself gives the answer away.
  const mid = curve[Math.floor(curve.length * 0.66)];
  counted++;
  if ((mid.p > 0.5) === (row.result === "win")) right++;
  // The biggest swings over one minute, with what happened then.
  const swings = curve
    .map((c, i) => ({ t: c.t, from: curve[Math.max(0, i - 2)].p, to: c.p }))
    .map((s) => ({ ...s, d: s.to - s.from }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const picked: typeof swings = [];
  for (const s of swings) if (picked.length < 3 && picked.every((x) => Math.abs(x.t - s.t) > 90_000)) picked.push(s);
  const what = (t0: number, t1: number) => {
    const ev: string[] = [];
    for (const f of (r.sim as SimOk).fights ?? []) {
      if (f.category === "creep-fight" || f.end < t0 || f.start > t1) continue;
      const lm = f.losses?.[String(me.playerId)]?.value ?? 0, lo = f.losses?.[String(opp.playerId)]?.value ?? 0;
      if (lm + lo >= 150) ev.push(`${f.category.replace(/-/g, " ")} at ${mmss(f.start)} (you lost ${lm}, they lost ${lo})`);
    }
    for (const d of a.deaths) if (d >= t0 && d <= t1) ev.push(`your hero died at ≈${mmss(d)}`);
    for (const d of b.deaths) if (d >= t0 && d <= t1) ev.push(`their hero died at ≈${mmss(d)}`);
    for (const x of a.bases) if (x.lostAt !== null && x.lostAt >= t0 && x.lostAt <= t1) ev.push(`your expansion fell at ${mmss(x.lostAt)}`);
    for (const x of b.bases) if (x.lostAt !== null && x.lostAt >= t0 && x.lostAt <= t1) ev.push(`their expansion fell at ${mmss(x.lostAt)}`);
    for (const [s, who] of [[a, "your"], [b, "their"]] as const) {
      if (s.t2 !== null && s.t2 >= t0 && s.t2 <= t1) ev.push(`${who} tier 2 finished`);
      if (s.t3 !== null && s.t3 >= t0 && s.t3 <= t1) ev.push(`${who} tier 3 finished`);
    }
    return ev.join("; ");
  };
  // Which differences moved the chance: each one's share of the change in the model's score.
  const drivers = (t0: number, t1: number, up: boolean) => {
    const d0 = diffs(a, b, t0, end), d1 = diffs(a, b, t1, end);
    const weight = (i: number, t: number) => final[i] + (final[i + FEATURES.length] * t) / 600_000;
    return FEATURES.map((name, i) => ({ name, c: weight(i, t1) * d1[i] - weight(i, t0) * d0[i] }))
      .filter((x) => (up ? x.c > 0.05 : x.c < -0.05))
      .sort((x, y) => Math.abs(y.c) - Math.abs(x.c))
      .slice(0, 2)
      .map((x) => `${x.name} (${(x.c > 0) === true ? "in your favour" : "in theirs"})`)
      .join(", ");
  };
  if (examples.length < 8)
    examples.push(
      `**${row.result === "win" ? "Win" : "Loss"} ${row.matchup ?? ""} on ${row.map_name}, ${mmss(end)}.** Your chance: ${curve
        .filter((_, i) => i % 4 === 0)
        .map((c) => `${mmss(c.t)} ${pct(c.p)}`)
        .join(" · ")}\n\n` +
        picked
          .map((s) => {
            const events = what(s.t - 90_000, s.t);
            const moved = drivers(s.t - 60_000, s.t, s.d > 0);
            return `- ${mmss(s.t - 60_000)}–${mmss(s.t)}: ${pct(s.from)} → ${pct(s.to)}. Moved by: ${moved || "many small changes"}.${events ? ` Then: ${events}.` : ""}`;
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

if (process.argv[2]) writeFileSync(process.argv[2], lines.join("\n") + "\n");
else console.log(lines.join("\n"));
