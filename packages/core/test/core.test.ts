// Runs against the real replays in fixtures/replays (kept out of git; copy them in to run).
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import {
  researchLevels,
  heroXpAt,
  levelUpTimes,
  classify,
  computeMetrics,
  DEFAULT_CONFIG,
  hallIdleMs,
  detectResult,
  endTimeOf,
  ingestFile,
  openDb,
  parseReplay,
  reingestAll,
  type Config,
  type RawReplay,
} from "../src/index.ts";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/replays");
const ME = ["Pedrovisk#1486"];
const files = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => f.endsWith(".w3g")).sort() : [];
const raws = new Map<string, RawReplay>();

beforeAll(async () => {
  for (const f of files) raws.set(f, await parseReplay(readFileSync(join(FIXTURES, f))));
});

const clone = (f: string) => structuredClone(raws.get(f)!);

describe.skipIf(files.length === 0)("classification of real replays", () => {
  test("every fixture is an analyzed 1v1 against a human, from the right ladder", () => {
    for (const f of files) {
      const c = classify(raws.get(f)!, ME);
      expect(c.category, f).toBe("1v1_human");
      expect(c.analyzed, f).toBe(true);
      expect(c.source, f).toBe(f.startsWith("w3c-") ? "w3champions" : "bnet_ladder");
      expect(c.seats.filter((s) => s.isObserver).map((s) => s.name), f).toEqual([f.startsWith("w3c-") ? "FLO" : "Blizzard"]);
    }
  });

  test("results match what the file names say", () => {
    const expected: Record<string, "win" | "loss"> = {
      "Macro_loss.w3g": "loss",
      "Victory-1v1-oct-2026.w3g": "win",
      "victory_vs_elf.w3g": "win",
    };
    for (const [f, result] of Object.entries(expected)) {
      const raw = raws.get(f)!;
      const r = detectResult(raw, classify(raw, ME));
      expect(r.me, f).toBe(result);
      expect(r.confidence, f).toBe("high");
    }
  });

  test("our winner agrees with w3gjs on every fixture", () => {
    for (const f of files) {
      const raw = raws.get(f)!;
      expect(detectResult(raw, classify(raw, ME)).winnerTeamId, f).toBe(raw.output.winningTeamId);
    }
  });
});

describe.skipIf(files.length === 0)("classification of edited replays", () => {
  const base = "LastReplay.w3g";

  test("a computer opponent makes it vs_ai", () => {
    const raw = clone(base);
    const opp = raw.meta.slotRecords.find((s) => s.slotStatus === 2 && s.teamId === 1)!;
    opp.computerFlag = 1;
    const c = classify(raw, ME);
    expect([c.category, c.analyzed, c.skipReason]).toEqual(["vs_ai", false, "vs_ai"]);
  });

  test("sitting in the observer slot makes it observed", () => {
    const raw = clone(base);
    const meId = raw.output.players.find((p) => p.name === ME[0])!.id;
    raw.meta.slotRecords.find((s) => s.playerId === meId)!.teamId = 24;
    const c = classify(raw, ME);
    expect([c.category, c.skipReason]).toEqual(["observed", "observed"]);
  });

  test("someone else's game is not mine", () => {
    const c = classify(clone(base), ["Somebody#1"]);
    expect([c.category, c.skipReason]).toEqual(["observed", "not_me"]);
  });

  test("a third human makes it a team game", () => {
    const raw = clone(base);
    raw.meta.slotRecords.push({ ...raw.meta.slotRecords.find((s) => s.teamId === 1)!, playerId: 9 });
    raw.meta.playerRecords.push({ playerId: 9, playerName: "Ally#1" });
    const c = classify(raw, ME);
    expect([c.category, c.skipReason]).toEqual(["team", "not_1v1"]);
  });

  test("custom lobby 1v1 on a melee map is analyzed", () => {
    const raw = clone(base);
    raw.meta.gameName = "pedro practice";
    raw.meta.slotRecords = raw.meta.slotRecords.filter((s) => s.teamId !== 24);
    const c = classify(raw, ME);
    expect([c.source, c.category, c.analyzed]).toEqual(["custom", "1v1_human", true]);
  });

  test("custom lobby 1v1 on a custom map is skipped", () => {
    const raw = clone(base);
    raw.meta.gameName = "lobby";
    raw.output.map.file = "Legion TD 7.2.w3x";
    const c = classify(raw, ME);
    expect([c.source, c.analyzed, c.skipReason]).toEqual(["custom", false, "custom_map"]);
  });
});

