// A W3Champions game leaves two replays: the game's own (LastReplay.w3g, named
// w3c-20-<match>-<player's number>) and the W3Champions launcher's (w3c-<date>.w3g, named
// w3c-20-<match>). Up to 0.2.4 they were two games. Made here from fixture replay1 (a W3Champions
// game): the game's copy with the suffix written into its name, the launcher's cut a little short.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, inflateSync, constants } from "node:zlib";
import { beforeAll, describe, expect, test } from "vitest";
import {
  applyOfficial,
  applySim,
  DEFAULT_CONFIG,
  gameKeyOf,
  ingestFile,
  matchGameName,
  openDb,
  parseReplay,
  rawPath,
  readRaw,
  readRecord,
  recordPath,
  reingestAll,
  rekeyGames,
  transaction,
  writeGame,
  type Config,
  type IngestContext,
  type RawReplay,
  type SimSummary,
} from "../src/index.ts";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/replays");
const W3C = join(FIXTURES, "replay1.w3g");
const ME = ["Pedrovisk#1486"];

/** The replay with `suffix` added to its game name (blocks decompressed, the name grown, compressed again). */
function withNameSuffix(file: Buffer, suffix: string): Buffer {
  const start = file.indexOf("Warcraft III recorded game");
  const headerSize = file.readUInt32LE(start + 28);
  const blocks: Buffer[] = [];
  for (let off = start + headerSize; off < file.length; ) {
    const size = file.readUInt32LE(off);
    const decompressed = file.readUInt32LE(off + 4);
    const content = file.subarray(off + 12, off + 12 + size);
    off += 12 + size;
    if (decompressed === 8192) blocks.push(inflateSync(content, { finishFlush: constants.Z_SYNC_FLUSH }));
  }
  let data = Buffer.concat(blocks);
  const name = data.indexOf("w3c-");
  const end = data.indexOf(0, name);
  data = Buffer.concat([data.subarray(0, end), Buffer.from(suffix), data.subarray(end)]);
  data = Buffer.concat([data, Buffer.alloc((8192 - (data.length % 8192)) % 8192)]);
  const parts = [file.subarray(0, start + headerSize)];
  for (let i = 0; i < data.length; i += 8192) {
    const z = deflateSync(data.subarray(i, i + 8192));
    const h = Buffer.alloc(12);
    h.writeUInt32LE(z.length, 0);
    h.writeUInt32LE(8192, 4);
    parts.push(h, z);
  }
  const out = Buffer.concat(parts);
  out.writeUInt32LE(out.length, start + 32);
  out.writeUInt32LE(data.length, start + 40);
  out.writeUInt32LE(data.length / 8192, start + 44);
  return out;
}

const original = readFileSync(W3C);
/** The game's own copy, my number in its name. */
const gameCopy = withNameSuffix(original, "-1102274");
/** The launcher's copy: no number, a few seconds shorter. */
const launcherCopy = original.subarray(0, original.length - 600);
let launcherRaw: RawReplay;
let gameRaw: RawReplay;

beforeAll(async () => {
  const quiet = console.error;
  console.error = () => {}; // w3gjs logs the actions it can't read in the cut, last record
  try {
    launcherRaw = await parseReplay(launcherCopy);
  } finally {
    console.error = quiet;
  }
  gameRaw = await parseReplay(gameCopy);
});

function newStore() {
  const root = mkdtempSync(join(tmpdir(), "replay-altar-keys-"));
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
  const config: Config = { ...DEFAULT_CONFIG, accounts: ME, warcraftDocuments: [], openWindowOnGameStart: false, notifyAfterGame: false };
  const ctx: IngestContext = { db: openDb(paths.db), config, paths };
  const replays = join(root, "Replays");
  mkdirSync(replays);
  const ended = new Date("2026-11-08T21:49:49Z");
  const put = (name: string, buf: Buffer, at = ended) => {
    const f = join(replays, name);
    writeFileSync(f, buf);
    utimesSync(f, at, at);
    return f;
  };
  return {
    root,
    ctx,
    lastReplay: () => put("LastReplay.w3g", gameCopy),
    launcher: () => put("w3c-20261108214942.w3g", launcherCopy, new Date("2026-11-08T21:49:43Z")),
    games: () => ctx.db.prepare("SELECT game_key, game_name FROM games").all() as { game_key: string; game_name: string }[],
  };
}

