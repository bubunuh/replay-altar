import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { GameRecord, SimSample } from "@replay-altar/core/ui";
import { chance, diffs, sideOf, winCurve, type WinModel } from "../src/winchance.ts";

const model = JSON.parse(readFileSync(join(import.meta.dirname, "../../../data/winchance.json"), "utf8")) as WinModel;

// Two players over 12 minutes, samples every 10 s; `workers(t)` and `lost(t)` per player.
const series = (workers: (t: number) => number, lost: (t: number) => number): SimSample[] =>
  Array.from({ length: 73 }, (_, i) => {
    const t = i * 10_000;
    return { t, goldSpent: 0, lumberSpent: 0, goldLost: lost(t), lumberLost: 0, foodUsed: 20, foodMax: 40, workers: workers(t), estGoldMined: 0, estLumberMined: 0, estGoldBank: 0, estLumberBank: 0, dominance: null, armyFood: 10, armyValue: 1000 } as SimSample;
  });

function game(mine: SimSample[], theirs: SimSample[], levelUps: [number[], number[]] = [[], []]) {
  const player = (id: number, isMe: boolean, levels: number[]) => ({ playerId: id, teamId: id, isMe, race: "H", heroes: levels.length ? [{ code: "Hamg", name: "Archmage", levelUps: levels }] : [], build: [], metrics: {} });
  const r = {
    gameKey: "test",
    game: { durationMs: 720_000 },
    classification: { opponentId: 2 },
    players: [player(1, true, levelUps[0]), player(2, false, levelUps[1])],
    sim: {
      status: "ok",
      fights: [{ start: 400_000, end: 420_000, category: "pitched-battle", initiatorId: 2, playerIds: [1, 2], involvesHero: false, involvesAir: false, losses: { "1": { value: 900, heroes: [] }, "2": { value: 100, heroes: [] } } }],
      players: [
        { playerId: 1, series: mine, heroes: [], bases: [{ at: 0, lostAt: null }], metrics: {}, camps: [] },
        { playerId: 2, series: theirs, heroes: [], bases: [{ at: 0, lostAt: null }], metrics: {}, camps: [] },
      ],
    },
  } as unknown as GameRecord;
  return { r, me: r.players[0], opp: r.players[1] };
}

describe("win chance", () => {
  test("even players stay at 50%, and the two sides always add up to 100%", () => {
    const even = series(() => 20, () => 0);
    const { r, me, opp } = game(even, even);
    const mine = winCurve(r, model, me, opp)!, theirs = winCurve(r, model, opp, me)!;
    for (const p of mine.points) expect(p.p).toBeCloseTo(0.5, 6);
    const ahead = game(series((t) => 20 + t / 60_000, () => 0), even);
    const a = winCurve(ahead.r, model, ahead.me, ahead.opp)!, b = winCurve(ahead.r, model, ahead.opp, ahead.me)!;
    a.points.forEach((p, i) => expect(p.p + b.points[i].p).toBeCloseTo(1, 9));
    expect(theirs.points.length).toBe(mine.points.length);
  });

  test("a lost fight shows up as a swing, explained by losses and the fight itself", () => {
    const { r, me, opp } = game(series(() => 20, (t) => (t >= 410_000 ? 900 : 0)), series(() => 20, (t) => (t >= 410_000 ? 100 : 0)));
    const curve = winCurve(r, model, me, opp)!;
    expect(curve.points.at(-1)!.p).toBeLessThan(0.45);
    const swing = curve.swings.find((s) => s.to >= 420_000 && s.from <= 420_000)!;
    expect(swing.pTo).toBeLessThan(swing.pFrom);
    expect(swing.drivers[0]).toEqual({ feature: 7, favours: "opp" });
    expect(swing.events).toContainEqual(expect.objectContaining({ kind: "fight", myLoss: 900, oppLoss: 100 }));
  });

  test("hero experience counts only the levels reached so far, never the next level-up", () => {
    const even = series(() => 20, () => 0);
    // Your hero reaches level 2 at 5:00; before that the two players are even.
    const { r, me, opp } = game(even, even, [[60_000, 300_000], [60_000]]);
    const a = sideOf(r, me, model.research)!, b = sideOf(r, opp, model.research)!;
    expect(diffs(a, b, 299_000)[3]).toBe(0);
    expect(diffs(a, b, 300_000)[3]).toBeCloseTo(0.2);
    expect(chance(model, diffs(a, b, 299_000), 299_000)).toBeCloseTo(0.5, 6);
  });
});
