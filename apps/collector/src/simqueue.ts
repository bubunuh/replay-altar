// Runs game simulations one at a time, after the fast analysis has been stored and announced.
import { applySim, mapFolders, readRecord, type IngestContext } from "@replay-altar/core";
import { simulateGame } from "@replay-altar/sim";
import { builtinMap } from "./gamedata.ts";

export class SimQueue {
  private queue: string[] = [];
  private running = false;
  /** Since the queue was last empty: games simulated and their total time. */
  private done = 0;
  private totalMs = 0;
  private ctx: IngestContext;
  private log: (msg: string) => void;
  /** True while simulations must wait (Warcraft III is running): resume() when it's over. */
  private held: () => boolean;

  constructor(ctx: IngestContext, log: (msg: string) => void, held: () => boolean = () => false) {
    this.ctx = ctx;
    this.log = log;
    this.held = held;
  }

  /** Simulate what waited while held. */
  resume() {
    void this.drain();
  }

  add(gameKey: string) {
    if (!this.queue.includes(gameKey)) this.queue.push(gameKey);
    void this.drain();
  }

  /** Analyzed games that were never simulated (e.g. archived before the simulation existed). */
  backfill() {
    const rows = this.ctx.db.prepare("SELECT game_key FROM games WHERE analyzed = 1 AND sim_status IS NULL ORDER BY played_at DESC").all() as { game_key: string }[];
    for (const r of rows) this.add(r.game_key);
    if (rows.length) this.log(`queued ${rows.length} game(s) for simulation`);
  }

  /** Games whose simulation failed with a reason matching `reason`, simulated again. */
  retryFailed(reason: RegExp) {
    const rows = this.ctx.db.prepare("SELECT game_key, sim_reason FROM games WHERE analyzed = 1 AND sim_status = 'failed' ORDER BY played_at DESC").all() as { game_key: string; sim_reason: string | null }[];
    const again = rows.filter((r) => reason.test(r.sim_reason ?? ""));
    for (const r of again) this.add(r.game_key);
    if (again.length) this.log(`simulating ${again.length} failed game(s) again`);
  }

  get pending() {
    return this.queue.length + (this.running ? 1 : 0);
  }

  /** For the progress bar: null when idle. */
  get progress() {
    const pending = this.pending;
    if (!pending || (!this.running && this.held())) return null; // waiting for the match to end
    return { done: this.done, total: this.done + pending, avgMs: this.done ? Math.round(this.totalMs / this.done) : null };
  }

  private async drain() {
    if (this.running || this.held()) return;
    this.running = true;
    try {
      // The one running when a hold begins finishes; the rest wait for resume().
      for (let key = this.queue.shift(); key; key = this.held() ? undefined : this.queue.shift()) {
        const record = readRecord(this.ctx.paths, key);
        if (!record) continue;
        const sim = await simulateGame(record, { dataRoot: this.ctx.paths.root, mapFolders: mapFolders(this.ctx.config), fromGame: builtinMap });
        applySim(this.ctx, key, sim);
        this.done++;
        if (sim.status === "ok") this.totalMs += sim.runMs;
        this.log(sim.status === "ok" ? `simulated ${key.slice(0, 8)} in ${(sim.runMs / 1000).toFixed(1)}s` : `simulation failed for ${key.slice(0, 8)}: ${sim.reason}`);
      }
    } finally {
      this.running = false;
      this.done = 0;
      this.totalMs = 0;
    }
  }
}
