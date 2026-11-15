import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { GameRecord, SimSample } from "@replay-altar/core/ui";
import { BY_RACE, chance, diffs, sideOf, usualAt, winCurve, type WinModel } from "../src/winchance.ts";

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
    // Losses as counted (7) or against the race's usual (19, since 0.2.6): the same for two Humans.
    expect(swing.drivers[0]).toEqual({ feature: model.keep.includes(19) ? 19 : 7, favours: "opp" });
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

  test("counted against the race's usual, an Undead with the usual five Acolytes is level with a Human with the usual fifteen workers", () => {
    const usual = { workers: { H: [5, 15, 15], U: [5, 5, 5] }, food: { H: [5, 30, 30], U: [5, 20, 20] } };
    expect(usualAt(usual.workers.H, 30_000)).toBeCloseTo(10, 9);
    expect(usualAt(usual.workers.H, 900_000)).toBe(15);
    expect(usualAt(undefined, 60_000)).toBe(0);
    const food = (s: SimSample[], n: number) => s.map((x) => ({ ...x, foodUsed: n }));
    const { r, me, opp } = game(food(series(() => 15, () => 0), 30), food(series(() => 5, () => 0), 20));
    (opp as { race: string }).race = "U";
    const a = sideOf(r, me, model.research)!, b = sideOf(r, opp, model.research)!;
    // As counted, the Human is ten workers and ten food ahead; against the usual, nobody is.
    const d = diffs(a, b, 300_000, usual);
    expect(d[2]).toBeCloseTo(1, 9);
    expect(d[8]).toBeCloseTo(1, 9);
    expect(d[BY_RACE[2]]).toBeCloseTo(0, 9);
    expect(d[BY_RACE[8]]).toBeCloseTo(0, 9);
    // Without the usual tables (the model shipped until 0.2.x) those differences stay out of it.
    expect(diffs(a, b, 300_000)[BY_RACE[2]]).toBe(0);
    const byRace: WinModel = { ...model, keep: model.keep.map((f) => BY_RACE[f] ?? f), usual };
    for (const p of winCurve(r, byRace, me, opp)!.points) expect(p.p).toBeCloseTo(0.5, 6);
    expect(winCurve(r, model, me, opp)!.points[8].p).toBeGreaterThan(0.6);
    // One worker above your race's usual still counts for you, and the two sides add up to 100%.
    const ahead = game(food(series(() => 16, () => 0), 30), food(series(() => 5, () => 0), 20));
    (ahead.opp as { race: string }).race = "U";
    const mine = winCurve(ahead.r, byRace, ahead.me, ahead.opp)!, theirs = winCurve(ahead.r, byRace, ahead.opp, ahead.me)!;
    expect(mine.points[2].p).toBeGreaterThan(0.5);
    mine.points.forEach((p, k) => expect(p.p + theirs.points[k].p).toBeCloseTo(1, 9));
  });

  test("hero experience and losses against the race's usual: a race's usual losses cancel out", () => {
    const usual = { workers: {}, food: {}, xp: { H: [0, 0], U: [0, 0] }, lost: { H: [0, 600], U: [0, 100] } };
    const { r, me, opp } = game(series(() => 15, () => 600), series(() => 5, () => 100));
    (opp as { race: string }).race = "U";
    const a = sideOf(r, me, model.research)!, b = sideOf(r, opp, model.research)!;
    expect(diffs(a, b, 300_000)[7]).toBeCloseTo(0.5, 9);
    expect(diffs(a, b, 300_000, usual)[BY_RACE[7]]).toBeCloseTo(0, 9);
    expect(diffs(a, b, 300_000, usual)[BY_RACE[3]]).toBe(0);
    // Usual tables from before 0.2.6 have no experience or losses: those differences stay at 0.
    expect(diffs(a, b, 300_000, { workers: {}, food: {} })[BY_RACE[7]]).toBe(0);
  });
});
