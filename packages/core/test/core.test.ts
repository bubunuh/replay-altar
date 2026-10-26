// Runs against the real replays in fixtures/replays: replay1 is a W3Champions game, the others
// Battle.net ladder games; replay2 and replay4 are wins, replay3 a loss.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import {
  researchLevels,
  heroXpAt,
  levelUpTimes,
  playerLevelUps,
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
const W3C = "replay1.w3g";
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
      expect(c.source, f).toBe(f === W3C ? "w3champions" : "bnet_ladder");
      expect(c.seats.filter((s) => s.isObserver).map((s) => s.name), f).toEqual([f === W3C ? "FLO" : "Blizzard"]);
    }
  });

  test("results match the known outcomes", () => {
    const expected: Record<string, "win" | "loss"> = {
      "replay3.w3g": "loss",
      "replay2.w3g": "win",
      "replay4.w3g": "win",
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
  const base = "replay5.w3g";

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

describe.skipIf(files.length === 0)("damaged replays (missing first selections)", () => {
  const withActions = (actions: RawReplay["actions"]) => {
    const raw = clone(W3C);
    raw.actions = actions;
    return raw;
  };
  const ids = () => raw1Players().map((p) => String(p.id));
  const raw1Players = () => raws.get(W3C)!.output.players;
  test("no fixture is flagged: every player's first orders follow a selection", () => {
    for (const f of files) {
      const c = classify(raws.get(f)!, ME);
      expect(c.replayProblem, f).toBeNull();
      expect(c.rules.find((x) => x.rule === "replay.first_selections")?.passed, f).toBe(true);
    }
  });
  test("orders at the very start before any selection mark the replay damaged, and it stays analyzed", () => {
    const [a, b] = ids();
    const c = classify(withActions({ [a]: { firstSelectionMs: 8911, firstOrderMs: 30, ordersBeforeSelection: 15, skillMenuMs: [], tomeMs: [] }, [b]: { firstSelectionMs: 61, firstOrderMs: 900, ordersBeforeSelection: 0, skillMenuMs: [], tomeMs: [] } }), ME);
    expect(c.replayProblem).toBe("missing_first_selections");
    expect(c.analyzed).toBe(true);
    expect(c.rules.find((x) => x.rule === "replay.first_selections")).toMatchObject({ passed: false });
  });
  test("a worker trained from the hall selected at the start, before the first selection, is normal", () => {
    const [a, b] = ids();
    const c = classify(withActions({ [a]: { firstSelectionMs: 1681, firstOrderMs: 1410, ordersBeforeSelection: 1, skillMenuMs: [], tomeMs: [] }, [b]: { firstSelectionMs: 61, firstOrderMs: 900, ordersBeforeSelection: 0, skillMenuMs: [], tomeMs: [] } }), ME);
    expect(c.replayProblem).toBeNull();
  });
  test("raw files from before the check are not judged", () => {
    const c = classify(withActions(undefined), ME);
    expect(c.replayProblem).toBeNull();
    expect(c.rules.some((x) => x.rule === "replay.first_selections")).toBe(false);
  });
});

describe.skipIf(files.length === 0)("metrics", () => {
  test("replay3: Human timings come from the order stream", () => {
    const raw = raws.get("replay3.w3g")!;
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
  // Retraining cases from real replays (times in seconds; official levels from W3Champions).
  const pick = (s: number, value: string) => ({ type: "ability" as const, time: s * 1000, value });
  const retrain = (s: number) => ({ type: "retraining" as const, time: s * 1000 });
  const ms = (...s: number[]) => s.map((x) => x * 1000);
  test("w3gjs's retraining mark inserted before a real level-up: placed by its time, the level-up counts", () => {
    // Archmage: levels at 125, 179, 632, 797; Tome bought at 839 and 4 points re-spent. Official: level 4.
    const order = [pick(125.5, "AHwe"), pick(178.6, "AHab"), pick(632.4, "AHwe"), retrain(839.4), pick(797.2, "AHab"), pick(840.2, "AHbz"), pick(840.3, "AHbz"), pick(840.5, "AHab"), pick(840.7, "AHab")];
    expect(levelUpTimes(order)).toHaveLength(4);
    expect(playerLevelUps([{ abilityOrder: order }], { skillMenuMs: ms(125.4, 178.5, 632.3, 797.1, 840.1), tomeMs: ms(839.4) })[0]).toEqual(ms(125.5, 178.6, 632.4, 797.2));
  });
  test("clicks beyond the refunded points in the re-spend session were refused", () => {
    // Archmage level 5, Tome at 1183.7, six clicks for five points, Mass Teleport at 1308. Official: level 6.
    const order = [pick(125.9, "AHwe"), pick(157, "AHab"), pick(210.2, "AHwe"), pick(505.2, "AHab"), pick(824.5, "AHwe"), pick(824.7, "AHwe"), retrain(1183.7), pick(1186, "AHbz"), pick(1186.1, "AHbz"), pick(1186.2, "AHbz"), pick(1186.6, "AHab"), pick(1186.7, "AHab"), pick(1186.9, "AHab"), pick(1308.3, "AHmt")];
    expect(levelUpTimes(order)).toHaveLength(7); // the fallback counts the refused click
    expect(playerLevelUps([{ abilityOrder: order }], { skillMenuMs: ms(125.8, 156.9, 210.1, 505.1, 824.4, 1185.9, 1308.2), tomeMs: ms(1183.7) })[0]).toHaveLength(6);
  });
  test("a retraining w3gjs didn't mark is found from the tome and the re-spend session", () => {
    // Tome bought at 890, used at 1031: five points re-spent within a second.
    const order = [pick(125.6, "AHwe"), pick(167, "AHab"), pick(278.2, "AHwe"), pick(481.1, "AHab"), pick(1016.7, "AHwe"), pick(1031.5, "AHbz"), pick(1031.6, "AHbz"), pick(1031.8, "AHbz"), pick(1032, "AHab"), pick(1032.2, "AHab")];
    expect(levelUpTimes(order)).toHaveLength(9);
    expect(playerLevelUps([{ abilityOrder: order }], { skillMenuMs: ms(125.5, 166.9, 277.5, 480.8, 1016, 1031.4), tomeMs: ms(890) })[0]).toHaveLength(5);
  });
  test("re-spent points over two openings of the menu within a minute are re-picks; the ultimate after them is level 6", () => {
    const order = [pick(165.2, "AEsh"), pick(237.8, "AEbl"), pick(426.8, "AEsh"), pick(520.1, "AEbl"), pick(729.1, "AEsh"), pick(1067.1, "AEfk"), pick(1067.3, "AEfk"), pick(1067.4, "AEfk"), pick(1105.5, "AEbl"), pick(1533.5, "AEsv")];
    const levels = playerLevelUps([{ abilityOrder: order }], { skillMenuMs: ms(165.1, 237.8, 426.4, 519.3, 728.8, 1067, 1105, 1533.4), tomeMs: ms(1066.2) })[0];
    expect(levels).toEqual(ms(165.2, 237.8, 426.8, 520.1, 729.1, 1533.5));
  });
  test("a tome bought before a single level-up isn't a retraining, and other heroes are untouched", () => {
    const am = [pick(120, "AHwe"), pick(200, "AHab"), pick(400, "AHwe")];
    const mk = [pick(300, "AHtb"), pick(500, "AHbh")];
    expect(playerLevelUps([{ abilityOrder: am }, { abilityOrder: mk }], { skillMenuMs: ms(119, 199, 299, 399, 499), tomeMs: ms(390) })).toEqual([ms(120, 200, 400), ms(300, 500)]);
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
  const root = mkdtempSync(join(tmpdir(), "replay-altar-test-"));
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
  const inbox = join(root, "inbox");
  cpSync(FIXTURES, inbox, { recursive: true });
  // A saved replay's game time comes from its file's date, which a fresh checkout sets to now.
  const saved = new Date("2026-10-15T12:00:00Z");
  for (const f of files) utimesSync(join(inbox, f), saved, saved);
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
    expect((await ingestFile(ctx, join(inbox, "replay3.w3g"))).status).toBe("duplicate");
  });

  test("another copy of a known game becomes an alias, not a new game", async () => {
    // The game's own LastReplay.w3g, of a game first seen as a saved copy (replay5).
    const copy = join(inbox, "LastReplay.w3g");
    cpSync(join(inbox, "replay5.w3g"), copy);
    utimesSync(copy, new Date(), new Date());
    const out = await ingestFile(ctx, copy);
    expect(out.status).toBe("updated");
    if (out.status !== "updated") return;
    expect(out.record.provenance.files.map((f) => f.timeSource).sort()).toEqual(["lastreplay_mtime", "saved_file_mtime"]);
    expect(out.record.game.timeSource).toBe("lastreplay_mtime"); // the game's own file wins
    expect(out.record.userLabel).toBe("replay5");
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
    const key = (db.prepare("SELECT game_key FROM games WHERE user_label = 'replay3'").get() as { game_key: string }).game_key;
    db.prepare("INSERT INTO annotations (game_key, kind, source, body, created_at) VALUES (?, 'result_override', 'user', '{\"result\":\"win\"}', 'now')").run(key);
    await reingestAll(ctx);
    expect(db.prepare("SELECT result, result_detected FROM v_games WHERE game_key = ?").get(key)).toEqual({ result: "win", result_detected: "loss" });
  });
});

describe("repeated build orders", () => {
  test("the same building re-ordered within 5 s is one building", async () => {
    const { dropRepeatedBuildOrders } = await import("../src/gamedata.ts");
    const o = (ms: number, id: string) => ({ ms, id });
    expect(dropRepeatedBuildOrders([o(29_000, "hbar"), o(31_000, "hbar"), o(40_000, "hbar"), o(41_000, "hhou")]).map((x) => x.ms)).toEqual([29_000, 40_000, 41_000]);
  });
});

describe("replay folders", () => {
  test("a pick inside BattleNet keeps its Warcraft III folder; any other pick stays as it is", async () => {
    const { folderToAdd } = await import("../src/config.ts");
    expect(folderToAdd("/home/a/Documents/Warcraft III/BattleNet/393113008/Replays")).toBe("/home/a/Documents/Warcraft III");
    expect(folderToAdd("/home/a/Documents/Warcraft III/BattleNet")).toBe("/home/a/Documents/Warcraft III");
    expect(folderToAdd("/home/a/Downloads/replays")).toBe("/home/a/Downloads/replays");
  });

  test("an added folder of replays is read as a whole; a Warcraft III folder only under BattleNet/*/Replays", async () => {
    const { mkdirSync } = await import("node:fs");
    const { replayDirs } = await import("../src/config.ts");
    const root = mkdtempSync(join(tmpdir(), "replay-altar-dirs-"));
    const docs = join(root, "Warcraft III");
    for (const d of ["BattleNet/1/Replays/Multiplayer", "Maps", "CustomMapData"]) mkdirSync(join(docs, d), { recursive: true });
    mkdirSync(join(root, "mine/old"), { recursive: true });
    const dirs = replayDirs({ ...DEFAULT_CONFIG, warcraftDocuments: [docs, join(root, "mine"), join(root, "missing")] }).filter((d) => d.startsWith(root));
    expect(dirs).toEqual([join(docs, "BattleNet/1/Replays"), join(docs, "BattleNet/1/Replays/Multiplayer"), join(root, "mine"), join(root, "mine/old")]);
  });
});

describe("languages", () => {
  test("every metric has a name and description in every language", async () => {
    const { METRICS } = await import("../src/metrics.ts");
    const { METRIC_PT } = await import("../src/metrics.pt.ts");
    const { METRIC_ES } = await import("../src/metrics.es.ts");
    const { METRIC_FR } = await import("../src/metrics.fr.ts");
    for (const table of [METRIC_PT, METRIC_ES, METRIC_FR]) expect(METRICS.map((m) => m.key).filter((k) => !table[k])).toEqual([]);
  });

  test("tables follow the language when read; the system locale picks the default", async () => {
    const { resolveLanguage, setLanguage, trTable, decimal } = await import("../src/i18n.ts");
    const t = trTable({ win: ["Win", "Vitória", "Victoria", "Victoire"] });
    setLanguage("pt");
    expect(t.win).toBe("Vitória");
    setLanguage("fr");
    expect([t.win, decimal(2.5)]).toEqual(["Victoire", "2,5"]);
    setLanguage("en");
    expect([t.win, decimal(2.5)]).toEqual(["Win", "2.5"]);
    expect(["pt-BR", "es-MX", "es-ES", "fr-CA", "en-US", "de-DE"].map((l) => resolveLanguage(undefined, l))).toEqual(["pt", "es", "es", "fr", "en", "en"]);
    expect(resolveLanguage("en", "pt-BR")).toBe("en");
  });
});
