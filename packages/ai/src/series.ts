// Small helpers over a game's simulated series, shared by the fact sheet and the findings.
import type { GameRecord, PlayerRecord, SimFight, SimSample } from "@replay-altar/core/ui";

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

/** Loss bursts: losses with gaps under 30 s between them, as [start, end, value]. */
function lossBursts(series: SimSample[]): { start: number; end: number; value: number }[] {
  const out: { start: number; end: number; value: number }[] = [];
  for (let i = 1; i < series.length; i++) {
    const d = series[i].goldLost + series[i].lumberLost - (series[i - 1].goldLost + series[i - 1].lumberLost);
    if (d <= 0) continue;
    const last = out.at(-1);
    if (last && series[i].t - last.end <= 30_000) {
      last.end = series[i].t;
      last.value += d;
    } else out.push({ start: series[i - 1].t, end: series[i].t, value: d });
  }
  return out;
}

/** A burst of losses this large with no battle detected around it counts as a fight too. */
const UNSEEN_FIGHT_MIN = 600;

/**
 * Resources each side lost in each fight, from the loss series (10 s margin on both ends). Large
 * loss bursts away from any detected battle are added as "unseen" fights: the simulation infers
 * many deaths from units that stop moving, some time after the battle it saw.
 */
export function fightLosses(r: GameRecord, me: PlayerRecord, opp: PlayerRecord) {
  if (r.sim?.status !== "ok") return [];
  const sm = seriesOf(r, me);
  const so = seriesOf(r, opp);
  const fights = r.sim.fights ?? [];
  // WC3V's battle summaries estimate losses too, but taking them made the fights rule fire in
  // more pro wins (holdout lift 1.9 -> 1.5); only their hero kills are used (report.ts).
  const seen = fights.map((f) => ({ f, me: lostBetween(sm, f.start - 10_000, f.end + 10_000), opp: lostBetween(so, f.start - 10_000, f.end + 10_000) }));
  // Same 10 s margin as the losses counted for a detected fight, so a later burst isn't lost.
  const near = (b: { start: number; end: number }) => fights.some((f) => b.start <= f.end + 10_000 && b.end >= f.start - 10_000);
  const bursts = [...lossBursts(sm), ...lossBursts(so)].filter((b) => b.value >= UNSEEN_FIGHT_MIN && !near(b)).sort((a, b) => a.start - b.start);
  const unseen: typeof seen = [];
  for (const b of bursts) {
    const last = unseen.at(-1);
    if (last && b.start <= last.f.end + 30_000) {
      last.f.end = Math.max(last.f.end, b.end);
      last.me = lostBetween(sm, last.f.start - 10_000, last.f.end + 10_000);
      last.opp = lostBetween(so, last.f.start - 10_000, last.f.end + 10_000);
      continue;
    }
    const f: SimFight = { start: b.start, end: b.end, category: "unseen-fight", initiatorId: null, playerIds: [me.playerId, opp.playerId], involvesHero: false, involvesAir: false };
    unseen.push({ f, me: lostBetween(sm, b.start - 10_000, b.end + 10_000), opp: lostBetween(so, b.start - 10_000, b.end + 10_000) });
  }
  return [...seen, ...unseen].sort((a, b) => a.f.start - b.f.start);
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

/** A fight's category in words. */
export const fightLabel = (category: string) => (category === "unseen-fight" ? "fight (inferred from units lost)" : category.replace(/-/g, " "));