const fakeSim = (outputPath: string): SimSummary => ({
  status: "ok",
  engine: { name: "wc3v", commit: "test" },
  gameData: { version: "test", manifestSha256: "test" },
  model: { version: 1, constants: {} },
  ranAt: "2026-11-08T22:00:00Z",
  runMs: 1,
  outputPath,
  players: [],
  warnings: [],
});

/** The game as 0.2.4 stored it: under w3gjs's id (its sim output too). Returns that key. */
function storeAsBefore(ctx: IngestContext, key: string): string {
  const { paths, db } = ctx;
  const record = readRecord(paths, key)!;
  const raw = readRaw(paths, key);
  const old = raw.output.id;
  record.gameKey = old;
  if (record.sim?.status === "ok" && existsSync(record.sim.outputPath)) {
    const to = join(paths.root, "sim/out", `${old}.wc3v.gz`);
    renameSync(record.sim.outputPath, to);
    record.sim.outputPath = to;
  }
  renameSync(rawPath(paths, key), rawPath(paths, old));
  rmSync(recordPath(paths, key));
  writeFileSync(recordPath(paths, old), JSON.stringify(record));
  transaction(db, () => {
    db.prepare("DELETE FROM games WHERE game_key = ?").run(key);
    writeGame(db, record, record.provenance.canonicalFile.sha256);
  });
  return old;
}

describe("the game's name in the key", () => {
  test("a W3Champions player's number is left out; the match id stays whole, a '-8' of its own too", () => {
    expect(matchGameName("w3c-20-o6WD8g57v2-1102274")).toBe("w3c-20-o6WD8g57v2");
    expect(matchGameName("w3c-20-ovTGLQtR-8-1102274")).toBe("w3c-20-ovTGLQtR-8");
    expect(matchGameName("w3c-20-03dqAxTZu-581")).toBe("w3c-20-03dqAxTZu"); // 9-letter match ids
    expect(matchGameName("w3c-20-1-_6wXXVo-581")).toBe("w3c-20-1-_6wXXVo");
    expect(matchGameName("w3c-20-zPCQut42k-2153955")).toBe(matchGameName("w3c-20-zPCQut42k-5249")); // each player's copy
    for (const same of ["w3c-20-o6WD8g57v2", "w3c-20-ovTGLQtR-8", "w3c-20-03dqAxTZu", "w3c-20-i6a-PdViPM", "BNet", "FLO-STREAM", "Pedro_vs_gui-123", "w3c-20-short-1"]) {
      expect(matchGameName(same), same).toBe(same);
    }
  });

  test("every other game keeps w3gjs's id: games stored before keep their key", async () => {
    for (const f of readdirSync(FIXTURES).filter((x) => x.endsWith(".w3g"))) {
      const raw = await parseReplay(readFileSync(join(FIXTURES, f)));
      expect(gameKeyOf(raw), f).toBe(raw.output.id);
    }
    expect(gameKeyOf(launcherRaw)).toBe(launcherRaw.output.id);
  });

  test("both copies of a W3Champions game have the launcher copy's key", () => {
    expect(gameRaw.meta.gameName).toBe("w3c-20-wwZ45KMNz5-1102274");
    expect(launcherRaw.meta.gameName).toBe("w3c-20-wwZ45KMNz5");
    expect(gameRaw.meta.randomSeed).toBe(launcherRaw.meta.randomSeed);
    expect(gameRaw.output.id).not.toBe(launcherRaw.output.id); // w3gjs's id: two games
    expect(gameKeyOf(gameRaw)).toBe(gameKeyOf(launcherRaw));
    expect(gameRaw.output.duration).toBeGreaterThan(launcherRaw.output.duration);
  });

  test("the opponent's copy, with their number, is the same game", async () => {
    expect(gameKeyOf(await parseReplay(withNameSuffix(original, "-5249")))).toBe(gameKeyOf(gameRaw));
  });
});

