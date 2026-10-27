import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildRecord, endTimeOf, paths, parseReplay, type BuildEvent, type SimSummary } from "@replay-altar/core";
import { CONSTANTS, gamedataDir, loadCosts, simNotReady, simulateGame } from "../src/index.ts";
import { runIncome, spendFromOrders, type Timeline, type WOutput } from "../src/economy.ts";
import { neverMade, withoutNeverMade } from "../src/deaths.ts";
import { armyValueFn, heroUnit } from "../src/army.ts";
import { foodInUse } from "../src/food.ts";
import type { CostTables } from "../src/costs.ts";

const realData = paths().root;
const ready = simNotReady(realData) === null;
const costs = ready ? loadCosts(gamedataDir(realData)) : null;
const FIXTURE = join(import.meta.dirname, "../../../fixtures/replays/replay3.w3g");

const ev = (ms: number, kind: BuildEvent["kind"], code: string): BuildEvent => ({ ms, kind, code, name: code });

describe.skipIf(!ready)("spending from orders", () => {
  test("first hero is free, the second costs its table price", () => {
    const s = spendFromOrders([ev(60_000, "unit", "Hamg"), ev(400_000, "unit", "Hmkg")], costs!);
    expect(s).toEqual([{ t: 400_000, gold: costs!.units.Hmkg.gold, lumber: costs!.units.Hmkg.lumber }]);
  });
  test("tier and tower upgrades cost only the step, not the cumulative table value", () => {
    const [keep, guard] = spendFromOrders([ev(1, "building", "hkee"), ev(2, "building", "hgtw")], costs!);
    expect(keep).toMatchObject({ gold: costs!.units.hkee.gold - costs!.units.htow.gold, lumber: costs!.units.hkee.lumber - costs!.units.htow.lumber });
    expect(guard).toMatchObject({ gold: costs!.units.hgtw.gold - costs!.units.hwtw.gold });
  });
  test("research levels get more expensive", () => {
    const [l1, l2] = spendFromOrders([ev(1, "upgrade", "Rhra"), ev(2, "upgrade", "Rhra")], costs!);
    const u = costs!.upgrades.Rhra;
    expect(l1).toMatchObject({ gold: u.goldBase, lumber: u.lumberBase });
    expect(l2).toMatchObject({ gold: u.goldBase + u.goldMod, lumber: u.lumberBase + u.lumberMod });
  });
});

// Game data for the tests below, so they run without an install.
const unit = (gold: number, lumber: number, food: number, buildS: number, isHero = false) => ({ gold, lumber, food, foodMade: 0, buildMs: buildS * 1000, isHero });
const FAKE: CostTables = {
  version: "test", manifestSha256: "", items: {}, upgrades: {},
  units: { Hamg: unit(425, 100, 5, 55, true), Hmkg: unit(425, 100, 5, 55, true), Npal: unit(425, 100, 5, 55, true), hfoo: unit(135, 0, 2, 20), edoc: unit(255, 80, 4, 35), hmil: unit(75, 0, 1, 0), hpea: unit(75, 0, 1, 15) },
};
const hero = (code: string, firstPickMs: number, orderedMs?: number | null) => ({ order: 0, code, name: code, level: 1, levelUps: [firstPickMs], skills: [], retrainings: 0, orderedMs });

describe("heroes in the spending", () => {
  test("the heroes a player had are priced when ordered, the first one free", () => {
    const s = spendFromOrders([ev(300_000, "unit", "hfoo")], FAKE, [hero("Hamg", 120_000, 64_000), hero("Hmkg", 480_000, 410_000)]);
    expect(s).toEqual([{ t: 300_000, gold: 135, lumber: 0 }, { t: 410_000, gold: 425, lumber: 100 }]);
  });
  test("without the order time (older records), a hero is priced its training time before its first skill", () => {
    expect(spendFromOrders([], FAKE, [hero("Hamg", 120_000), hero("Npal", 500_000, null)])).toEqual([{ t: 445_000, gold: 425, lumber: 100 }]);
  });
});

