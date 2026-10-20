import { describe, expect, test } from "vitest";
import type { GameRecord, SimSample } from "@replay-altar/core/ui";
import { fightLosses } from "../src/series.ts";

// Cumulative losses every 10 s for 10 minutes; `lost(t)` is what was lost by t.
const series = (lost: (t: number) => number): SimSample[] =>
  Array.from({ length: 61 }, (_, i) => {
    const t = i * 10_000;
    return { t, goldSpent: 0, lumberSpent: 0, goldLost: lost(t), lumberLost: 0, foodUsed: 10, foodMax: 30, workers: 10, estGoldMined: 0, estLumberMined: 0, estGoldBank: 0, estLumberBank: 0, dominance: null, armyFood: 0, armyValue: 0 } as SimSample;
  });
const fight = (start: number, end: number) => ({ start, end, category: "army-fight", initiatorId: 1, playerIds: [1, 2], involvesHero: false, involvesAir: false });

function game(myLost: (t: number) => number, theirLost: (t: number) => number, fights: ReturnType<typeof fight>[]) {
  const player = (id: number, isMe: boolean) => ({ playerId: id, teamId: id, isMe, race: "H", heroes: [], build: [], metrics: {} });
  const r = {
    game: { durationMs: 600_000 },
    classification: { opponentId: 2 },
    players: [player(1, true), player(2, false)],
    sim: { status: "ok", fights, players: [{ playerId: 1, series: series(myLost), heroes: [] }, { playerId: 2, series: series(theirLost), heroes: [] }] },
  } as unknown as GameRecord;
  return { r, me: r.players[0], opp: r.players[1] };
}

describe("fight losses", () => {
  test("overlapping fights split the losses instead of counting them twice", () => {
    // You lose 500 at 1:40 and 300 more at 2:10; the second fight's window would reach back to 1:30.
    const { r, me, opp } = game((t) => (t >= 100_000 ? 500 : 0) + (t >= 130_000 ? 300 : 0), () => 0, [fight(95_000, 105_000), fight(100_000, 140_000)]);
    const out = fightLosses(r, me, opp);
    expect(out.map((x) => x.me)).toEqual([500, 300]);
  });

  test("a large burst of losses away from any detected battle is a fight of its own", () => {
    // They lose 700 around 6:40 with no battle near it; a burst of 200 is too small to count.
    const { r, me, opp } = game(() => 0, (t) => (t >= 400_000 ? 700 : 0) + (t >= 500_000 ? 200 : 0), [fight(95_000, 105_000)]);
    const out = fightLosses(r, me, opp);
    expect(out).toHaveLength(2);
    expect(out[1].f.category).toBe("unseen-fight");
    expect(out[1].opp).toBe(700);
  });

  test("a burst right after a detected battle belongs to it", () => {
    const { r, me, opp } = game(() => 0, (t) => (t >= 110_000 ? 700 : 0), [fight(95_000, 105_000)]);
    const out = fightLosses(r, me, opp);
    expect(out).toHaveLength(1);
    expect(out[0].opp).toBe(700);
  });
});