describe("a W3Champions game's two copies are one game", () => {
  test("the launcher's copy first: the game's longer copy joins it and becomes canonical", async () => {
    const s = newStore();
    const first = await ingestFile(s.ctx, s.launcher());
    expect(first.status).toBe("new");
    const second = await ingestFile(s.ctx, s.lastReplay());
    expect(second.status).toBe("updated");
    if (second.status !== "updated") return;
    expect(second.needsSim).toBe(true); // the canonical file changed
    expect(s.games()).toEqual([{ game_key: gameKeyOf(launcherRaw), game_name: "w3c-20-wwZ45KMNz5-1102274" }]);
    expect(second.record.provenance.files.map((f) => f.path.split(/[\\/]/).pop()).sort()).toEqual(["LastReplay.w3g", "w3c-20261108214942.w3g"]);
    expect(second.record.provenance.canonicalFile.durationMs).toBe(gameRaw.output.duration);
    expect(readdirSync(join(s.root, "archive/superseded"))).toHaveLength(1); // the launcher's archived copy
    expect((await ingestFile(s.ctx, s.launcher())).status).toBe("duplicate");
    expect((await ingestFile(s.ctx, s.lastReplay())).status).toBe("duplicate");
  });

  test("the game's copy first: the launcher's shorter one is only another file of it", async () => {
    const s = newStore();
    expect((await ingestFile(s.ctx, s.lastReplay())).status).toBe("new");
    const second = await ingestFile(s.ctx, s.launcher());
    expect(second.status).toBe("updated");
    if (second.status !== "updated") return;
    expect(second.needsSim).toBe(true); // never simulated yet
    expect(s.games()).toEqual([{ game_key: gameKeyOf(gameRaw), game_name: "w3c-20-wwZ45KMNz5-1102274" }]);
    expect(second.record.provenance.files).toHaveLength(2);
    expect(existsSync(join(s.root, "archive/superseded"))).toBe(false);
  });
});