describe.skipIf(files.length === 0)("metrics", () => {
  test("Macro_loss: Human timings come from the order stream", () => {
    const raw = raws.get("Macro_loss.w3g")!;
    const me = raw.output.players.find((p) => p.name === ME[0])!;
    const m = computeMetrics(raw, me.id!);
    expect(m.tier2_ms).toBe(220693); // Keep ordered at 3:40
    expect(m.hero1_ms).toBe(131191); // Archmage skilled Water Elemental at 2:11
    expect(m.heroes_count).toBe(2);
    expect(m.hotkey_select_share).toBeCloseTo(619 / (619 + 475), 6);
    expect(m.control_groups_used).toBe(4); // groups 1, 2, 4, 5
    // Peasant production stopped around 2:30 and only resumed after 10:00.
    expect(m.hall_idle_10m_s).toBeGreaterThan(m.hall_idle_6m_s! + 200);
    expect(m.tp_bought).toBe(0);
    // Archmage at level 4 and Mountain King at level 4 by the end: 2 x (900 + 250).
    expect(m.hero_xp_total).toBe(2300);
    expect(m.hero_level3_ms).toBe(366_783);
  });
});

describe("hero experience", () => {
  const a = (time: number) => ({ type: "ability" as const, time });
  test("level-ups are skill picks; a retraining's re-picks are not", () => {
    expect(levelUpTimes([a(60), a(200), { type: "retraining", time: 500 }, a(501), a(502), a(700)])).toEqual([60, 200, 700]);
  });
  test("clicks the game refuses are not level-ups", () => {
    const pick = (time: number, value: string) => ({ type: "ability" as const, time, value });
    // Clicking Divine Shield 12 times on a new Paladin: rank 2 needs hero level 3.
    expect(levelUpTimes(Array.from({ length: 12 }, (_, i) => pick(1_458_000 + i * 100, "AHds")))).toEqual([1_458_000]);
    // Holy Light, Devotion, Holy Light (level 3: rank 2 allowed), a 4th rank of nothing, then the
    // ultimate only from level 6.
    const seq = [pick(1, "AHhb"), pick(2, "AHad"), pick(3, "AHhb"), pick(4, "AHre"), pick(5, "AHad"), pick(6, "AHhb"), pick(7, "AHhb"), pick(8, "AHre")];
    expect(levelUpTimes(seq)).toEqual([1, 2, 3, 5, 6, 8]);
  });
  test("exact at level-ups, linear in between", () => {
    const levels = [60_000, 200_000, 400_000]; // level 1, 2, 3
    expect(heroXpAt(levels, 200_000, 900_000)).toBe(200);
    expect(heroXpAt(levels, 300_000, 900_000)).toBe(350); // halfway from 200 to 500
    expect(heroXpAt(levels, 30_000, 900_000)).toBe(0); // not acquired yet
  });
  test("after the last level-up it grows to half the next level by the end", () => {
    const levels = [60_000, 200_000, 400_000];
    expect(heroXpAt(levels, 900_000, 900_000)).toBe(500 + 200); // level 3 + half of 400
  });
});

describe("research levels", () => {
  const up = (code: string, s: number) => ({ kind: "upgrade", code, ms: s * 1000 });
  test("levels count up, a quick re-order is a requeue, and one-level upgrades stay at 1", () => {
    expect(researchLevels([up("Rhme", 300), up("Rhme", 310), up("Rhri", 400), up("Rhme", 500), up("Rhri", 600)])).toEqual([
      { code: "Rhme", level: 1, ms: 300_000 },
      { code: "Rhri", level: 1, ms: 400_000 },
      { code: "Rhme", level: 2, ms: 500_000 },
    ]);
  });
});

