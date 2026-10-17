import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildRecord, endTimeOf, paths, parseReplay, type BuildEvent, type SimSummary } from "@w3stats/core";
import { CONSTANTS, gamedataDir, loadCosts, simNotReady, simulateGame } from "../src/index.ts";
import { runIncome, spendFromOrders, type Timeline } from "../src/economy.ts";

const realData = paths().root;
const ready = simNotReady(realData) === null;
const costs = ready ? loadCosts(gamedataDir(realData)) : null;
const FIXTURE = join(import.meta.dirname, "../../../fixtures/replays/Macro_loss.w3g");

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
  test("Macro_loss: WC3V runs and the economy is consistent", async () => {
    // A throwaway data root that borrows the extracted game data.
    const root = mkdtempSync(join(tmpdir(), "w3stats-sim-"));
    mkdirSync(join(root, "sim/gamedata"), { recursive: true });
    symlinkSync(gamedataDir(realData), join(root, "sim/gamedata/current"));
    const raw = await parseReplay(readFileSync(FIXTURE));
    const st = statSync(FIXTURE);
    const file = { path: FIXTURE, sha256: "x", size: st.size, mtime: st.mtime.toISOString(), durationMs: raw.output.duration, ...endTimeOf(FIXTURE, st.mtimeMs) };
    const record = buildRecord({ raw, myAccounts: ["Pedrovisk#1486"], canonicalFile: file, files: [file], archivePath: FIXTURE, ingestedAt: "now" });

    const sim = (await simulateGame(record, { dataRoot: root, warcraftDocuments: [] })) as Extract<SimSummary, { status: "ok" }>;
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
