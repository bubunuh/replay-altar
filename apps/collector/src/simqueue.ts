// Runs game simulations one at a time, after the fast analysis has been stored and announced.
import { applySim, readRecord, warcraftFolders, type IngestContext } from "@replay-altar/core";
import { simulateGame } from "@replay-altar/sim";

export class SimQueue {
  private queue: string[] = [];
  private running = false;
  private ctx: IngestContext;
  private log: (msg: string) => void;

  constructor(ctx: IngestContext, log: (msg: string) => void) {
    this.ctx = ctx;
    this.log = log;
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

  get pending() {
    return this.queue.length + (this.running ? 1 : 0);
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      for (let key = this.queue.shift(); key; key = this.queue.shift()) {
        const record = readRecord(this.ctx.paths, key);
        if (!record) continue;
        const sim = await simulateGame(record, { dataRoot: this.ctx.paths.root, warcraftDocuments: warcraftFolders(this.ctx.config) });
        applySim(this.ctx, key, sim);
        this.log(sim.status === "ok" ? `simulated ${key.slice(0, 8)} in ${(sim.runMs / 1000).toFixed(1)}s` : `simulation failed for ${key.slice(0, 8)}: ${sim.reason}`);
      }
    } finally {
      this.running = false;
    }
  }
}
