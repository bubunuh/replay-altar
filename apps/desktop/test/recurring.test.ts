import { describe, expect, test } from "vitest";
import { recurringView } from "../src/renderer/recurring.ts";
import type { GameFindings } from "../src/renderer/api.ts";

const f = (id: string) => ({ id, headline: `${id} headline`, severity: 0.7, advice: `${id} advice` });
// Twelve decided games, oldest first, and one without a result (not counted).
const results = ["loss", "win", "loss", "win", "loss", "win", "loss", "loss", "win", "loss", "win", "loss"];
const found: string[][] = [
  ["fights"], [], ["fights", "heroes"], ["heroes"], ["fights"], [], // the earliest two drop out of the last 10
  ["heroes", "mechanics"], ["heroes", "mechanics"], ["mechanics"], ["heroes", "mechanics", "economy", "supply"], ["mechanics"], ["mechanics", "heroes"],
];
const games = [...results.map((result, i) => ({ game_key: `g${i}`, result })), { game_key: "x", result: "unknown" }];
const all: GameFindings[] = found.map((ids, i) => ({ key: `g${i}`, playedAt: "", result: results[i], findings: ids.map(f) }));

describe("recurring problems", () => {
  const view = recurringView(games, all);
  const row = (id: string) => view.rows.find((r) => r.id === id)!;

  test("counts each problem in losses and in wins, only among the top three shown", () => {
    expect(view.losses).toBe(7);
    expect(view.wins).toBe(5);
    expect(row("heroes")).toMatchObject({ inLosses: 5, inWins: 1 });
    expect(row("fights")).toMatchObject({ inLosses: 3, inWins: 0 });
    expect(view.rows.find((r) => r.id === "supply")).toBeUndefined(); // 4th finding: not shown in the report
  });

  test("trend: the last 5 games against the 5 before", () => {
    expect(view.enough).toBe(true);
    expect(row("mechanics")).toMatchObject({ recent: 5, before: 1 });
    expect(row("fights")).toMatchObject({ recent: 0, before: 2 });
  });

  test("work on this now: most frequent in the last 10, never mechanics, with its latest advice", () => {
    expect(view.focus).toMatchObject({ id: "heroes", n: 6 });
    expect(view.focusRow?.advice).toBe("heroes advice");
    expect(row("heroes").latest).toBe("g11");
  });

  test("nothing to work on when no problem came up twice", () => {
    const one = recurringView(games.slice(0, 2), all);
    expect(one.focus).toBeUndefined();
    expect(one.enough).toBe(false);
  });
});
