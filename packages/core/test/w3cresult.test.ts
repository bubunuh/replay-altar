// A W3Champions game's result (official.ts): the replay's at once when its leave records decide
// (result.ts), W3Champions' own when the lookup finds the match (the authority), "reviewing"
// meanwhile only when the replay doesn't decide, "unknown" if nothing ever does. Fixture replay1 is
// a W3Champions 1v1 of Pedrovisk#1486 (player 2), the launcher's copy: its one leave record is the
// opponent's (player 1 left), so the replay says Pedrovisk won. Other leave records are written
// into the stored parse (`leaves`), as real replays have them.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import {
  addAnnotation,
  applyOfficial,
  DEFAULT_CONFIG,
  ingestFile,
  openDb,
  rawPath,
  readRecord,
  reingestAll,
  replayResult,
  settleW3cResults,
  type GameRecord,
  type IngestContext,
  type LeaveRecord,
  type OfficialStats,
  type RawReplay,
  type W3cResults,
} from "../src/index.ts";

const W3C = join(import.meta.dirname, "../../../fixtures/replays/replay1.w3g");
const BNET = join(import.meta.dirname, "../../../fixtures/replays/replay2.w3g");

const rec = (playerId: number, reason: string, result: string): LeaveRecord => ({ playerId, reason: `${reason}000000`, result: `${result}000000` });
/** No leave record at all, as most of the launcher's copies: the replay doesn't decide. */
const SILENT: LeaveRecord[] = [];
/** The game's own copy, the saver (player 2) won: FLO and the opponent closed with result 09. */
const SAVER_WON = [rec(24, "0c", "09"), rec(1, "0c", "09"), rec(2, "0c", "07")];
/** The game's own copy, the saver (player 2) left: every record 0c/07. */
const SAVER_LEFT = [rec(24, "0c", "07"), rec(1, "0c", "07"), rec(2, "0c", "07")];

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
  /** Imports the fixture; with `leaves`, as if the replay had these leave records. */
  const ingest = async (file = W3C, leaves?: LeaveRecord[]) => {
    const to = join(root, "Replays", file.split("/").at(-1)!);
    writeFileSync(to, readFileSync(file));
    const out = await ingestFile(ctx, to);
    if (out.status !== "new") throw new Error(out.status);
    if (!leaves) return out.record;
    const stored = rawPath(paths, out.record.gameKey);
    const raw = JSON.parse(gunzipSync(readFileSync(stored)).toString("utf8")) as RawReplay;
    writeFileSync(stored, gzipSync(JSON.stringify({ ...raw, leaveEvents: leaves })));
    settleW3cResults(ctx, { modeChanged: false, reread: true });
    return readRecord(paths, out.record.gameKey)!;
  };
  const row = (key: string) => ctx.db.prepare("SELECT result, result_detected, result_method, result_confidence FROM v_games WHERE game_key = ?").get(key) as Record<string, string>;
  const players = (key: string) => ctx.db.prepare("SELECT name, result FROM game_players WHERE game_key = ? ORDER BY is_me DESC").all(key) as { name: string; result: string }[];
  const events = () => readFileSync(paths.events, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
  return { ctx, ingest, row, players, events };
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

describe("a W3Champions game the replay decides", () => {
  test("has its result at once, with the replay's method, confidence and evidence", async () => {
    const s = store("lookup");
    const r = await s.ingest();
    expect(r.result).toMatchObject({ me: "win", method: "first_leaver_lost", confidence: "medium" });
    expect(r.result.evidence).toMatch(/player 1 left reason=07000000/);
    expect(r.result.replay).toBeUndefined();
    expect(s.row(r.gameKey)).toMatchObject({ result: "win", result_detected: "win", result_method: "first_leaver_lost", result_confidence: "medium" });
    expect(s.players(r.gameKey).map((p) => p.result)).toEqual(["win", "loss"]);

    const won = await store("lookup").ingest(W3C, SAVER_WON);
    expect(won.result).toMatchObject({ me: "win", method: "flo_saver_won", confidence: "high" });
    expect(won.result.evidence).toMatch(/player 24 left reason=0c000000 result=09000000/); // FLO's record counts
    const left = await store("lookup").ingest(W3C, SAVER_LEFT);
    expect(left.result).toMatchObject({ me: "loss", method: "leave_game_over", confidence: "high" });
  });

  test("W3Champions' result replaces it when the lookup finds the match", async () => {
    const s = store("lookup");
    const r = await s.ingest(W3C, SAVER_WON);
    // Not found yet: the replay's result stays.
    applyOfficial(s.ctx, r.gameKey, missing(false));
    expect(s.row(r.gameKey)).toMatchObject({ result: "win", result_method: "flo_saver_won" });
    applyOfficial(s.ctx, r.gameKey, found(r, true));
    expect(s.row(r.gameKey)).toMatchObject({ result: "win", result_method: "w3champions", result_confidence: "high" });
    const kept = readRecord(s.ctx.paths, r.gameKey)!;
    expect(kept.result.evidence).toMatch(/^W3Champions match 6af0ee7e9ff6be2370da726b: .+ won$/);
    expect(kept.result.replay).toMatchObject({ me: "win", method: "flo_saver_won" }); // what the replay said, kept
    expect(s.events().some((e) => e.type === "w3c_result_differs")).toBe(false);
  });

  test("when W3Champions disagrees, W3Champions wins and the disagreement is logged once", async () => {
    const s = store("lookup");
    const r = await s.ingest(W3C, SAVER_WON);
    applyOfficial(s.ctx, r.gameKey, found(r, false));
    expect(s.row(r.gameKey)).toMatchObject({ result: "loss", result_method: "w3champions", result_confidence: "high" });
    expect(s.players(r.gameKey).map((p) => p.result)).toEqual(["loss", "win"]);
    const differs = s.events().filter((e) => e.type === "w3c_result_differs");
    expect(differs).toHaveLength(1);
    expect(differs[0]).toMatchObject({ gameKey: r.gameKey, replayWinnerTeam: 1, w3championsWinnerTeam: 0, replay: { method: "flo_saver_won" } });
    // The statistics stored again (a later start): not logged twice.
    applyOfficial(s.ctx, r.gameKey, found(r, false));
    expect(s.events().filter((e) => e.type === "w3c_result_differs")).toHaveLength(1);
    expect(readRecord(s.ctx.paths, r.gameKey)!.result.replay).toMatchObject({ me: "win", method: "flo_saver_won" });
  });

  test("a game W3Champions doesn't list (a private game), or with the lookups off, keeps the replay's result", async () => {
    const s = store("lookup");
    const r = await s.ingest(W3C, SAVER_LEFT);
    applyOfficial(s.ctx, r.gameKey, missing(true)); // the last try missed
    expect(s.row(r.gameKey)).toMatchObject({ result: "loss", result_method: "leave_game_over", result_confidence: "high" });
    const off = store("off");
    const o = await off.ingest();
    expect(off.row(o.gameKey)).toMatchObject({ result: "win", result_method: "first_leaver_lost" });
  });

  test("a result you corrected wins over the replay's and over W3Champions'", async () => {
    const s = store("lookup");
    const r = await s.ingest(W3C, SAVER_WON);
    addAnnotation(s.ctx.db, { gameKey: r.gameKey, kind: "result_override", source: "user", body: { result: "loss" } });
    expect(s.row(r.gameKey)).toMatchObject({ result: "loss", result_detected: "win" });
    applyOfficial(s.ctx, r.gameKey, found(r, true));
    expect(s.row(r.gameKey)).toMatchObject({ result: "loss", result_detected: "win", result_method: "w3champions" });
    await reingestAll(s.ctx);
    expect(s.row(r.gameKey).result).toBe("loss");
  });
});

describe("a W3Champions game the replay doesn't decide", () => {
  test("reviewing while it is looked up, then W3Champions' winner", async () => {
    const s = store("lookup");
    const r = await s.ingest(W3C, SILENT);
    expect(r.result).toMatchObject({ me: "reviewing", method: "w3champions", winnerTeamId: null, confidence: "none" });
    expect(r.result.replay).toMatchObject({ method: "none", me: "unknown" }); // what the leave records said, kept
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
    expect(s.events().some((e) => e.type === "w3c_result_differs")).toBe(false); // the replay said nothing
  });

  test("unknown once the lookup gives up; statistics without the winner (before 0.2.5) are reviewing until fetched again", async () => {
    const s = store("lookup");
    const r = await s.ingest(W3C, SILENT);
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
    const r = await s.ingest(W3C, SILENT);
    expect(s.row(r.gameKey)).toMatchObject({ result: "unknown", result_method: "w3champions" });
    expect(r.result.evidence).toMatch(/turned off/);
  });

  test("a result you corrected stays", async () => {
    const s = store("lookup");
    const r = await s.ingest(W3C, SILENT);
    addAnnotation(s.ctx.db, { gameKey: r.gameKey, kind: "result_override", source: "user", body: { result: "win" } });
    expect(s.row(r.gameKey)).toMatchObject({ result: "win", result_detected: "reviewing" });
    applyOfficial(s.ctx, r.gameKey, found(r, false));
    expect(s.row(r.gameKey)).toMatchObject({ result: "win", result_detected: "loss" });
  });
});

describe("the copies of a W3Champions game", () => {
  test("the result comes from the copy whose leave records say it best, whichever is analyzed", async () => {
    const s = store("lookup");
    const r = await s.ingest();
    const raw = JSON.parse(gunzipSync(readFileSync(rawPath(s.ctx.paths, r.gameKey))).toString("utf8")) as RawReplay;
    const canonical = r.provenance.canonicalFile;
    // The fixture copy keeps its own records (FLO's game: SourceFile.leaves).
    expect(canonical.leaves).toEqual([rec(1, "07", "07")]);
    // The launcher's copy, a few ms longer, is the one analyzed and has no record; the game's own copy has them.
    const launcher = { ...canonical, sha256: "a".repeat(64), path: "/replays/w3c-20261108210935.w3g", leaves: undefined };
    const own = { ...canonical, sha256: "b".repeat(64), path: "/replays/LastReplay.w3g", leaves: SAVER_LEFT };
    const silent: RawReplay = { ...raw, leaveEvents: [] };
    expect(replayResult(silent, r.classification, [launcher], launcher)).toMatchObject({ method: "none", me: "unknown" });
    const best = replayResult(silent, r.classification, [own, launcher], launcher);
    expect(best).toMatchObject({ method: "leave_game_over", confidence: "high", me: "loss" });
    expect(best.evidence).toMatch(/from the copy LastReplay\.w3g$/);
    // A surer copy only: the analyzed copy's own high-confidence reading stays.
    const sure = { ...raw, leaveEvents: SAVER_WON } as unknown as RawReplay; // w3gjs adds the block id to each record
    expect(replayResult(sure, r.classification, [{ ...own, leaves: [rec(2, "07", "07")] }, launcher], launcher)).toMatchObject({ method: "flo_saver_won", me: "win" });
  });
});

describe("other games", () => {
  test("Battle.net games, and stores without the lookups (reference games, analyzed replays), keep the replay's result", async () => {
    const s = store("lookup");
    const bnet = await s.ingest(BNET);
    expect(bnet.classification.source).not.toBe("w3champions");
    expect(bnet.result.method).not.toBe("w3champions");
    expect(bnet.provenance.canonicalFile.leaves).toBeUndefined();
    const other = store(undefined);
    const r = await other.ingest(W3C, SILENT);
    expect(r.result).toMatchObject({ method: "none", me: "unknown" });
  });

  test("a rebuilt game keeps W3Champions' result", async () => {
    const s = store("lookup");
    const r = await s.ingest();
    applyOfficial(s.ctx, r.gameKey, found(r, false));
    await reingestAll(s.ctx);
    expect(s.row(r.gameKey)).toMatchObject({ result: "loss", result_method: "w3champions" });
  });
});

describe("at start (settleW3cResults)", () => {
  test("once, the stored games get what their replay says read again: no import needed", async () => {
    const s = store("lookup");
    const r = await s.ingest();
    // As 0.2.5 stored it: reviewing (the lookup never found it), the replay's reading not used.
    const old = readRecord(s.ctx.paths, r.gameKey)!;
    old.result = { winnerTeamId: null, method: "w3champions", confidence: "none", me: "unknown", evidence: "not found on W3Champions", replay: { winnerTeamId: 0, method: "leave_victory", confidence: "high", me: "loss", evidence: "as 0.2.5 read it" } };
    writeFileSync(join(s.ctx.paths.games, `${r.gameKey}.json`), JSON.stringify(old));
    s.ctx.db.prepare("UPDATE games SET result_detected = 'unknown', result_method = 'w3champions' WHERE game_key = ?").run(r.gameKey);
    applyOfficial(s.ctx, r.gameKey, missing(true));
    expect(s.row(r.gameKey).result).toBe("loss"); // 0.2.5's reading, were it trusted

    expect(settleW3cResults(s.ctx, { modeChanged: false, reread: false })).toBe(0);
    expect(settleW3cResults(s.ctx, { modeChanged: false, reread: true })).toBe(1);
    expect(s.row(r.gameKey)).toMatchObject({ result: "win", result_method: "first_leaver_lost", result_confidence: "medium" });
    expect(s.events().some((e) => e.type === "reingested")).toBe(true);
    expect(settleW3cResults(s.ctx, { modeChanged: false, reread: true })).toBe(0); // nothing left to change

    // A game with W3Champions' winner keeps it.
    applyOfficial(s.ctx, r.gameKey, found(r, false));
    expect(settleW3cResults(s.ctx, { modeChanged: true, reread: true })).toBe(0);
    expect(s.row(r.gameKey)).toMatchObject({ result: "loss", result_method: "w3champions" });
  });

  test("turning the lookups off and on again: the games nothing decides follow, the others stay", async () => {
    const s = store("lookup");
    const r = await s.ingest(W3C, SILENT);
    expect(s.row(r.gameKey).result).toBe("reviewing");
    s.ctx.w3cResults = "off";
    expect(settleW3cResults(s.ctx, { modeChanged: false, reread: false })).toBe(0); // only when the mode changed
    expect(settleW3cResults(s.ctx, { modeChanged: true, reread: false })).toBe(1);
    expect(s.row(r.gameKey).result).toBe("unknown");
    s.ctx.w3cResults = "lookup";
    expect(settleW3cResults(s.ctx, { modeChanged: true, reread: false })).toBe(1);
    expect(s.row(r.gameKey).result).toBe("reviewing");

    const decided = store("lookup");
    const d = await decided.ingest();
    decided.ctx.w3cResults = "off";
    expect(settleW3cResults(decided.ctx, { modeChanged: true, reread: false })).toBe(0);
    expect(decided.row(d.gameKey).result).toBe("win");
  });
});
