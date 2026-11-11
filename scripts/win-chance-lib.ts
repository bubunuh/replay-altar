// What scripts/win-chance.ts (the fit and its report) and scripts/win-chance-workers.ts (the
// per-matchup check of how workers are counted) share: the games, the moments, the logistic fit
// and the scores. Reads the reference sets and never writes to them (the databases are opened
// read-only).
import { existsSync, readdirSync } from "node:fs";
import { openDb, paths, readRecord, referencePaths, type GameRecord } from "@replay-altar/core";
import { gamedataDir, loadCosts } from "@replay-altar/sim";
import { basis, diffs, sampleAt, sideOf, sigmoid, START_MS, STEP_MS, type ResearchTimes, type Side, type Usual, type WinModel } from "@replay-altar/rules/winchance";

export const costs = loadCosts(gamedataDir(paths().root));
export const RESEARCH: ResearchTimes = Object.fromEntries(Object.entries(costs.upgrades).map(([code, u]) => [code, [u.timeBase, u.timeMod]]));
export const CALIBRATION = ["pros", "pros-orc", "pros-undead", "pros-nightelf"];
export const VALIDATION = "validation";
export const FOLDS = 4;

export const MATCHUPS = ["HvO", "HvU", "HvN", "OvU", "OvN", "UvN"];
/** The model's view of one moment: which differences, which time curve, and race edges per matchup. */
export type Spec = { keep: number[]; basis: WinModel["basis"]; matchup: boolean; lambda: number };

/**
 * One side of a game at one moment. `first`: the side is the record's first player (each game is
 * there twice, once from each side). `x`: whatever `extra` returned for this side and the other.
 */
export type Moment = { game: string; d: number[]; t: number; y: number; w: number; races: [string, string]; first: boolean; x?: [number[], number[]] };
export type Game = { key: string; record: GameRecord; year: number | null; matchup: string };

export type MomentOptions = {
  /** Changes a side before the differences are taken (the sensitivity test). */
  tweak?: (s: Side) => Side;
  /** Each race's usual numbers (rules/winchance.ts); without them those differences are 0. */
  usual?: Usual;
  /** More numbers about one side at time t, kept on the moment (`x`). */
  extra?: (s: Side, t: number) => number[];
};

export function momentsOf(g: Game, opts: MomentOptions = {}): Moment[] {
  const r = g.record;
  if (r.sim?.status !== "ok" || r.players.length !== 2) return [];
  const [p, q] = r.players;
  if (!["win", "loss"].includes(p.result ?? "")) return [];
  const sa = sideOf(r, p, RESEARCH), sb = sideOf(r, q, RESEARCH);
  if (!sa || !sb) return [];
  const a = opts.tweak ? opts.tweak(sa) : sa, b = opts.tweak ? opts.tweak(sb) : sb;
  const end = r.game.durationMs;
  const times: number[] = [];
  for (let t = START_MS; t < end; t += STEP_MS) times.push(t);
  const out: Moment[] = [];
  // Both sides of every game, each game weighing 1 in all.
  for (const t of times) {
    const d = diffs(a, b, t, opts.usual);
    const w = 1 / (2 * times.length);
    const xa = opts.extra?.(a, t), xb = opts.extra?.(b, t);
    out.push({ game: r.gameKey, d, t, y: p.result === "win" ? 1 : 0, w, races: [a.race, b.race], first: true, ...(xa && xb ? { x: [xa, xb] as [number[], number[]] } : {}) });
    out.push({ game: r.gameKey, d: d.map((v) => -v), t, y: p.result === "win" ? 0 : 1, w, races: [b.race, a.race], first: false, ...(xa && xb ? { x: [xb, xa] as [number[], number[]] } : {}) });
  }
  return out;
}

