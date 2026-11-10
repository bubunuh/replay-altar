// W3Champions statistics caught up at start: the later tries (10 min, 1 h) lived only in the
// collector's memory and were lost when it went back to waiting or stopped.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { applyOfficial, DEFAULT_CONFIG, ingestFile, openDb, paths, readRecord, type OfficialStats } from "@replay-altar/core";
import type { W3cClient, W3cMatch, W3cScore } from "@replay-altar/reference";
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
  test("W3Champions games still reviewing are looked up, newest first, each when its next try is due", async () => {
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
    const missing = (attempts: number, at: number, final?: boolean): OfficialStats => ({ status: "missing", source: "w3champions", fetchedAt: iso(at), attempts, reason: "not found", ...(final === undefined ? {} : { final }) });
    const stats = (won?: boolean): OfficialStats => ({ status: "ok", source: "w3champions", matchId: "m", fetchedAt: iso(now), players: [{ playerId: 1, battleTag: "a", unitsProduced: 0, unitsKilled: 0, largestArmy: 0, heroesKilled: 0, itemsObtained: 0, mercsHired: 0, expGained: 0, goldCollected: 0, lumberCollected: 0, goldUpkeepLost: 0, ...(won === undefined ? {} : { won }) }] });
    // 0: never looked up (the collector stopped within the first 90 s, or the lookups were off).
    // 1: first try missed 15 min ago: the second (10 min later) is due now.
    // 2: first try missed 1 min ago: the second is due in 9 min.
    // 3: three tries before 0.2.5 (no "final"): one more. 4: statistics from before 0.2.5, no winner: the match again.
    applyOfficial(ctx, keys[1], missing(1, now - 15 * MIN, false));
    applyOfficial(ctx, keys[2], missing(1, now - 1 * MIN, false));
    applyOfficial(ctx, keys[3], missing(3, now - 60 * MIN));
    applyOfficial(ctx, keys[4], stats());
    const ended = [now - 120 * MIN, now - 17 * MIN, now - 3 * MIN, now - 30 * 24 * 60 * MIN, now - 10 * MIN];
    // The fixtures aren't all W3Champions games: what the start (settleW3cResults) makes of these.
    keys.forEach((k, i) => db.prepare("UPDATE games SET source = 'w3champions', analyzed = 1, result_detected = 'reviewing', ended_at = ? WHERE game_key = ?").run(iso(ended[i]), k));

    const q = new OfficialQueue(ctx, () => {});
    const added: [string, number, number][] = [];
    const queue = (q as unknown as { queue: PoliteQueue }).queue;
    queue.add = (key: string, attempt = 0, at = 0) => void added.push([key, attempt, at - now]);
    expect(q.catchUp(now)).toBe(5);
    expect(added).toEqual([
      [keys[2], 1, 9 * MIN], // newest first
      [keys[4], 0, 0],
      [keys[1], 1, 0],
      [keys[0], 0, 0],
      [keys[3], 2, 0], // an old game too: its last try
    ]);

    // Found with the winner: done. Not found, tries left but older than the catch-up window: given
    // up (final, so Unknown), without asking. Not reviewing: not looked at.
    applyOfficial(ctx, keys[4], stats(true));
    db.prepare("UPDATE games SET ended_at = ? WHERE game_key = ?").run(iso(now - CATCH_UP_MS - MIN), keys[1]);
    db.prepare("UPDATE games SET result_detected = 'reviewing' WHERE game_key IN (?, ?)").run(keys[1], keys[4]);
    db.prepare("UPDATE games SET result_detected = 'win' WHERE game_key = ?").run(keys[0]);
    added.length = 0;
    expect(q.catchUp(now)).toBe(2);
    expect(added.map(([k]) => k)).toEqual([keys[2], keys[3]]);
    expect(readRecord(p, keys[1])!.official).toMatchObject({ status: "missing", attempts: 1, final: true });
  });
});