describe("food used, from the units", () => {
  test("a unit counts from the start of its training until it dies; a hero from its order, dead or not; a Wisp until it becomes a building", () => {
    const costs: CostTables = { ...FAKE, units: { ...FAKE.units, ewsp: unit(60, 0, 1, 14) } };
    const units = [
      { itemId: "hpea", spawnTime: 500 }, // starting worker
      { itemId: "hfoo", spawnTime: 100_000, trainedTime: 130_000, lostState: { state: "lost", since: 200_000 } }, // queued, started at 110 s
      { itemId: "hfoo", spawnTime: 150_000, trainedTime: 170_000, lostState: { state: "possiblyLost", since: 400_000 } },
      { itemId: "ewsp", spawnTime: 10_000, trainedTime: 24_000, destroyedByBuilding: true, destroyedAt: 60_000 },
      { itemId: "hfoo", isBuilding: true, spawnTime: 0 },
      { itemId: "Hamg", spawnTime: 60_000, trainedTime: 119_000, lostState: { state: "lost", since: 300_000 } },
    ];
    const f = foodInUse(units, [hero("Hamg", 125_000, 64_000)], costs);
    const at = (t: number) => f.filter((s) => s.t <= t).at(-1)!.used;
    expect([at(0), at(1000), at(20_000), at(64_000), at(110_000), at(150_000), at(250_000), at(500_000)]).toEqual([0, 1, 2, 6, 8, 10, 8, 6]);
  });
});

describe("the simulation's unit for a hero", () => {
  test("a hero cancelled at the altar and ordered again later: the one trained before its first skill", () => {
    // Death Knight ordered at 1:49, cancelled at 2:16, ordered again at 6:06; first skill at 7:14.
    const phantom = { itemId: "Udea", trainedTime: 163_410 };
    const real = { itemId: "Udea", trainedTime: 421_000 };
    expect(heroUnit([phantom, real], "Udea", 434_000)).toBe(real);
  });
  test("a hero in another form (Metamorphosis) is still its unit", () => {
    const dh = { itemId: "Edmm", trainedTime: 123_000 };
    expect(heroUnit([dh], "Edem", 130_000)).toBe(dh);
  });
});

describe("which units count in the army value", () => {
  const units = [
    { itemId: "hfoo", trainedTime: 10_000 },
    // a train order the game refused: the selection lists never showed it
    { itemId: "hfoo", trainedTime: 20_000, lostState: { state: "possiblyLost", since: 20_000, source: "unlisted" } },
    { itemId: "hfoo", trainedTime: 30_000, lostState: { state: "lost", since: 90_000, source: "selection" } },
    // a Peasant called to arms that WC3V never saw go back to work
    { itemId: "hmil", spawnTime: 5_000, morphHistory: [{ gameTime: 50_000, itemId: "hmil", from: "hpea" }] },
  ];
  const o = { players: { "1": { teamId: 0, race: "H", parseConfidence: 1, units } } } as unknown as WOutput;

  test("a unit that never existed is left out, the output itself untouched", () => {
    expect(units.filter(neverMade)).toEqual([units[1]]);
    expect(withoutNeverMade(o).players["1"].units).toEqual([units[0], units[2], units[3]]);
    expect(o.players["1"].units).toHaveLength(4);
  });
  test("units count from training until WC3V's death; Militia are workers", () => {
    const value = armyValueFn(withoutNeverMade(o), 1, FAKE);
    expect([value(15_000), value(60_000), value(100_000)]).toEqual([135, 270, 135]);
  });
});

describe("income model", () => {
  const base = (over: Partial<Timeline>): Timeline => ({
    playerId: 1, race: "H", teamId: 0, endMs: 100_000, spend: [], losses: [],
    food: [{ t: 0, used: 10, max: 12 }], workers: [{ t: 0, total: 5, onBuild: 0, ghoulsOnLumber: 0 }],
    mines: [{ activeFrom: 0, until: Infinity }], tierStarts: { 2: null, 3: null }, heroLevels: [], parseConfidence: 1,
    extra: { eapm: null, usefulShare: null, dominance: [], battles: [], spellCasts: 0, firstScoutMs: null, heroRevives: 0, heroesDeadAtEnd: 0, firstAttackUpgradeMs: null, firstArmorUpgradeMs: null },
    ...over,
  });
  const k = { ...CONSTANTS, goldPerWorkerSecond: 2, lumberPerWorkerSecond: { H: 0.5, O: 0.5, U: 1, N: 0.5 } };

  test("5 workers on one mine for 100 s", () => {
    const last = runIncome(base({}), k).series.at(-1)!;
    expect(last.estGoldMined).toBe(5 * 2 * 100);
    expect(last.estLumberMined).toBe(0);
  });
  test("workers beyond 5 per mine go to lumber", () => {
    const last = runIncome(base({ workers: [{ t: 0, total: 8, onBuild: 1, ghoulsOnLumber: 0 }] }), k).series.at(-1)!;
    expect(last.estGoldMined).toBe(1000);
    expect(last.estLumberMined).toBe(2 * 0.5 * 100); // 8 - 1 building - 5 on gold
  });
  test("upkeep taxes gold income", () => {
    const low = runIncome(base({ food: [{ t: 0, used: 60, max: 70 }] }), k).series.at(-1)!;
    const high = runIncome(base({ food: [{ t: 0, used: 90, max: 100 }] }), k).series.at(-1)!;
    expect(low.estGoldMined).toBe(700);
    expect(high.estGoldMined).toBe(400);
  });
  test("a mine runs dry", () => {
    const last = runIncome(base({ endMs: 2_000_000 }), { ...k, goldPerMine: 3000 }).series.at(-1)!;
    expect(last.estGoldMined).toBe(3000);
  });
  test("Undead lumber comes from ghouls, not acolytes", () => {
    const last = runIncome(base({ race: "U", workers: [{ t: 0, total: 9, onBuild: 0, ghoulsOnLumber: 3 }] }), k).series.at(-1)!;
    expect(last.estLumberMined).toBe(3 * 1 * 100);
  });
  test("bank = start + mined - spent", () => {
    const last = runIncome(base({ spend: [{ t: 50_000, gold: 300, lumber: 20 }] }), k).series.at(-1)!;
    expect(last.estGoldBank).toBe(CONSTANTS.startGold + 1000 - 300);
    expect(last.estLumberBank).toBe(CONSTANTS.startLumber - 20);
  });
});