/** A race's usual needs at least this many players still in the game at that minute. */
export const USUAL_MIN_PLAYERS = 30;
/** Averages per race and whole minute, while at least USUAL_MIN_PLAYERS players are still playing. */
export function usualTables(rows: { race: string; minute: number; workers: number; food: number }[]): Usual {
  const usual: Usual = { workers: {}, food: {} };
  for (const race of new Set(rows.map((r) => r.race))) {
    const mine = rows.filter((r) => r.race === race);
    const w: number[] = [], f: number[] = [];
    for (let m = 0; ; m++) {
      const at = mine.filter((r) => r.minute === m);
      if (at.length < USUAL_MIN_PLAYERS) break;
      w.push(Number((at.reduce((s, r) => s + r.workers, 0) / at.length).toFixed(2)));
      f.push(Number((at.reduce((s, r) => s + r.food, 0) / at.length).toFixed(2)));
    }
    if (w.length) (usual.workers[race] = w), (usual.food[race] = f);
  }
  return usual;
}
/** Each race's usual workers and food used at each minute, from these games (the calibration set). */
export function usualOf(games: Game[]): Usual {
  const rows: { race: string; minute: number; workers: number; food: number }[] = [];
  for (const g of games) {
    const r = g.record;
    if (r.sim?.status !== "ok" || r.players.length !== 2 || !["win", "loss"].includes(r.players[0].result ?? "")) continue;
    for (const p of r.players) {
      const side = sideOf(r, p, RESEARCH);
      if (!side) continue;
      for (let m = 0; m * 60_000 < r.game.durationMs; m++) {
        const s = sampleAt(side.series, m * 60_000);
        rows.push({ race: side.race, minute: m, workers: s.workers, food: s.foodUsed });
      }
    }
  }
  return usualTables(rows);
}

/**
 * The same moments, weighted so that in each matchup between two races each race's wins weigh
 * the same in a fit. The calibration set follows some players more than others, so a race can
 * lose most of its games there (Undead won 34% in 0.2.x's); fitted as they are, anything that
 * tells the races apart (a worker count, above all) is learnt as a sign of losing. Scores are
 * never taken with these weights.
 */
export function evenResults(ms: Moment[]): Moment[] {
  const won = new Map<string, number>();
  for (const m of ms) if (m.y && m.races[0] !== m.races[1]) won.set(m.races.join(">"), (won.get(m.races.join(">")) ?? 0) + m.w);
  return ms.map((m) => {
    if (m.races[0] === m.races[1]) return m;
    const winner = m.y ? m.races : [m.races[1], m.races[0]];
    const mine = won.get(winner.join(">")) ?? 0, theirs = won.get(`${winner[1]}>${winner[0]}`) ?? 0;
    return mine && theirs ? { ...m, w: (m.w * (mine + theirs)) / (2 * mine) } : m;
  });
}

/** +1 when A has the first race of the matchup, −1 when B has it: a race edge that keeps the sum at 100%. */
const matchupTerms = (races: [string, string]) =>
  MATCHUPS.map((mu) => (races[0] === mu[0] && races[1] === mu[2] ? 1 : races[0] === mu[2] && races[1] === mu[0] ? -1 : 0));

export function design(m: Moment, s: Spec): number[] {
  const bs = basis(s.basis, m.t);
  const x: number[] = [];
  for (const f of s.keep) for (const b of bs) x.push(m.d[f] * b);
  if (s.matchup) x.push(...matchupTerms(m.races));
  return x;
}

export const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

/** Logistic regression by Newton's method, with a ridge penalty. */
export function fit(xs: number[][], ys: number[], ws: number[], lambda: number): number[] {
  const k = xs[0].length;
  let w = new Array(k).fill(0);
  for (let iter = 0; iter < 30; iter++) {
    const g = new Array(k).fill(0);
    const h = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let n = 0; n < xs.length; n++) {
      const x = xs[n];
      const p = sigmoid(dot(w, x));
      const gw = ws[n] * (p - ys[n]), hw = ws[n] * p * (1 - p);
      for (let i = 0; i < k; i++) {
        if (x[i] === 0) continue;
        g[i] += gw * x[i];
        const hi = h[i], hx = hw * x[i];
        for (let j = i; j < k; j++) hi[j] += hx * x[j];
      }
    }
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < i; j++) h[i][j] = h[j][i];
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

