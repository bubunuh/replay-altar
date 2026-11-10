// A W3Champions game's result comes from W3Champions (official.ts): "reviewing" until the lookup
// finds who won, "unknown" if it never does or the lookups are off. Fixture replay1 is a
// W3Champions 1v1 of Pedrovisk#1486.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  addAnnotation,
  applyOfficial,
  DEFAULT_CONFIG,
  ingestFile,
  openDb,
  readRecord,
  reingestAll,
  settleW3cResults,
  type GameRecord,
  type IngestContext,
  type OfficialStats,
  type W3cResults,
} from "../src/index.ts";

const W3C = join(import.meta.dirname, "../../../fixtures/replays/replay1.w3g");
const BNET = join(import.meta.dirname, "../../../fixtures/replays/replay2.w3g");

function store(w3cResults: W3cResults | undefined) {
  const root = mkdtempSync(join(tmpdir(), "replay-altar-w3cresult-"));
  const paths = {
    root,
    db: join(root, "replay-altar.sqlite"),
    archive: join(root, "archive"),
    superseded: join(root, "archive/superseded"),
    games: join(root, "games"),
    raw: join(root, "raw"),
    events: join(root, "events.jsonl"),
    maps: join(root, "maps"),
  };
  const ctx: IngestContext = { db: openDb(paths.db), config: { ...DEFAULT_CONFIG, accounts: ["Pedrovisk#1486"], warcraftDocuments: [] }, paths, w3cResults };
  mkdirSync(join(root, "Replays"));
  const ingest = async (file = W3C) => {
    const to = join(root, "Replays", file.split("/").at(-1)!);
    writeFileSync(to, readFileSync(file));
    const out = await ingestFile(ctx, to);
    if (out.status !== "new") throw new Error(out.status);
    return out.record;
  };
  const row = (key: string) => ctx.db.prepare("SELECT result, result_detected, result_method, result_confidence FROM v_games WHERE game_key = ?").get(key) as Record<string, string>;
  const players = (key: string) => ctx.db.prepare("SELECT name, result FROM game_players WHERE game_key = ? ORDER BY is_me DESC").all(key) as { name: string; result: string }[];
  return { ctx, ingest, row, players };
}

const found = (r: GameRecord, iWon: boolean | undefined): OfficialStats => ({
  status: "ok",
  source: "w3champions",
  matchId: "6af0ee7e9ff6be2370da726b",
  fetchedAt: "2026-11-08T22:00:00Z",
  players: r.players.map((p) => ({
    playerId: p.playerId, battleTag: p.name, unitsProduced: 1, unitsKilled: 1, largestArmy: 1, heroesKilled: 0, itemsObtained: 0, mercsHired: 0, expGained: 100, goldCollected: 100, lumberCollected: 100, goldUpkeepLost: 0,
    ...(iWon === undefined ? {} : { won: p.isMe === iWon }),
  })),
});
const missing = (final: boolean | undefined): OfficialStats => ({ status: "missing", source: "w3champions", fetchedAt: "2026-11-08T22:00:00Z", attempts: 1, reason: "no W3Champions match with this opponent near this time", ...(final === undefined ? {} : { final }) });

