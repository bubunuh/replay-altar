// Fetches the game's own end-of-game stats from W3Champions for your new W3C games, one game at a
// time. W3Champions lists a match a little after the replay appears, so a game that just ended is
// tried after 90 s, then later. A first import can bring hundreds of old W3C games: they wait in
// the same line, a few seconds apart, and get one try each (an old match that isn't found now
// won't appear later). The later tries live only in this process: when the collector goes back to
// waiting or stops, the next start looks up again the recent games still missing them (catchUp).
// The match also says who won: from 0.2.5 that is your W3Champions games' result (core official.ts),
// "Reviewing" until it is found, "Unknown" once the last try missed.
import { applyOfficial, readRecord, w3cResultDone, type IngestContext, type OfficialStats } from "@replay-altar/core";
import { officialForMatch, officialForOwnGame, RateLimited, w3cClient } from "@replay-altar/reference";

const RETRY_DELAYS_MS = [90_000, 10 * 60_000, 60 * 60_000];
/** Pause after each game's lookup (each is 2-6 requests, themselves 1.5 s apart). */
const BETWEEN_GAMES_MS = 5_000;
/** W3Champions said "slow down" (429) or kept failing: wait this long before the next lookup. */
const SLOW_DOWN_MS = 60 * 60_000;
/** Games that ended this recently are retried when not found; older ones get one try. */
const RECENT_MS = 6 * 60 * 60_000;
/** At start, games that ended this recently and still lack their statistics are looked up again. */
export const CATCH_UP_MS = 3 * 24 * 60 * 60_000;

/** What a lookup asks of the line: nothing more, another try later, or a long pause for everyone. */
export type Outcome = "done" | "retry" | "slow-down";
type Job = { key: string; attempt: number; at: number };

/** One job at a time, in order of due time, with a pause between jobs. */
export class PoliteQueue {
  private jobs: Job[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private busy = false;
  private notBefore = 0;

  private run: (key: string, attempt: number) => Promise<Outcome>;
  private opts: { retryDelays: number[]; between: number; slowDown: number };

  constructor(run: (key: string, attempt: number) => Promise<Outcome>, opts = { retryDelays: RETRY_DELAYS_MS, between: BETWEEN_GAMES_MS, slowDown: SLOW_DOWN_MS }) {
    this.run = run;
    this.opts = opts;
  }

  /** `at`: when it is due (default: the attempt's delay from now). */
  add(key: string, attempt = 0, at = Date.now() + (this.opts.retryDelays[attempt] ?? 0)) {
    if (attempt >= this.opts.retryDelays.length || this.jobs.some((j) => j.key === key)) return;
    this.jobs.push({ key, attempt, at });
    this.schedule();
  }

  /** The delay before an attempt (after the game ended for the first, after the last try for the others). */
  delay(attempt: number) {
    return this.opts.retryDelays[attempt] ?? 0;
  }

  get attempts() {
    return this.opts.retryDelays.length;
  }

  get pending() {
    return this.jobs.length;
  }

  private schedule() {
    if (this.busy || this.jobs.length === 0) return;
    const next = Math.max(Math.min(...this.jobs.map((j) => j.at)), this.notBefore);
    // A game due sooner than the one waited for (a new game while another waits 10 min for its
    // next try): the wait is shortened.
    if (this.timer) {
      if (this.timerAt <= next) return;
      clearTimeout(this.timer);
    }
    this.timerAt = next;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runNext();
    }, Math.max(0, next - Date.now()));
  }

  private async runNext() {
    const now = Date.now();
    const job = this.jobs.filter((j) => j.at <= now).sort((a, b) => a.at - b.at)[0];
    if (!job) return this.schedule();
    this.jobs.splice(this.jobs.indexOf(job), 1);
    this.busy = true;
    let outcome: Outcome = "done";
    try {
      outcome = await this.run(job.key, job.attempt);
    } finally {
      this.busy = false;
      if (outcome === "slow-down") {
        // Nobody asks before the pause is over; this game's try goes back in line.
        this.notBefore = Date.now() + this.opts.slowDown;
        this.jobs.push({ ...job, at: this.notBefore });
      } else {
        this.notBefore = Date.now() + this.opts.between;
        if (outcome === "retry") this.add(job.key, job.attempt + 1);
      }
      this.schedule();
    }
  }
}