export type Model = { spec: Spec; w: number[] };
export const fitModel = (ms: Moment[], spec: Spec): Model => ({ spec, w: fit(ms.map((m) => design(m, spec)), ms.map((m) => m.y), ms.map((m) => m.w), spec.lambda) });
export const predict = (model: Model, m: Moment) => sigmoid(dot(model.w, design(m, model.spec)));

// ---- Data ------------------------------------------------------------------------------------
/** Each game once; where race groups hold different copies, the one with a simulation. */
export function loadGames(groups: string[], meta?: Map<string, { year: number; matchup: string }>): Game[] {
  const games = new Map<string, Game>();
  for (const g of groups) {
    const rp = referencePaths(g);
    if (!existsSync(rp.games)) continue;
    for (const f of readdirSync(rp.games)) {
      const key = f.replace(/\.json$/, "");
      if (games.get(key)?.record.sim?.status === "ok") continue;
      if (meta && !meta.has(key)) continue;
      const r = readRecord(rp, key) as GameRecord | null;
      if (!r) continue;
      const races = r.players.map((p) => p.race).sort((a, b) => "HONU".indexOf(a) - "HONU".indexOf(b));
      games.set(key, { key, record: r, year: meta?.get(key)?.year ?? null, matchup: meta?.get(key)?.matchup ?? races.join("v") });
    }
  }
  return [...games.values()];
}

/** The validation games' year and matchup, from the validation set's database. */
export function validationMeta(): Map<string, { year: number; matchup: string }> {
  const meta = new Map<string, { year: number; matchup: string }>();
  const file = referencePaths(VALIDATION).db;
  if (!existsSync(file)) return meta;
  const db = openDb(file, { readOnly: true });
  try {
    for (const r of db.prepare("SELECT game_key, year, matchup FROM val_games").all() as { game_key: string; year: number; matchup: string }[]) meta.set(r.game_key, r);
  } catch {
    // no validation games yet
  }
  db.close();
  return meta;
}

/** A game with an unreadable number anywhere (a broken simulation) is left out whole. */
export const finiteGames = (ms: Moment[]) => {
  const bad = new Set(ms.filter((m) => m.d.some((v) => !Number.isFinite(v))).map((m) => m.game));
  if (bad.size) console.error(`left out ${bad.size} games with unreadable numbers`);
  return ms.filter((m) => !bad.has(m.game));
};
export const fold = (key: string) => parseInt(key.slice(-2), 16) % FOLDS;

