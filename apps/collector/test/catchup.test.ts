// W3Champions statistics caught up at start: the later tries (10 min, 1 h) lived only in the
// collector's memory and were lost when it went back to waiting or stopped.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { applyOfficial, DEFAULT_CONFIG, ingestFile, openDb, paths, type OfficialStats } from "@replay-altar/core";
import { CATCH_UP_MS, OfficialQueue, PoliteQueue, type Outcome } from "../src/officialqueue.ts";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/replays");
const have = [1, 2, 3, 4, 5].every((i) => existsSync(join(FIXTURES, `replay${i}.w3g`)));
const MIN = 60_000;

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.REPLAY_ALTAR_DATA;
  process.env.REPLAY_ALTAR_DATA = mkdtempSync(join(tmpdir(), "ra-catchup-"));
});
afterEach(() => {
  if (saved === undefined) delete process.env.REPLAY_ALTAR_DATA;
  else process.env.REPLAY_ALTAR_DATA = saved;
});

describe.skipIf(!have)("catch-up at start", () => {
  test("recent W3Champions games still without statistics are looked up again, each when its next try is due", async () => {
    const p = paths();
    const db = openDb(p.db);
    const ctx = { db, config: { ...DEFAULT_CONFIG, accounts: ["Pedrovisk#1486"] }, paths: p };
    const inbox = join(p.root, "inbox");
    mkdirSync(inbox);
    const keys: string[] = [];
    for (let i = 1; i <= 5; i++) {
      copyFileSync(join(FIXTURES, `replay${i}.w3g`), join(inbox, `r${i}.w3g`));
      const out = await ingestFile(ctx, join(inbox, `r${i}.w3g`));
      if (out.status !== "new") throw new Error(out.status);
      keys.push(out.record.gameKey);
    }
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const missing = (attempts: number, at: number): OfficialStats => ({ status: "missing", source: "w3champions", fetchedAt: iso(at), attempts, reason: "not found" });
    // 1: never looked up (the collector stopped within the first 90 s), ended 2 h ago.
    // 2: first try missed 15 min ago: the second (10 min later) is due now.
    // 3: first try missed 1 min ago: the second is due in 9 min.
    // 4: three tries already: no more. 5: found.
    applyOfficial(ctx, keys[1], missing(1, now - 15 * MIN));
    applyOfficial(ctx, keys[2], missing(1, now - 1 * MIN));
    applyOfficial(ctx, keys[3], missing(3, now - 60 * MIN));
    applyOfficial(ctx, keys[4], { status: "ok", source: "w3champions", matchId: "m", fetchedAt: iso(now), players: [] });
    const ended = [now - 120 * MIN, now - 17 * MIN, now - 3 * MIN, now - 3 * 60 * MIN, now - 10 * MIN];
    keys.forEach((k, i) => db.prepare("UPDATE games SET source = 'w3champions', analyzed = 1, ended_at = ? WHERE game_key = ?").run(iso(ended[i]), k));

    const q = new OfficialQueue(ctx, () => {});
    const added: [string, number, number][] = [];
    const queue = (q as unknown as { queue: PoliteQueue }).queue;
    queue.add = (key: string, attempt = 0, at = 0) => void added.push([key, attempt, at - now]);
    expect(q.catchUp(now)).toBe(3);
    expect(added.sort((a, b) => a[2] - b[2])).toEqual([
      [keys[0], 0, 0],
      [keys[1], 1, 0],
      [keys[2], 1, 9 * MIN],
    ]);

    // Older than the catch-up window: left alone (its tries were used up long ago, or it never had any).
    db.prepare("UPDATE games SET ended_at = ? WHERE game_key = ?").run(iso(now - CATCH_UP_MS - MIN), keys[0]);
    added.length = 0;
    expect(q.catchUp(now)).toBe(2);
    expect(added.map(([k]) => k)).not.toContain(keys[0]);
  });
});

describe("the line the catch-up joins", () => {
  test("games due now go one at a time, the usual spacing apart, and a 429 pauses everyone", async () => {
    vi.useFakeTimers();
    const opts = { retryDelays: [90_000, 600_000, 3_600_000], between: 5_000, slowDown: 3_600_000 };
    const calls: [string, number][] = [];
    let running = 0;
    let most = 0;
    let slowDowns = 1;
    const q = new PoliteQueue(async (key) => {
      calls.push([key, Date.now()]);
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, 1_000));
      running--;
      return (key === "b" && slowDowns-- > 0 ? "slow-down" : "done") as Outcome;
    }, opts);
    const t0 = Date.now();
    q.add("a", 0, t0);
    q.add("b", 1, t0);
    q.add("c", 2, t0);
    await vi.advanceTimersByTimeAsync(2 * 3_600_000);
    expect(most).toBe(1);
    expect(calls.map(([k, t]) => [k, t - t0])).toEqual([
      ["a", 0],
      ["b", 6_000],
      ["c", 7_000 + 3_600_000], // after the pause the 429 asked for
      ["b", 7_000 + 3_600_000 + 6_000],
    ]);
    vi.useRealTimers();
  });
});
