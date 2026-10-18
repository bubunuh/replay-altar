import { describe, expect, test } from "vitest";
import type { GameRecord, SimSample } from "@w3stats/core/ui";
import { findings, opponentPlan, unverifiedNumbers } from "@w3stats/ai";
import { leads } from "../src/series.ts";

describe("number check", () => {
  test("flags numbers and times that are not in the sources", () => {
    const sources = "Workers at 10:00: you 13, opp 12 (pros median 20). Lost ≈1,790 at 17:41.";
    expect(unverifiedNumbers("You had 13 workers at 10:00 and lost 1790 at 17:41.", sources)).toEqual([]);
    expect(unverifiedNumbers("You had 14 workers at 10:30 and 3 heroes.", sources)).toEqual(["10:30", "14"]); // single digits pass
  });
});

describe("leads", () => {
  test("spans of who was ahead; ties keep the current leader", () => {
    const rows = [
      { t: 120_000, me: 0, opp: 0 },
      { t: 240_000, me: 5, opp: 0 },
      { t: 360_000, me: 5, opp: 5 },
      { t: 480_000, me: 2, opp: 9 },
    ];
    expect(leads(rows)).toBe("even 2:00, you led 4:00–6:00, opp led 8:00");
  });
});

// A 14-minute HvH game: the opponent makes no army until 10:00 while you have one.
function game(opts: { youExpandAt?: number; yourFood?: (t: number) => number; theirHeroLevelUps?: number[] }): GameRecord {
  const series = (army: (t: number) => number, workers: number, food: (t: number) => number = () => 10): SimSample[] =>
    Array.from({ length: 85 }, (_, i) => {
      const t = i * 10_000;
      return { t, goldSpent: 0, lumberSpent: 0, goldLost: 0, lumberLost: 0, foodUsed: food(t), foodMax: 30, workers, estGoldMined: 0, estLumberMined: 0, estGoldBank: 0, estLumberBank: 0, dominance: null, armyFood: army(t) / 70, armyValue: army(t) };
    });
  const player = (id: number, isMe: boolean, build: GameRecord["players"][number]["build"], levelUps = [120_000, 400_000]) =>
    ({ playerId: id, teamId: id, isMe, name: isMe ? "Me#1" : "Them#2", race: "H", build, heroes: [{ order: 1, code: "Hamg", name: "Archmage", level: 2, levelUps, skills: [], retrainings: 0 }], metrics: {} }) as unknown as GameRecord["players"][number];
  const myBuild = [{ ms: 200_000, kind: "unit" as const, code: "hrif", name: "Rifleman" }, ...(opts.youExpandAt ? [{ ms: opts.youExpandAt, kind: "building" as const, code: "htow", name: "Town Hall" }] : [])];
  const theirBuild = [
    { ms: 180_000, kind: "building" as const, code: "hkee", name: "Keep" },
    { ms: 100_000, kind: "building" as const, code: "hgtw", name: "Guard Tower" },
    { ms: 610_000, kind: "unit" as const, code: "hgry", name: "Gryphon Rider" },
  ];
  return {
    gameKey: "k",
    game: { durationMs: 840_000 },
    classification: { opponentId: 2 },
    players: [player(1, true, myBuild), player(2, false, theirBuild, opts.theirHeroLevelUps)],
    sim: {
      status: "ok",
      players: [
        { playerId: 1, series: series((t) => (t >= 200_000 ? 1500 : 0), 13, opts.yourFood), heroes: [] },
        { playerId: 2, series: series((t) => (t >= 620_000 ? 700 : 0), 12), heroes: [] },
      ],
      fights: [],
    },
  } as unknown as GameRecord;
}

describe("findings", () => {
  test("an opponent without army for minutes is a window you did not use", () => {
    const f = findings(game({}), null);
    const w = f.find((x) => x.id === "window");
    expect(w?.evidence[0]).toContain("from 4:00 to 10:00");
    expect(w?.evidence[1]).toContain("You did not expand");
  });
  test("not a window when they put it into heroes instead (hero rush)", () => {
    const rush = game({ theirHeroLevelUps: [60_000, 150_000, 240_000, 330_000, 420_000] });
    expect(findings(rush, null).find((x) => x.id === "window")).toBeUndefined();
  });
  test("over 80 food on one base for minutes is high upkeep", () => {
    const f = findings(game({ yourFood: (t) => (t >= 500_000 ? 90 : 40) }), null).find((x) => x.id === "upkeep");
    expect(f?.evidence[0]).toContain("from 8:20");
    expect(findings(game({ yourFood: (t) => (t >= 780_000 ? 90 : 40) }), null).find((x) => x.id === "upkeep")).toBeUndefined(); // brief: before an attack
  });
  test("expanding in the window counts as using it", () => {
    expect(findings(game({ youExpandAt: 400_000 }), null).find((x) => x.id === "window")).toBeUndefined();
  });
  test("the opponent's plan comes from their orders", () => {
    const plan = opponentPlan(game({}), null);
    expect(plan).toContain("Army: first unit ordered 10:10 (Gryphon Rider); in all Gryphon Rider ×1.");
    expect(plan.find((l) => l.startsWith("Towers"))).toBe("Towers: 1 build/upgrade orders, 1 of them by 5:00.");
  });
});

describe("openings", () => {
  test("named from the first orders, as Liquipedia describes them", async () => {
    const { openingOf } = await import("../src/openings.ts");
    const b = (ms: number, kind: "building" | "unit", code: string, name: string) => ({ ms, kind, code, name });
    const p = {
      race: "H",
      heroes: [{ code: "Hamg", name: "Archmage", levelUps: [120_000] }],
      build: [b(11_000, "building", "halt", "Altar of Kings"), b(17_000, "building", "hhou", "Farm"), b(78_000, "building", "hhou", "Farm"), b(126_000, "building", "hgtw", "Guard Tower"), b(150_000, "building", "hwtw", "Scout Tower"), b(180_000, "building", "hkee", "Keep"), b(603_000, "unit", "hgry", "Gryphon Rider")],
    } as unknown as Parameters<typeof openingOf>[0];
    expect(openingOf(p)).toEqual(["fast altar (standard)", "fast tech: tier 2 at 3:00 on 2 supply buildings", "early towers: 2 tower orders by 2:30", "no army units in the first 5 minutes"]);
  });
});