// ---- Scores ----------------------------------------------------------------------------------
export type Pred = Moment & { p: number };
export const predsOn = (model: Model, ms: Moment[]): Pred[] => ms.map((m) => ({ ...m, p: predict(model, m) }));
/** Cross-validation: fit on three quarters of the games, predict the fourth, four times. */
export function crossValidate(ms: Moment[], spec: Spec): Pred[] {
  const out: Pred[] = [];
  for (let f = 0; f < FOLDS; f++) {
    const model = fitModel(ms.filter((m) => fold(m.game) !== f), spec);
    for (const m of ms.filter((m) => fold(m.game) === f)) out.push({ ...m, p: predict(model, m) });
  }
  return out;
}
export const lossOf = (ps: Pred[]) => -ps.reduce((s, r) => s + r.w * Math.log(Math.min(1 - 1e-9, Math.max(1e-9, r.y ? r.p : 1 - r.p))), 0) / ps.reduce((s, r) => s + r.w, 0);
export const brierOf = (ps: Pred[]) => ps.reduce((s, r) => s + r.w * (r.p - r.y) ** 2, 0) / ps.reduce((s, r) => s + r.w, 0);
/** Share of games (one side each) where the favourite at minute m went on to win. */
export const accuracyAt = (ps: Pred[], minute: number) => {
  const t = minute * 60_000;
  const rows = ps.filter((r) => Math.abs(r.t - t) < STEP_MS / 2 && r.y === 1);
  return { n: rows.length, acc: rows.filter((r) => r.p > 0.5).length / rows.length, sure: rows.filter((r) => r.p > 0.8 || r.p < 0.2).length / rows.length };
};
/** A small seeded random number generator (mulberry32), so every run resamples the same way. */
export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Calibration slope: b in P(win) = σ(b · logit p). 1 means honest confidence, below 1 too confident. */
export function calibrationSlope(ps: Pred[]): number {
  let b = 1;
  for (let i = 0; i < 30; i++) {
    let g = 0, h = 0;
    for (const r of ps) {
      const p = Math.min(1 - 1e-9, Math.max(1e-9, r.p)), z = Math.log(p / (1 - p)), q = sigmoid(b * z);
      g += r.w * (q - r.y) * z;
      h += r.w * q * (1 - q) * z * z;
    }
    b -= g / h;
  }
  return b;
}
/** Resampled by game: how sure is a difference in log loss between two models on the same moments? */
export function bootstrapDiff(a: Pred[], b: Pred[], rounds = 400): { lo: number; hi: number } {
  const byGame = new Map<string, number[]>();
  a.forEach((r, i) => (byGame.get(r.game) ?? byGame.set(r.game, []).get(r.game)!).push(i));
  const games = [...byGame.values()];
  const rand = mulberry32(7);
  const diffs: number[] = [];
  for (let k = 0; k < rounds; k++) {
    let la = 0, lb = 0, w = 0;
    for (let g = 0; g < games.length; g++) {
      for (const i of games[Math.floor(rand() * games.length)]) {
        const ra = a[i], rb = b[i];
        la -= ra.w * Math.log(Math.max(1e-9, ra.y ? ra.p : 1 - ra.p));
        lb -= rb.w * Math.log(Math.max(1e-9, rb.y ? rb.p : 1 - rb.p));
        w += ra.w;
      }
    }
    diffs.push((la - lb) / w);
  }
  diffs.sort((x, y) => x - y);
  return { lo: diffs[Math.floor(rounds * 0.025)], hi: diffs[Math.floor(rounds * 0.975)] };
}

// ---- Per-matchup calibration -----------------------------------------------------------------
export const RACES = ["H", "O", "U", "N"];
export type MatchupRow = { matchup: string; minute: number; games: number; said: number; won: number; gap: number; half: number };
/**
 * Per matchup, at each minute, among games still going: what the model said for the first race on
 * average, how often that race won, and the gap (said − won) with its 95% half-width (from the
 * spread of said − won across the games). Mirror matchups take the record's first player: a
 * check that should read 0. The other direction (UvH for HvU) is the same row with every number
 * mirrored, so only one is listed.
 */
export function matchupCalibration(ps: Pred[], minutes = [5, 10, 15, 20]): MatchupRow[] {
  const rows: MatchupRow[] = [];
  for (let i = 0; i < RACES.length; i++) {
    for (let j = i; j < RACES.length; j++) {
      for (const minute of minutes) {
        const t = minute * 60_000;
        const at = ps.filter((r) => Math.abs(r.t - t) < STEP_MS / 2 && r.races[0] === RACES[i] && r.races[1] === RACES[j] && (i !== j || r.first));
        const n = at.length;
        if (!n) continue;
        const said = at.reduce((s, r) => s + r.p, 0) / n, won = at.reduce((s, r) => s + r.y, 0) / n;
        const gap = said - won;
        const sd = Math.sqrt(at.reduce((s, r) => s + (r.p - r.y - gap) ** 2, 0) / Math.max(1, n - 1));
        rows.push({ matchup: `${RACES[i]}v${RACES[j]}`, minute, games: n, said, won, gap, half: (1.96 * sd) / Math.sqrt(n) });
      }
    }
  }
  return rows;
}