describe("a W3Champions game's result comes from W3Champions", () => {
  test("reviewing while it is looked up, then W3Champions' winner, whatever the replay said", async () => {
    const s = store("lookup");
    const r = await s.ingest();
    expect(r.result).toMatchObject({ me: "reviewing", method: "w3champions", winnerTeamId: null, confidence: "none" });
    expect(r.result.replay?.method).not.toBe("w3champions"); // what the leave records said, kept
    expect(s.row(r.gameKey)).toMatchObject({ result: "reviewing", result_detected: "reviewing", result_method: "w3champions" });

    // Not found yet, more tries to come: still reviewing.
    applyOfficial(s.ctx, r.gameKey, missing(false));
    expect(s.row(r.gameKey).result).toBe("reviewing");

    const replaySaid = readRecord(s.ctx.paths, r.gameKey)!.result.replay!;
    for (const iWon of [true, false]) {
      applyOfficial(s.ctx, r.gameKey, found(r, iWon));
      expect(s.row(r.gameKey)).toMatchObject({ result: iWon ? "win" : "loss", result_method: "w3champions", result_confidence: "high" });
      expect(s.players(r.gameKey).map((p) => p.result)).toEqual(iWon ? ["win", "loss"] : ["loss", "win"]);
      const kept = readRecord(s.ctx.paths, r.gameKey)!;
      expect(kept.result.evidence).toMatch(/^W3Champions match 6af0ee7e9ff6be2370da726b: .+ won$/);
      expect(kept.result.replay).toEqual(replaySaid); // not W3Champions' after the first time
    }
  });

  test("unknown once the lookup gives up; statistics without the winner (before 0.2.5) are reviewing until fetched again", async () => {
    const s = store("lookup");
    const r = await s.ingest();
    applyOfficial(s.ctx, r.gameKey, missing(true));
    expect(s.row(r.gameKey).result).toBe("unknown");
    expect(readRecord(s.ctx.paths, r.gameKey)!.result.evidence).toMatch(/^not found on W3Champions: no W3Champions match/);
    // A "not found" from before 0.2.5 gets one more try (officialqueue.ts): reviewing.
    applyOfficial(s.ctx, r.gameKey, missing(undefined));
    expect(s.row(r.gameKey).result).toBe("reviewing");
    applyOfficial(s.ctx, r.gameKey, found(r, undefined));
    expect(s.row(r.gameKey).result).toBe("reviewing");
    applyOfficial(s.ctx, r.gameKey, { ...found(r, undefined), final: true } as OfficialStats);
    expect(s.row(r.gameKey).result).toBe("unknown");
    // Found, nobody won (a draw): unknown.
    const draw = found(r, true) as Extract<OfficialStats, { status: "ok" }>;
    applyOfficial(s.ctx, r.gameKey, { ...draw, players: draw.players.map((p) => ({ ...p, won: false })) });
    expect(s.row(r.gameKey).result).toBe("unknown");
  });

  test("lookups turned off: unknown", async () => {
    const s = store("off");
    const r = await s.ingest();
    expect(s.row(r.gameKey)).toMatchObject({ result: "unknown", result_method: "w3champions" });
    expect(r.result.evidence).toMatch(/turned off/);
  });

  test("a result you corrected wins over W3Champions'", async () => {
    const s = store("lookup");
    const r = await s.ingest();
    addAnnotation(s.ctx.db, { gameKey: r.gameKey, kind: "result_override", source: "user", body: { result: "win" } });
    expect(s.row(r.gameKey)).toMatchObject({ result: "win", result_detected: "reviewing" });
    applyOfficial(s.ctx, r.gameKey, found(r, false));
    expect(s.row(r.gameKey)).toMatchObject({ result: "win", result_detected: "loss" });
  });

  test("Battle.net games, and stores without the lookups (reference games, analyzed replays), keep the replay's result", async () => {
    const s = store("lookup");
    const bnet = await s.ingest(BNET);
    expect(bnet.classification.source).not.toBe("w3champions");
    expect(bnet.result.method).not.toBe("w3champions");
    const other = store(undefined);
    const r = await other.ingest();
    expect(r.result.method).not.toBe("w3champions");
    expect(r.result.me).not.toBe("reviewing");
  });

  test("a rebuilt game keeps W3Champions' result", async () => {
    const s = store("lookup");
    const r = await s.ingest();
    applyOfficial(s.ctx, r.gameKey, found(r, true));
    await reingestAll(s.ctx);
    expect(s.row(r.gameKey)).toMatchObject({ result: "win", result_method: "w3champions" });
  });
});

describe("at start (settleW3cResults)", () => {
  test("games from 0.2.4 take W3Champions' result once; turning the lookups off and on again follows", async () => {
    const s = store(undefined); // as 0.2.4 stored it: the replay's result
    const r = await s.ingest();
    applyOfficial(s.ctx, r.gameKey, found(r, undefined)); // statistics fetched by 0.2.4, no winner
    const before = s.row(r.gameKey);
    expect(before.result_method).not.toBe("w3champions");

    s.ctx.w3cResults = "lookup";
    expect(settleW3cResults(s.ctx, true)).toBe(1);
    expect(s.row(r.gameKey)).toMatchObject({ result: "reviewing", result_method: "w3champions" });
    expect(readRecord(s.ctx.paths, r.gameKey)!.result.replay).toMatchObject({ method: before.result_method, me: before.result_detected });
    expect(settleW3cResults(s.ctx, false)).toBe(0);
    expect(readFileSync(s.ctx.paths.events, "utf8")).toContain('"type":"reingested"');

    s.ctx.w3cResults = "off";
    expect(settleW3cResults(s.ctx, false)).toBe(0); // only when the mode changed
    expect(settleW3cResults(s.ctx, true)).toBe(1);
    expect(s.row(r.gameKey).result).toBe("unknown");
    s.ctx.w3cResults = "lookup";
    expect(settleW3cResults(s.ctx, true)).toBe(1);
    expect(s.row(r.gameKey).result).toBe("reviewing");

    // A game whose winner is known doesn't change with the mode.
    applyOfficial(s.ctx, r.gameKey, found(r, true));
    s.ctx.w3cResults = "off";
    expect(settleW3cResults(s.ctx, true)).toBe(0);
    expect(s.row(r.gameKey).result).toBe("win");
  });
});