describe.skipIf(!ready || !existsSync(FIXTURE))("simulating a real replay", () => {
  test("replay3: WC3V runs and the economy is consistent", async () => {
    // A throwaway data root that borrows the extracted game data.
    const root = mkdtempSync(join(tmpdir(), "replay-altar-sim-"));
    mkdirSync(join(root, "sim/gamedata"), { recursive: true });
    symlinkSync(gamedataDir(realData), join(root, "sim/gamedata/current"));
    const raw = await parseReplay(readFileSync(FIXTURE));
    const st = statSync(FIXTURE);
    const file = { path: FIXTURE, sha256: "x", size: st.size, mtime: st.mtime.toISOString(), durationMs: raw.output.duration, ...endTimeOf(FIXTURE, st.mtimeMs) };
    const record = buildRecord({ raw, myAccounts: ["Pedrovisk#1486"], canonicalFile: file, files: [file], archivePath: FIXTURE, ingestedAt: "now" });

    const sim = (await simulateGame(record, { dataRoot: root, mapFolders: [] })) as Extract<SimSummary, { status: "ok" }>;
    expect(sim.status).toBe("ok");
    expect(sim.players).toHaveLength(2);
    for (const p of sim.players) {
      expect(p.parseConfidence).toBeGreaterThan(0.8);
      const ordered = record.players.find((x) => x.playerId === p.playerId)!.build.filter((b) => ["hpea", "opeo", "uaco", "ewsp"].includes(b.code)).length;
      for (const s of p.series) {
        expect(s.workers, `workers at ${s.t}`).toBeLessThanOrEqual(ordered + 5);
        expect(s.foodUsed).toBeLessThanOrEqual(100);
      }
      // Spending can't outrun income by much without the summary flagging it.
      const worst = Math.min(...p.series.map((s) => s.estGoldBank));
      if (worst < -200) expect(sim.warnings.join(" ")).toContain(`player ${p.playerId}`);
    }
    const me = sim.players.find((p) => p.playerId === record.classification.meId)!;
    expect(me.metrics.gold_spent_10m).toBeGreaterThan(4000);
    expect(me.metrics.workers_alive_10m).toBeGreaterThanOrEqual(10);
    // Effective APM (WC3V's counting) is plausible, and removing spam keeps only part of the actions.
    expect(me.metrics.eapm).toBeGreaterThan(20);
    expect(me.metrics.eapm).toBeLessThan(400);
    expect(me.metrics.useful_action_share).toBeGreaterThan(0.2);
    expect(me.metrics.useful_action_share).toBeLessThan(1);
    expect(me.metrics.army_food_10m).toBeGreaterThan(0);
    expect(me.series.some((s) => s.dominance !== null)).toBe(true);
  });
});

describe("map data names (as WC3V's data-tool names them)", () => {
  test("ladder, W3Champions and tournament file names", async () => {
    const { mapDataName } = await import("../src/maps.ts");
    expect(mapDataName("(2)EchoIsles_S2_v2.2.w3x")).toBe("EchoIsles_S2_v2.2");
    expect(mapDataName("5682_w3c_260706_2308_SunhoofMesa_v1.4.5c.w3m")).toBe("SunhoofMesa_v1.4.5c");
    expect(mapDataName("w3c_260816_0950_FairyTale_v1.3.1.w3x")).toBe("260816_0950_FairyTale_v1.3.1");
    expect(mapDataName("1v1_EchoIsles_v2.2_w3c_260125_1357_1051.w3x")).toBe("EchoIsles_v2.2");
  });
});