describe("games stored by 0.2.4 under two keys", () => {
  /** The game's copy imported and simulated, then the launcher's, as 0.2.4 left them. */
  async function before025() {
    const s = newStore();
    const { ctx } = s;
    const key = gameKeyOf(gameRaw);
    const out = await ingestFile(ctx, s.lastReplay());
    expect(out.status).toBe("new");
    const sim = join(s.root, "sim/out", `${key}.wc3v.gz`);
    mkdirSync(join(s.root, "sim/out"), { recursive: true });
    writeFileSync(sim, "the game's copy's simulation");
    applySim(ctx, key, fakeSim(sim));
    const old = storeAsBefore(ctx, key);
    // A result you corrected, on the game's copy.
    ctx.db.prepare("INSERT INTO annotations (game_key, kind, source, body, created_at) VALUES (?, 'result_override', 'user', '{\"result\":\"loss\"}', 'now')").run(old);
    // The launcher's copy, with the W3Champions statistics found for it.
    expect((await ingestFile(ctx, s.launcher())).status).toBe("new");
    applyOfficial(ctx, key, { status: "ok", source: "w3champions", matchId: "m1", fetchedAt: "now", players: [] });
    expect(s.games().map((g) => g.game_key).sort()).toEqual([key, old].sort());
    return { ...s, key, old };
  }

  test("they become one game, with everything both had", async () => {
    const s = await before025();
    const { ctx, key, old } = s;
    expect(rekeyGames(ctx)).toEqual({ moved: 1, merged: 1, errors: [] });
    expect(s.games()).toEqual([{ game_key: key, game_name: "w3c-20-wwZ45KMNz5-1102274" }]);
    const r = readRecord(ctx.paths, key)!;
    expect(r.gameKey).toBe(key);
    expect(r.provenance.canonicalFile.durationMs).toBe(gameRaw.output.duration); // the longer copy
    expect(r.provenance.files.map((f) => f.path.split(/[\\/]/).pop()).sort()).toEqual(["LastReplay.w3g", "w3c-20261108214942.w3g"]);
    expect(ctx.db.prepare("SELECT COUNT(*) n FROM files WHERE game_key = ?").get(key)).toEqual({ n: 2 });
    // Its simulation, its output under the key; the W3Champions statistics; your correction.
    expect(r.sim?.status === "ok" && r.sim.outputPath).toBe(join(s.root, "sim/out", `${key}.wc3v.gz`));
    expect(readFileSync(join(s.root, "sim/out", `${key}.wc3v.gz`), "utf8")).toBe("the game's copy's simulation");
    expect(readdirSync(join(s.root, "sim/out"))).toEqual([`${key}.wc3v.gz`]);
    expect(r.official).toMatchObject({ status: "ok", matchId: "m1" });
    expect(ctx.db.prepare("SELECT sim_status FROM games WHERE game_key = ?").get(key)).toEqual({ sim_status: "ok" });
    expect(ctx.db.prepare("SELECT result FROM v_games WHERE game_key = ?").get(key)).toMatchObject({ result: "loss" });
    expect(ctx.db.prepare("SELECT COUNT(*) n FROM annotations WHERE game_key = ?").get(old)).toEqual({ n: 0 });
    // Nothing left under the old key; the launcher's archived copy superseded.
    expect(existsSync(recordPath(ctx.paths, old))).toBe(false);
    expect(existsSync(rawPath(ctx.paths, old))).toBe(false);
    expect(readdirSync(join(s.root, "archive/superseded"))).toHaveLength(1);
    expect(readdirSync(join(s.root, "games"))).toEqual([`${key}.json`]);
    // The window hears of it.
    expect(readFileSync(join(s.root, "events.jsonl"), "utf8")).toContain('"type":"reingested","games":1');
  });

  test("done once: again it finds nothing, and the files are known", async () => {
    const s = await before025();
    rekeyGames(s.ctx);
    expect(rekeyGames(s.ctx)).toEqual({ moved: 0, merged: 0, errors: [] });
    expect((await ingestFile(s.ctx, s.lastReplay())).status).toBe("duplicate");
    expect((await ingestFile(s.ctx, s.launcher())).status).toBe("duplicate");
  });

  test("a reingest after it rebuilds the one game as it was", async () => {
    const s = await before025();
    rekeyGames(s.ctx);
    const dump = () => ["games", "files", "game_players", "player_metrics"].map((t) => s.ctx.db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2, 3`).all());
    const before = dump();
    expect(await reingestAll(s.ctx)).toEqual({ games: 1, errors: [] });
    expect(dump()).toEqual(before);
  });

  test("a reingest before it moves the games itself", async () => {
    const s = await before025();
    const out = await reingestAll(s.ctx);
    expect(out.errors).toEqual([]);
    expect(s.games()).toEqual([{ game_key: s.key, game_name: "w3c-20-wwZ45KMNz5-1102274" }]);
    expect(readRecord(s.ctx.paths, s.key)!.official).toMatchObject({ status: "ok" });
  });

  test("the game's copy alone (the launcher kept none): it only moves to its key", async () => {
    const s = newStore();
    const key = gameKeyOf(gameRaw);
    await ingestFile(s.ctx, s.lastReplay());
    const sim = join(s.root, "sim/out", `${key}.wc3v.gz`);
    mkdirSync(join(s.root, "sim/out"), { recursive: true });
    writeFileSync(sim, "sim");
    applySim(s.ctx, key, fakeSim(sim));
    const old = storeAsBefore(s.ctx, key);
    expect(rekeyGames(s.ctx)).toEqual({ moved: 1, merged: 0, errors: [] });
    expect(s.games()).toEqual([{ game_key: key, game_name: "w3c-20-wwZ45KMNz5-1102274" }]);
    expect(readdirSync(join(s.root, "sim/out"))).toEqual([`${key}.wc3v.gz`]);
    expect(existsSync(recordPath(s.ctx.paths, old))).toBe(false);
    expect(existsSync(join(s.root, "archive/superseded"))).toBe(false);
  });
});

describe("transactions", () => {
  test("one inside another is part of it: its failure undoes only itself when caught", () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), "replay-altar-tx-")), "db.sqlite"));
    transaction(db, () => {
      db.prepare("INSERT INTO meta VALUES ('a', '1')").run();
      expect(() =>
        transaction(db, () => {
          db.prepare("INSERT INTO meta VALUES ('b', '1')").run();
          throw new Error("no");
        }),
      ).toThrow("no");
      transaction(db, () => db.prepare("INSERT INTO meta VALUES ('c', '1')").run());
    });
    expect((db.prepare("SELECT key FROM meta WHERE key IN ('a', 'b', 'c') ORDER BY key").all() as { key: string }[]).map((r) => r.key)).toEqual(["a", "c"]);
    expect(() => transaction(db, () => {
      db.prepare("INSERT INTO meta VALUES ('d', '1')").run();
      throw new Error("all of it");
    })).toThrow();
    expect(db.prepare("SELECT 1 FROM meta WHERE key = 'd'").get()).toBeUndefined();
  });
});
