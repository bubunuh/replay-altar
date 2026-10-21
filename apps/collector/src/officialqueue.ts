// Fetches the game's own end-of-game stats from W3Champions for your new W3C games, one game at a
// time. W3Champions lists a match a little after the replay appears, so a game that just ended is
// tried after 90 s, then later. A first import can bring hundreds of old W3C games: they wait in
// the same line, a few seconds apart, and get one try each (an old match that isn't found now
// won't appear later).
import { applyOfficial, readRecord, type IngestContext } from "@replay-altar/core";
import { officialForOwnGame, RateLimited, w3cClient } from "@replay-altar/reference";

const RETRY_DELAYS_MS = [90_000, 10 * 60_000, 60 * 60_000];
/** Pause after each game's lookup (each is 2-6 requests, themselves 1.5 s apart). */
const BETWEEN_GAMES_MS = 5_000;
/** W3Champions said "slow down" (429) or kept failing: wait this long before the next lookup. */
const SLOW_DOWN_MS = 60 * 60_000;
/** Games that ended this recently are retried when not found; older ones get one try. */
const RECENT_MS = 6 * 60 * 60_000;

/** What a lookup asks of the line: nothing more, another try later, or a long pause for everyone. */
export type Outcome = "done" | "retry" | "slow-down";
type Job = { key: string; attempt: number; at: number };

/** One job at a time, in order of due time, with a pause between jobs. */
export class PoliteQueue {
  private jobs: Job[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private notBefore = 0;

  private run: (key: string, attempt: number) => Promise<Outcome>;
  private opts: { retryDelays: number[]; between: number; slowDown: number };

  constructor(run: (key: string, attempt: number) => Promise<Outcome>, opts = { retryDelays: RETRY_DELAYS_MS, between: BETWEEN_GAMES_MS, slowDown: SLOW_DOWN_MS }) {
    this.run = run;
    this.opts = opts;
  }

  add(key: string, attempt = 0) {
    if (attempt >= this.opts.retryDelays.length || this.jobs.some((j) => j.key === key)) return;
    this.jobs.push({ key, attempt, at: Date.now() + this.opts.retryDelays[attempt] });
    this.schedule();
  }

  get pending() {
    return this.jobs.length;
  }

  private schedule() {
    if (this.busy || this.timer || this.jobs.length === 0) return;
    const next = Math.max(Math.min(...this.jobs.map((j) => j.at)), this.notBefore);
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

  private async lookup(gameKey: string, attempt: number): Promise<Outcome> {
    const record = readRecord(this.ctx.paths, gameKey);
    if (!record || record.classification.source !== "w3champions" || record.official?.status === "ok") return "done";
    const recent = Date.now() - Date.parse(record.game.endedAt) < RECENT_MS;
    try {
      const off = await officialForOwnGame(this.client, record, attempt);
      applyOfficial(this.ctx, gameKey, off);
      if (off.status === "ok") this.log(`official stats for ${gameKey.slice(0, 8)} (W3C match ${off.matchId})`);
      return off.status === "ok" || !recent ? "done" : "retry";
    } catch (e) {
      this.log(`official stats for ${gameKey.slice(0, 8)} failed: ${(e as Error).message}`);
      if (e instanceof RateLimited) return "slow-down";
      return recent ? "retry" : "done";
    }
  }
}