export class OfficialQueue {
  private ctx: IngestContext;
  private log: (msg: string) => void;
  private client = w3cClient();
  private queue = new PoliteQueue((key, attempt) => this.lookup(key, attempt));

  constructor(ctx: IngestContext, log: (msg: string) => void) {
    this.ctx = ctx;
    this.log = log;
  }

  /** Schedule a lookup for a W3Champions game (no-op for others or when already fetched). */
  add(gameKey: string) {
    this.queue.add(gameKey);
  }

  /**
   * At start, in the same line (one lookup at a time, the same spacing and pause on a 429), newest
   * first, your W3Champions games that don't know who won yet:
   * - never looked up (the collector stopped before, or the lookups were off): due now;
   * - statistics from before 0.2.5, without the winner: the match again, due now;
   * - not found before 0.2.5: one more try, due now;
   * - not found, tries left, ended in the last CATCH_UP_MS: when the next try would have been;
   * - not found and too old for more tries: given up here (Unknown), without asking.
   * Returns how many were queued.
   */
  catchUp(now = Date.now()): number {
    // "Reviewing" is what each start (settleW3cResults) and each save make of a game without its winner.
    const rows = this.ctx.db.prepare("SELECT game_key, ended_at FROM games WHERE source = 'w3champions' AND analyzed = 1 AND result_detected = 'reviewing' ORDER BY ended_at DESC").all() as { game_key: string; ended_at: string }[];
    let n = 0;
    for (const row of rows) {
      const official = readRecord(this.ctx.paths, row.game_key)?.official;
      if (w3cResultDone(official)) continue;
      const due = (attempt: number, at = now) => {
        this.queue.add(row.game_key, attempt, at);
        n++;
      };
      if (!official || official.status === "ok") due(0);
      else if (official.final === undefined) due(Math.min(official.attempts, this.queue.attempts - 1));
      else if (official.attempts < this.queue.attempts && Date.parse(row.ended_at) >= now - CATCH_UP_MS) due(official.attempts, Math.max(now, Date.parse(official.fetchedAt) + this.queue.delay(official.attempts)));
      else applyOfficial(this.ctx, row.game_key, { ...official, final: true });
    }
    return n;
  }

  private async lookup(gameKey: string, attempt: number): Promise<Outcome> {
    const record = readRecord(this.ctx.paths, gameKey);
    if (!record || record.classification.source !== "w3champions" || w3cResultDone(record.official)) return "done";
    const recent = Date.now() - Date.parse(record.game.endedAt) < RECENT_MS;
    // Not found now: the last try, or a game too old to be listed later.
    const final = !recent || attempt + 1 >= this.queue.attempts;
    try {
      const before = record.official;
      let off: OfficialStats;
      if (before?.status === "ok") {
        // Statistics from before 0.2.5: only who won is missing, and the match is known.
        const again = await officialForMatch(this.client, before.matchId, record);
        off = again.status === "ok" ? again : { ...before, final };
      } else {
        const found = await officialForOwnGame(this.client, record, attempt);
        off = found.status === "ok" ? found : { ...found, final };
      }
      // Found, but without a winner (not expected): no better on the next try than now.
      if (off.status === "ok" && !w3cResultDone(off)) off = { ...off, final };
      applyOfficial(this.ctx, gameKey, off);
      if (off.status === "ok" && w3cResultDone(off)) this.log(`official stats for ${gameKey.slice(0, 8)} (W3C match ${off.matchId})`);
      return w3cResultDone(off) ? "done" : "retry";
    } catch (e) {
      this.log(`official stats for ${gameKey.slice(0, 8)} failed: ${(e as Error).message}`);
      if (e instanceof RateLimited) return "slow-down";
      return recent ? "retry" : "done";
    }
  }
}
