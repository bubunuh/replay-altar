import { describe, expect, test } from "vitest";
import type { GameRecord, SimSample } from "@replay-altar/core/ui";
import { findings, opponentPlan } from "@replay-altar/rules";
import { leads } from "../src/series.ts";

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
function game(opts: { youExpandAt?: number; yourFood?: (t: number) => number; theirHeroLevelUps?: number[]; yourWorkers?: number }): GameRecord {
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
        { playerId: 1, series: series((t) => (t >= 200_000 ? 1500 : 0), opts.yourWorkers ?? 13, opts.yourFood), heroes: [] },
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
  test("workers are judged against what the bases need (5 on gold + lumber crew)", () => {
    expect(findings(game({}), null).find((x) => x.id === "economy")).toBeUndefined(); // 13 of 14 on one base: saturated
    const f = findings(game({ yourWorkers: 9 }), null).find((x) => x.id === "economy");
    expect(f?.evidence[0]).toBe("Workers at 6:00: 9 of the 14 your base needs (5 on gold per base + lumber crew).");
  });
  test("reaching 50 food and then doing nothing with it", () => {
    const f = findings(game({ yourFood: (t) => (t >= 300_000 ? 52 : 30) }), null).find((x) => x.id === "unused_spike");
    expect(f?.evidence[0]).toContain("first had 50 food at 5:00");
    expect(findings(game({ yourFood: (t) => (t >= 300_000 ? 52 : 30), youExpandAt: 400_000 }), null).find((x) => x.id === "unused_spike")).toBeUndefined();
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

describe("build library", () => {
  test("every guide step resolves to a game code", async () => {
    const { LIBRARY } = await import("../src/builds.ts");
    expect(LIBRARY.length).toBeGreaterThan(50);
    expect(LIBRARY.flatMap((b) => b.unresolved)).toEqual([]);
  });
  test("generic upgrade names resolve per race", async () => {
    const { resolveName } = await import("../src/builds.ts");
    expect(resolveName("Armor", "O", "research")).toBe("Roar");
    expect(resolveName("Ranged Attack", "O", "research")).toBe("Rora");
    expect(resolveName("Black Gunpowder", "H", "research")).toBe("Rhra");
    expect(resolveName("Troll Headhunter", "O", "train")).toBe("ohun");
  });
  test("matching is by food count, not strict order, and reports drift", async () => {
    const { alignBuild, deviations, LIBRARY } = await import("../src/builds.ts");
    const build = LIBRARY.find((b) => b.id === "grubby-036b-hu-bloody-beginner-am-mk-rifles")!;
    const ev = (food: number, action: string, code: string, name: string) => ({ ms: food * 10_000, food, action: action as "build", code, name });
    // Footman before the Archmage (order swapped), Keep 9 food late, no Arcane Vault.
    const events = [ev(5, "build", "halt", "Altar of Kings"), ev(6, "build", "hbar", "Barracks"), ev(9, "train", "hfoo", "Footman"), ev(10, "hero", "Hamg", "Archmage"), ev(19, "build", "hwtw", "Scout Tower"), ev(21, "build", "hatw", "Arcane Tower"), ev(36, "tech", "hkee", "Keep"), ev(27, "build", "hbla", "Blacksmith"), ev(29, "train", "hrif", "Rifleman"), ev(34, "hero", "Hmkg", "Mountain King"), ev(34, "build", "hars", "Arcane Sanctum")];
    const m = alignBuild(build, events);
    expect(m.steps.find((s) => s.step.code === "Hamg")?.event?.food).toBe(10);
    expect(deviations(m)).toContain("Keep at 36 food (build: 27)");
    expect(deviations(m)).toContain("no Arcane Vault (build: 29 food)");
    expect(m.score).toBeGreaterThan(0.6);
  });
});

describe("milestones", () => {
  test("time and food at each step", async () => {
    const { milestonesOf } = await import("../src/milestones.ts");
    const m = milestonesOf(game({ yourFood: (t) => (t >= 300_000 ? 52 : 30) }), 1)!;
    expect(m.at.food50?.ms).toBe(300_000);
    expect(m.at.hero1?.ms).toBe(120_000);
    expect(m.at.hero1?.food).toBe(30);
    expect(m.workers6).toBe(13);
  });
});

describe("report without the model", () => {
  test("every finding carries advice; the window links to the opponent's tech", async () => {
    const f = findings(game({}), null);
    const w = f.find((x) => x.id === "window")!;
    expect(w.advice).toMatch(/expansion/);
    expect(w.because?.[0]).toMatch(/tier 2 at 3:00/);
    expect(f.every((x) => x.advice)).toBe(true);
  });

  test("turning point: the fight the loser lost most in, with a time to rewatch", async () => {
    const { turningPoint, recapOf } = await import("../src/report.ts");
    const r = game({});
    const [me, opp] = r.players;
    const mine = r.sim!.status === "ok" ? r.sim!.players[0].series : [];
    for (const s of mine) if (s.t >= 500_000) s.goldLost = 900; // you lose ≈900 around 8:20
    (r.sim as { fights: unknown[] }).fights = [{ start: 495_000, end: 520_000, category: "pitched-battle", playerIds: [1, 2], initiatorId: 2 }];
    const tp = turningPoint(r, me, opp, "loss")!;
    expect(tp.text).toMatch(/turned at 8:15: a pitched battle where you lost ≈900 and they lost ≈0/);
    expect(tp.text).toMatch(/from 8:00/);
    expect(turningPoint(r, me, opp, "win")).toBeNull();
    // You still had the bigger army when this loss ended: the recap says so before the findings.
    expect(recapOf(r, opp, "loss", findings(r, null), [])).toMatch(/^You lost in 14:00 against Human\. The game ended while your army was bigger \(1500 vs 700\).* The biggest problem: they left a window open/);
  });

  test("composition: attack types against armor, and anti-air", async () => {
    const { armyMix, mixVsMix, antiAirShare, bestAgainst } = await import("../src/combat.ts");
    const p = (build: [string, string][]) => ({ race: "H", build: build.map(([code, name], i) => ({ ms: i * 1000, kind: "unit", code, name })) }) as unknown as GameRecord["players"][number];
    const gryphons = armyMix(p([["hgry", "Gryphon Rider"], ["hgry", "Gryphon Rider"]]), 0, 10_000);
    const headhunters = armyMix(p([["ohun", "Troll Headhunter"], ["ohun", "Troll Headhunter"]]), 0, 10_000);
    expect(mixVsMix(gryphons, headhunters)).toBeCloseTo(0.75); // magic vs medium
    expect(antiAirShare(armyMix(p([["hfoo", "Footman"]]), 0, 10_000))).toBe(0);
    expect(bestAgainst("H", headhunters)[0].vs).toBeCloseTo(1.5); // normal vs medium
  });
});
