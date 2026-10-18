// Small helpers over a game's simulated series, shared by the fact sheet and the findings.
import type { GameRecord, PlayerRecord, SimSample } from "@replay-altar/core/ui";

export const STEP_MS = 120_000;

export const mmss = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The sample in effect at t (series are 10-second step samples). */
export const at = (series: SimSample[], t: number) => series.filter((s) => s.t <= t).at(-1);

export const seriesOf = (r: GameRecord, p: PlayerRecord) => (r.sim?.status === "ok" ? (r.sim.players.find((x) => x.playerId === p.playerId)?.series ?? []) : []);

/** Sum of a player's hero levels at t. */
export const levelSum = (p: PlayerRecord, t: number) => p.heroes.reduce((n, h) => n + h.levelUps.filter((x) => x <= t).length, 0);

/** Resources a player lost between two times (from the cumulative loss series). */
export const lostBetween = (series: SimSample[], from: number, to: number) => {
  const a = at(series, from);
  const b = at(series, to);
  return b ? b.goldLost + b.lumberLost - (a ? a.goldLost + a.lumberLost : 0) : 0;
};

/** Every 2 minutes, plus the end of the game. */
export function sampleTimes(durationMs: number): number[] {
  const times: number[] = [];
  for (let t = STEP_MS; t < durationMs; t += STEP_MS) times.push(t);
  times.push(durationMs);
  return times;
}

export type Sampled = { t: number; me: number; opp: number };

export function sampleBoth(r: GameRecord, me: PlayerRecord, opp: PlayerRecord, f: (s: SimSample) => number): Sampled[] {
  const sm = seriesOf(r, me);
  const so = seriesOf(r, opp);
  return sampleTimes(r.game.durationMs).flatMap((t) => {
    const a = at(sm, t);
    const b = at(so, t);
    return a && b ? [{ t, me: f(a), opp: f(b) }] : [];
  });
}

/** "you led 4:00–16:00, opp led 18:00–24:25" from samples (ties extend the current leader). */
export function leads(rows: Sampled[]): string {
  const spans: { who: string; from: number; to: number }[] = [];
  for (const r of rows) {
    const who = r.me > r.opp ? "you" : r.opp > r.me ? "opp" : spans.at(-1)?.who ?? "even";
    const last = spans.at(-1);
    if (last && last.who === who) last.to = r.t;
    else spans.push({ who, from: r.t, to: r.t });
  }
  return spans.map((x) => `${x.who} ${x.who === "even" ? "" : "led "}${mmss(x.from)}${x.to > x.from ? `–${mmss(x.to)}` : ""}`).join(", ");
}

/** Resources each side lost in each detected fight (10 s margin on both ends). */
export function fightLosses(r: GameRecord, me: PlayerRecord, opp: PlayerRecord) {
  if (r.sim?.status !== "ok") return [];
  const sm = seriesOf(r, me);
  const so = seriesOf(r, opp);
  return (r.sim.fights ?? []).map((f) => ({ f, me: lostBetween(sm, f.start - 10_000, f.end + 10_000), opp: lostBetween(so, f.start - 10_000, f.end + 10_000) }));
}

/**
 * The longest stretch (up to 10:00, where the income estimate is reported) in which a player
 * trained no army unit although they could: ≈300+ gold in the bank, not supply blocked, under 80
 * food. Counted from the first army unit; seconds, with when and the average bank.
 */
export function productionGap(r: GameRecord, p: PlayerRecord, worker: string, untilMs = 600_000) {
  const series = seriesOf(r, p);
  const orders = p.build.filter((b) => b.kind === "unit" && b.code !== worker && !/^[A-Z]/.test(b.code)).map((b) => b.ms);
  const end = Math.min(untilMs, r.game.durationMs);
  if (!series.length || !orders.length || orders[0] >= end) return null;
  let best = { s: 0, from: 0, to: 0, bank: 0 };
  let run: { from: number; to: number; banks: number[] } | null = null;
  for (const s of series) {
    if (s.t < orders[0] || s.t > end) continue;
    const ordered = orders.some((t) => t > s.t - 10_000 && t <= s.t);
    const could = s.estGoldBank >= 300 && s.foodUsed < s.foodMax - 1 && s.foodUsed < 80;
    if (could && !ordered) {
      run ??= { from: s.t, to: s.t, banks: [] };
      run.to = s.t;
      run.banks.push(s.estGoldBank);
    } else run = null;
    if (run && (run.to - run.from) / 1000 > best.s) best = { s: (run.to - run.from) / 1000, from: run.from, to: run.to, bank: run.banks.reduce((a, b) => a + b, 0) / run.banks.length };
  }
  return best;
}
