import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, paths } from "@replay-altar/core";
import { simNotReady } from "@replay-altar/sim";
import { officialForOwnGame, percentileOf, quantile, RateLimited, refreshGroup, summarizeValues, w3cClient, w3iSubjects, type Fetch, type W3cClient, type W3cMatch, type W3cScore, type W3iClient, type W3iReplay } from "../src/index.ts";
import { mergeOfficial, type GameRecord } from "@replay-altar/core";

const FIX = join(import.meta.dirname, "../../../fixtures/replays");
const match = (id: string, a: [string, number, number], b: [string, number, number], extra: Partial<W3cMatch> = {}): W3cMatch => ({
  id, map: "x", mapName: "X", startTime: "2026-10-17T00:00:00Z", durationInSeconds: 900, gateWay: 20, season: 25, gameMode: 1,
  teams: [{ players: [{ battleTag: a[0], race: a[1], oldMmr: a[2], won: true }] }, { players: [{ battleTag: b[0], race: b[1], oldMmr: b[2], won: false }] }],
  ...extra,
});

// A warcraft3.info list entry: players as [battletag, race, curated profile name or null].
const replay = (id: number, a: [string, string, string | null], b: [string, string, string | null], extra: Partial<W3iReplay> = {}): W3iReplay => ({
  id, type: "1on1", duration: 900, map: "w3c_Concealed.w3x", created_at: "2026-10-17T00:00:00Z",
  players: [a, b].map(([player, race, name], i) => ({ player, race, team: i + 1, stats_player: name ? { id: i, name, main_race: race } : null })),
  ...extra,
});

describe("choosing the player to compare with", () => {
  test("a player with a curated profile, playing the group's race", () => {
    expect(w3iSubjects(replay(1, ["pro#1", "Human", "Pro"], ["opp#2", "Orc", "Opp"]), "H").map((x) => x.subject.player)).toEqual(["pro#1"]);
  });
  test("no profile, another race, or not 1v1: none", () => {
    expect(w3iSubjects(replay(1, ["anon#1", "Human", null], ["opp#2", "Orc", "Opp"]), "H")).toEqual([]);
    expect(w3iSubjects(replay(1, ["pro#1", "Orc", "Pro"], ["opp#2", "Orc", "Opp"]), "H")).toEqual([]);
    expect(w3iSubjects(replay(1, ["pro#1", "Human", "Pro"], ["opp#2", "Orc", "Opp"], { type: "2on2" }), "H")).toEqual([]);
  });
  test("a mirror gives both players as candidates", () => {
    expect(w3iSubjects(replay(1, ["a#1", "Human", "A"], ["b#2", "Human", "B"]), "H")).toHaveLength(2);
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

describe.skipIf(!canRun)("refreshing a reference group (fake warcraft3.info, real simulation)", () => {
  const before = process.env.REPLAY_ALTAR_DATA;
  process.env.REPLAY_ALTAR_DATA = mkdtempSync(join(tmpdir(), "replay-altar-ref-"));
  afterAll(() => {
    if (before === undefined) delete process.env.REPLAY_ALTAR_DATA;
    else process.env.REPLAY_ALTAR_DATA = before;
  });
  // Pretend Pedrovisk is a tournament Human with a profile in the fixture games.
  const list = [
    replay(10, ["pedrovisk#1486", "Human", "Pedrovisk"], ["x#1", "Orc", "X"]),
    replay(11, ["pedrovisk#1486", "Human", "Pedrovisk"], ["ostas#21855", "Undead", null]),
    replay(12, ["nobody#1", "Human", null], ["y#1", "Orc", "Y"]),
    replay(13, ["pedrovisk#1486", "Human", "Pedrovisk"], ["гнилой#21118", "Night Elf", null], { duration: 60 }),
    replay(14, ["pedrovisk#1486", "Human", "Pedrovisk"], ["гнилой#21118", "Night Elf", null]),
    replay(15, ["pedrovisk#1486", "Human", "Pedrovisk"], ["lucky392cake#2107", "Night Elf", null]),
  ];
  const replayFor: Record<number, string> = { 10: "Macro_loss.w3g", 11: "Macro_loss.w3g", 13: "Victory-1v1-oct-2026.w3g", 14: "Victory-1v1-oct-2026.w3g", 15: "victory_vs_elf.w3g" };
  const downloads: number[] = [];
  const client: W3iClient = {
    listReplays: async (page) => ({ replays: page === 1 ? list : [], lastPage: 1 }),
    mapFiles: async () => [],
    downloadMap: async () => null,
    download: async (id) => {
      downloads.push(id);
      return readFileSync(join(FIX, replayFor[id]));
    },
  };

  test("downloads up to the target, skips duplicates, short games and players without a profile", async () => {
    const group = { ...DEFAULT_CONFIG.reference.groups[0], target: 2 };
    const res = await refreshGroup(group, { config: DEFAULT_CONFIG, replayBuild: 7000, gamedataRoot: realData, client, sleep: async () => {} });
    expect(res.downloaded).toBe(2);
    expect(res.kept).toBe(2);
    // 11 is the same game as 10 (duplicate); 12 has no profile and 13 is too short (never downloaded).
    expect(downloads).toEqual([10, 11, 14]);
    expect(res.skipped).toBe(1);
    expect(res.profile.games).toBe(2);
    expect(Object.keys(res.profile.matchups).sort()).toEqual(["HvN", "HvU", "all"]);
    expect(res.profile.matchups.all.metrics.apm.n).toBe(res.profile.games);
  }, 120_000);

  test("a rate limit mid-run keeps what was downloaded", async () => {
    const group = { ...DEFAULT_CONFIG.reference.groups[0], id: "limited", target: 5 };
    let n = 0;
    const limited: W3iClient = {
      ...client,
      download: async (id) => {
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