describe("main hall idle time", () => {
  const w = (s: number) => ({ id: "hpea", ms: s * 1000 });
  test("back-to-back workers leave the hall idle only before the first order", () => {
    expect(hallIdleMs("H", [w(2), w(3), w(4), w(5)], 60_000)).toBe(2000); // busy 2 s → 62 s
  });
  test("gaps between queues count", () => {
    expect(hallIdleMs("H", [w(0), w(30)], 60_000)).toBe(15_000 + 15_000); // idle 15–30 s and 45–60 s
  });
  test("a tier upgrade keeps the hall busy", () => {
    expect(hallIdleMs("H", [w(0), { id: "hkee", ms: 15_000 }], 120_000)).toBe(0);
  });
});

describe("time of game", () => {
  test("W3Champions file names are UTC end times", () => {
    expect(endTimeOf("/x/w3c-20261012212003.w3g", 0)).toEqual({ endedAt: "2026-10-12T21:20:03.000Z", timeSource: "w3c_filename" });
  });
  test("LastReplay mtime is the end of the game; other names are saved copies", () => {
    expect(endTimeOf("/x/LastReplay.w3g", 0).timeSource).toBe("lastreplay_mtime");
    expect(endTimeOf("/x/Macro_loss.w3g", 0).timeSource).toBe("saved_file_mtime");
  });
});

describe.skipIf(files.length === 0)("ingest", () => {
  const root = mkdtempSync(join(tmpdir(), "w3stats-test-"));
  const paths = {
    root,
    db: join(root, "w3stats.sqlite"),
    archive: join(root, "archive"),
    superseded: join(root, "archive/superseded"),
    games: join(root, "games"),
    raw: join(root, "raw"),
    events: join(root, "events.jsonl"),
  };
  const config: Config = { ...DEFAULT_CONFIG, accounts: ME, warcraftDocuments: [], openWindowOnGameStart: false, notifyAfterGame: false };
  const inbox = join(root, "inbox");
  cpSync(FIXTURES, inbox, { recursive: true, preserveTimestamps: true });
  const db = openDb(paths.db);
  const ctx = { db, config, paths };
  const dump = () =>
    ["games", "game_players", "player_metrics", "build_events", "heroes", "hero_skills", "apm_minutes", "files", "classification_reasons"].map((t) =>
      db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2, 3`).all(),
    );

  test("each replay becomes one archived game", async () => {
    for (const f of files) expect((await ingestFile(ctx, join(inbox, f))).status, f).toBe("new");
    expect(db.prepare("SELECT COUNT(*) n FROM games").get()).toEqual({ n: files.length });
    expect(readdirSync(join(paths.archive, "2026/10")).length).toBe(files.length);
  });

  test("ingesting the same file again does nothing", async () => {
    expect((await ingestFile(ctx, join(inbox, "Macro_loss.w3g"))).status).toBe("duplicate");
  });

  test("another copy of a known game becomes an alias, not a new game", async () => {
    const copy = join(inbox, "my_rename.w3g");
    cpSync(join(inbox, "LastReplay.w3g"), copy);
    utimesSync(copy, new Date(), new Date());
    const out = await ingestFile(ctx, copy);
    expect(out.status).toBe("updated");
    if (out.status !== "updated") return;
    expect(out.record.provenance.files.map((f) => f.timeSource).sort()).toEqual(["lastreplay_mtime", "saved_file_mtime"]);
    expect(out.record.game.timeSource).toBe("lastreplay_mtime"); // the game's own file wins
    expect(out.record.userLabel).toBe("my_rename");
    expect(db.prepare("SELECT COUNT(*) n FROM games").get()).toEqual({ n: files.length });
  });

  test("reingest from the archive reproduces the database exactly", async () => {
    const before = dump();
    const out = await reingestAll(ctx);
    expect(out.errors).toEqual([]);
    expect(out.games).toBe(files.length);
    expect(dump()).toEqual(before);
  });

  test("a manual result override survives reingest", async () => {
    const key = (db.prepare("SELECT game_key FROM games WHERE user_label = 'Macro_loss'").get() as { game_key: string }).game_key;
    db.prepare("INSERT INTO annotations (game_key, kind, source, body, created_at) VALUES (?, 'result_override', 'user', '{\"result\":\"win\"}', 'now')").run(key);
    await reingestAll(ctx);
    expect(db.prepare("SELECT result, result_detected FROM v_games WHERE game_key = ?").get(key)).toEqual({ result: "win", result_detected: "loss" });
  });
});
