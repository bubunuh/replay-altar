// Fetches the game's own end-of-game stats from W3Champions for your new W3C games.
// W3Champions lists a match a little after the replay appears, so try after 90 s, then later.
import { applyOfficial, readRecord, type IngestContext } from "@w3stats/core";
import { officialForOwnGame, w3cClient } from "@w3stats/reference";

const RETRY_DELAYS_MS = [90_000, 10 * 60_000, 60 * 60_000];

export class OfficialQueue {
  private ctx: IngestContext;
  private log: (msg: string) => void;
  private client = w3cClient();

  constructor(ctx: IngestContext, log: (msg: string) => void) {
    this.ctx = ctx;
    this.log = log;
  }

  /** Schedule a lookup for a W3Champions game (no-op for others or when already fetched). */
  add(gameKey: string, attempt = 0) {
    if (attempt >= RETRY_DELAYS_MS.length) return;
    setTimeout(() => void this.run(gameKey, attempt), RETRY_DELAYS_MS[attempt]);
  }

  private async run(gameKey: string, attempt: number) {
    const record = readRecord(this.ctx.paths, gameKey);
    if (!record || record.classification.source !== "w3champions" || record.official?.status === "ok") return;
    try {
      const off = await officialForOwnGame(this.client, record, attempt);
      applyOfficial(this.ctx, gameKey, off);
      if (off.status === "ok") this.log(`official stats for ${gameKey.slice(0, 8)} (W3C match ${off.matchId})`);
      else this.add(gameKey, attempt + 1);
    } catch (e) {
      this.log(`official stats for ${gameKey.slice(0, 8)} failed: ${(e as Error).message}`);
      this.add(gameKey, attempt + 1);
    }
  }
}
