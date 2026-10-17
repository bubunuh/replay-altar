import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, paths } from "@w3stats/core";
import { simNotReady } from "@w3stats/sim";
import { officialForOwnGame, percentileOf, pickSubject, quantile, RateLimited, refreshDue, refreshGroup, summarizeValues, w3cClient, type Fetch, type W3cClient, type W3cMatch, type W3cScore } from "../src/index.ts";
import { mergeOfficial, type GameRecord } from "@w3stats/core";

const FIX = join(import.meta.dirname, "../../../fixtures/replays");
const match = (id: string, a: [string, number, number], b: [string, number, number], extra: Partial<W3cMatch> = {}): W3cMatch => ({
  id, map: "x", mapName: "X", startTime: "2026-10-17T00:00:00Z", durationInSeconds: 900, gateWay: 20, season: 25, gameMode: 1,
  teams: [{ players: [{ battleTag: a[0], race: a[1], oldMmr: a[2], won: true }] }, { players: [{ battleTag: b[0], race: b[1], oldMmr: b[2], won: false }] }],
  ...extra,
});

describe("choosing the player to compare with", () => {
  test("a Human at or above the MMR threshold", () => {
    expect(pickSubject(match("1", ["Pro#1", 1, 2500], ["Opp#2", 2, 2450]), "H", 2400)?.subject.battleTag).toBe("Pro#1");
  });
  test("below the threshold, Random, or not 1v1: none", () => {
    expect(pickSubject(match("1", ["Low#1", 1, 2300], ["Opp#2", 2, 2600]), "H", 2400)).toBeNull();
    expect(pickSubject(match("1", ["Rnd#1", 0, 2600], ["Opp#2", 2, 2600]), "H", 2400)).toBeNull();
    expect(pickSubject(match("1", ["Pro#1", 1, 2500], ["Opp#2", 2, 2450], { gameMode: 2 }), "H", 2400)).toBeNull();
  });
  test("Human mirror: the higher-rated Human", () => {
    expect(pickSubject(match("1", ["A#1", 1, 2450], ["B#2", 1, 2600]), "H", 2400)?.subject.battleTag).toBe("B#2");
  });
});

describe("when to refresh", () => {
  const H = 3600_000;
  const now = Date.parse("2026-10-20T12:00:00Z");
  const at = (hoursAgo: number) => new Date(now - hoursAgo * H).toISOString();
  const base = { kept: 50, target: 50, refreshDays: 7, checkEveryMs: 6 * H, now };
  test("never refreshed: now", () => expect(refreshDue({ ...base, lastRefreshAt: null })).toBe(true));
  test("full: only after a week", () => {
    expect(refreshDue({ ...base, lastRefreshAt: at(24 * 6) })).toBe(false);
    expect(refreshDue({ ...base, lastRefreshAt: at(24 * 7 + 1) })).toBe(true);
  });
  test("still filling: every check, but not right after the last attempt", () => {
    expect(refreshDue({ ...base, kept: 28, lastRefreshAt: at(6) })).toBe(true);
    expect(refreshDue({ ...base, kept: 28, lastRefreshAt: at(2) })).toBe(false);
  });
});

describe("official end-of-game stats", () => {
  const score = (tag: string, xp: number, gold: number): W3cScore => ({
    battleTag: tag,
    unitScore: { unitsProduced: 40, unitsKilled: 30, largestArmy: 50 },
    heroScore: { heroesKilled: 1, itemsObtained: 5, mercsHired: 0, expGained: xp },
    resourceScore: { goldCollected: gold, lumberCollected: 2000, goldUpkeepLost: 300 },
  });
  const record = (): GameRecord =>
    ({
      gameKey: "k",
      game: { playedAt: "2026-10-12T21:05:51Z", durationMs: 851_000 },
      classification: { opponentId: 1 },
      players: [
        { playerId: 2, name: "Me#1", isMe: true, teamId: 1, metrics: { hero_xp_total: 1800, gold_collected: 7000 } },
        { playerId: 1, name: "Opp#1", isMe: false, teamId: 0, metrics: { hero_xp_total: 900, gold_collected: 6000 } },
      ],
    }) as unknown as GameRecord;
  const client = (startTime: string): W3cClient => ({
    currentSeason: async () => 25,
    listMatches: async () => ({ count: 0, matches: [] }),
    downloadReplay: async () => null,
    searchPlayerMatches: async (q) => (q.gateway === 20 && q.season === 25 ? [match("w3c-1", ["Me#1", 1, 1500], ["Opp#1", 2, 1500], { startTime })] : []),
    matchDetail: async () => ({ match: match("w3c-1", ["Me#1", 1, 1500], ["Opp#1", 2, 1500]), playerScores: [score("Me#1", 2411, 7956), score("Opp#1", 866, 6500)] }),
  });

  test("your game is found by opponent and start time; official numbers replace estimates", async () => {
    const r = record();
    const off = await officialForOwnGame(client("2026-10-12T21:05:37Z"), r);
    expect(off).toMatchObject({ status: "ok", matchId: "w3c-1" });
    mergeOfficial(r, off);
    const me = r.players[0];
    expect(me.metrics.hero_xp_total).toBe(2411);
    expect(me.metrics.gold_collected).toBe(7956);
    expect(me.metrics.units_killed).toBe(30);
    expect(me.metrics.hero_xp_share).toBeCloseTo(2411 / (2411 + 866));
    expect(r.metricSources?.hero_xp_total).toBe("official");
  });
  test("a match far from the replay's start time is not taken", async () => {
    const off = await officialForOwnGame(client("2026-10-12T23:30:00Z"), record(), 1);
    expect(off).toMatchObject({ status: "missing", attempts: 2 });
  });
});