describe("the line the catch-up joins", () => {
  test("a game due sooner than the one waited for doesn't wait for it", async () => {
    vi.useFakeTimers();
    const calls: [string, number][] = [];
    const q = new PoliteQueue(async (key) => (calls.push([key, Date.now()]), "done" as Outcome), { retryDelays: [90_000, 600_000, 3_600_000], between: 5_000, slowDown: 3_600_000 });
    const t0 = Date.now();
    q.add("waiting", 1); // its second try, in 10 min
    await vi.advanceTimersByTimeAsync(60_000);
    q.add("new"); // a game that just ended: 90 s from now
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(calls.map(([k, t]) => [k, t - t0])).toEqual([
      ["new", 150_000],
      ["waiting", 600_000],
    ]);
    vi.useRealTimers();
  });

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

describe.skipIf(!have)("a lookup sets who won", () => {
  /** replay1 (a W3Champions 1v1 of Pedrovisk#1486) as the collector stores it, ended `agoMs` ago. */
  async function game(agoMs: number) {
    const p = paths();
    const ctx = { db: openDb(p.db), config: { ...DEFAULT_CONFIG, accounts: ["Pedrovisk#1486"] }, paths: p, w3cResults: "lookup" as const };
    mkdirSync(join(p.root, "inbox"), { recursive: true });
    copyFileSync(join(FIXTURES, "replay1.w3g"), join(p.root, "inbox/r1.w3g"));
    const out = await ingestFile(ctx, join(p.root, "inbox/r1.w3g"));
    if (out.status !== "new") throw new Error(out.status);
    const r = out.record;
    // As if it had just been played.
    const endedAt = Date.now() - agoMs;
    r.game.endedAt = new Date(endedAt).toISOString();
    r.game.playedAt = new Date(endedAt - r.game.durationMs).toISOString();
    writeFileSync(join(p.games, `${r.gameKey}.json`), JSON.stringify(r));
    const me = r.players.find((x) => x.isMe)!;
    const opp = r.players.find((x) => !x.isMe)!;
    const match = (id: string): W3cMatch => ({
      id, map: "x", startTime: r.game.playedAt, durationInSeconds: 600, gateWay: 20, season: 25, gameMode: 1,
      teams: [{ won: true, players: [{ battleTag: me.name, race: 1, oldMmr: 1500, won: true }] }, { won: false, players: [{ battleTag: opp.name, race: 2, oldMmr: 1500, won: false }] }],
    });
    const score = (battleTag: string): W3cScore => ({ battleTag, unitScore: { unitsProduced: 1, unitsKilled: 1, largestArmy: 1 }, heroScore: { heroesKilled: 0, itemsObtained: 0, mercsHired: 0, expGained: 1 }, resourceScore: { goldCollected: 1, lumberCollected: 1, goldUpkeepLost: 0 } });
    const calls: string[] = [];
    let listed = true;
    const client: W3cClient = {
      currentSeason: async () => 25,
      listMatches: async () => ({ count: 0, matches: [] }),
      downloadReplay: async () => null,
      searchPlayerMatches: async (q) => (calls.push(`search ${q.gateway} ${q.season}`), listed && q.gateway === 20 && q.season === 25 ? [match("found")] : []),
      matchDetail: async (id) => (calls.push(`match ${id}`), { match: match(id), playerScores: [score(me.name), score(opp.name)] }),
    };
    const q = new OfficialQueue(ctx, () => {});
    (q as unknown as { client: W3cClient }).client = client;
    const lookup = (attempt: number) => (q as unknown as { lookup: (k: string, a: number) => Promise<Outcome> }).lookup(r.gameKey, attempt);
    const result = () => (ctx.db.prepare("SELECT result FROM v_games WHERE game_key = ?").get(r.gameKey) as { result: string }).result;
    return { ctx, key: r.gameKey, calls, lookup, result, unlist: () => (listed = false) };
  }

  test("found: W3Champions' winner", async () => {
    const g = await game(2 * MIN);
    expect(g.result()).toBe("reviewing");
    expect(await g.lookup(0)).toBe("done");
    expect(g.result()).toBe("win");
    expect(readRecord(paths(), g.key)!.official).toMatchObject({ status: "ok", matchId: "found" });
  });

  test("not found: reviewing while tries are left, unknown after the last", async () => {
    const g = await game(2 * MIN);
    g.unlist();
    expect(await g.lookup(0)).toBe("retry");
    expect(g.result()).toBe("reviewing");
    expect(await g.lookup(1)).toBe("retry");
    expect(await g.lookup(2)).toBe("done");
    expect(g.result()).toBe("unknown");
    expect(readRecord(paths(), g.key)!.official).toMatchObject({ status: "missing", attempts: 3, final: true });
  });

  test("an old game not found: unknown after its one try", async () => {
    const g = await game(7 * 60 * MIN);
    g.unlist();
    expect(await g.lookup(0)).toBe("done");
    expect(g.result()).toBe("unknown");
  });

  test("statistics from before 0.2.5: only the match is fetched again, for who won", async () => {
    const g = await game(3 * 24 * 60 * MIN);
    const old = readRecord(paths(), g.key)!;
    const players = old.players.map((x) => ({ playerId: x.playerId, battleTag: x.name, unitsProduced: 1, unitsKilled: 1, largestArmy: 1, heroesKilled: 0, itemsObtained: 0, mercsHired: 0, expGained: 1, goldCollected: 1, lumberCollected: 1, goldUpkeepLost: 0 }));
    applyOfficial(g.ctx, g.key, { status: "ok", source: "w3champions", matchId: "known", fetchedAt: new Date().toISOString(), players });
    expect(g.result()).toBe("reviewing");
    expect(await g.lookup(0)).toBe("done");
    expect(g.calls).toEqual(["match known"]);
    expect(g.result()).toBe("win");
  });
});