describe("quantiles", () => {
  test("type-7 quantiles and mid-rank percentiles", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(summarizeValues([4, null, 1, 3, 2])).toMatchObject({ n: 4, p50: 2.5, p25: 1.75 });
    expect(percentileOf([1, 2, 3, 4], 3)).toBe(0.625); // 2 below + half of 1 tie, out of 4
  });
});

describe("W3Champions client", () => {
  const respond = (status: number): Awaited<ReturnType<Fetch>> => ({ status, headers: { get: () => null }, json: async () => ({}), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  test("a 429 stops at once, without retrying", async () => {
    let calls = 0;
    const client = w3cClient({ fetch: async () => (calls++, respond(429)), sleep: async () => {} });
    await expect(client.downloadReplay("abc")).rejects.toThrow(RateLimited);
    expect(calls).toBe(1);
  });
  test("a 5xx is retried after 30 s", async () => {
    const waits: number[] = [];
    let calls = 0;
    const client = w3cClient({ fetch: async () => respond(++calls === 1 ? 503 : 200), sleep: async (ms) => void waits.push(ms) });
    expect(await client.downloadReplay("abc")).toEqual(Buffer.from([1, 2, 3]));
    expect(waits).toEqual([30_000]);
  });
});

const realData = paths().root;
const files = ["Macro_loss.w3g", "Victory-1v1-oct-2026.w3g", "victory_vs_elf.w3g"];
const canRun = simNotReady(realData) === null && files.every((f) => existsSync(join(FIX, f)));

describe.skipIf(!canRun)("refreshing a reference group (fake W3Champions, real simulation)", () => {
  const before = process.env.W3STATS_DATA;
  process.env.W3STATS_DATA = mkdtempSync(join(tmpdir(), "w3stats-ref-"));
  afterAll(() => {
    if (before === undefined) delete process.env.W3STATS_DATA;
    else process.env.W3STATS_DATA = before;
  });
  // Pretend Pedrovisk is a 2500-MMR Human pro in the fixture games.
  const fakeMatches = [
    match("m-old", ["Pedrovisk#1486", 1, 2500], ["x#1", 2, 2400]),
    match("m1", ["Pedrovisk#1486", 1, 2500], ["OSTAS#21855", 8, 2400]),
    match("m2", ["Low#1", 1, 1500], ["y#1", 2, 2400]),
    match("m3", ["Pedrovisk#1486", 1, 2500], ["гнилой#21118", 4, 2400]),
    match("m4", ["Pedrovisk#1486", 1, 2500], ["Lucky392cake#2107", 4, 2400]),
  ];
  const replayFor: Record<string, string> = { "m-old": "Macro_loss.w3g", m1: "Macro_loss.w3g", m3: "Victory-1v1-oct-2026.w3g", m4: "victory_vs_elf.w3g" };
  const downloads: string[] = [];
  const client: W3cClient = {
    currentSeason: async () => 25,
    matchDetail: async () => null,
    searchPlayerMatches: async () => [],
    listMatches: async (q) => ({ count: fakeMatches.length, matches: q.offset === 0 && q.gateway === 20 ? fakeMatches : [] }),
    downloadReplay: async (id) => {
      downloads.push(id);
      return readFileSync(join(FIX, replayFor[id]));
    },
  };

  test("downloads up to the target, skips other patches, builds a profile", async () => {
    const group = { ...DEFAULT_CONFIG.reference.groups[0], target: 2 };
    const res = await refreshGroup(group, { config: DEFAULT_CONFIG, replayBuild: 7000, gamedataRoot: realData, client, sleep: async () => {} });
    expect(res.downloaded).toBe(2);
    expect(res.kept).toBe(2);
    // m1 is the same game as m-old (skipped as a duplicate); m2's Human is below 2400 (never downloaded).
    expect(downloads).toEqual(["m-old", "m1", "m3"]);
    expect(res.skipped).toBe(1);
    expect(res.profile.games).toBe(2);
    expect(Object.keys(res.profile.matchups).sort()).toEqual(["HvN", "HvU", "all"]);
    expect(res.profile.matchups.all.metrics.apm.n).toBe(res.profile.games);
  }, 120_000);

  test("a rate limit mid-run keeps what was downloaded", async () => {
    const group = { ...DEFAULT_CONFIG.reference.groups[0], id: "limited", target: 5 };
    let n = 0;
    const limited: W3cClient = {
      ...client,
      downloadReplay: async (id) => {
        if (++n > 1) throw new RateLimited("slow down");
        return readFileSync(join(FIX, replayFor[id]));
      },
    };
    const res = await refreshGroup(group, { config: DEFAULT_CONFIG, replayBuild: 7000, gamedataRoot: realData, client: limited, sleep: async () => {} });
    expect(res.kept).toBe(1);
    expect(res.paused).toBe(true);
    expect(res.stopReason).toContain("slow down");
  }, 120_000);

  test("games from another replay build are skipped", async () => {
    const group = { ...DEFAULT_CONFIG.reference.groups[0], id: "other", target: 1 };
    const res = await refreshGroup(group, { config: DEFAULT_CONFIG, replayBuild: 9999, gamedataRoot: realData, client, sleep: async () => {} });
    expect(res.downloaded).toBe(0);
    expect(res.skipped).toBeGreaterThan(0);
  }, 120_000);
});
