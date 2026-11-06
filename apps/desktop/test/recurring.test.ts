import { describe, expect, test } from "vitest";
import { recurringView, strengthItems } from "../src/renderer/recurring.ts";
import type { GameFindings } from "../src/renderer/api.ts";

const f = (id: string) => ({ id, headline: `${id} headline`, severity: 0.7, advice: `${id} advice` });
// Twelve decided games, oldest first, and one without a result (not counted).
const results = ["loss", "win", "loss", "win", "loss", "win", "loss", "loss", "win", "loss", "win", "loss"];
const found: string[][] = [
  ["fights"], [], ["fights", "heroes"], ["heroes"], ["fights"], [], // the earliest two drop out of the last 10
  ["heroes", "mechanics"], ["heroes", "mechanics"], ["mechanics"], ["heroes", "mechanics", "economy", "supply"], ["mechanics"], ["mechanics", "heroes"],
];
// Strengths per game, same order: "kills" recurs more lately, "heroes_up" less.
const kept: string[][] = [["heroes_up"], ["heroes_up"], ["heroes_up", "kills"], [], ["heroes_up"], [], ["kills"], ["kills"], ["kills"], ["kills", "heroes_up"], ["kills"], ["kills"]];
const games = [...results.map((result, i) => ({ game_key: `g${i}`, result })), { game_key: "x", result: "unknown" }];
const all: GameFindings[] = found.map((ids, i) => ({ key: `g${i}`, playedAt: "", result: results[i], findings: ids.map(f), strengths: (kept[i] ?? []).map((key) => ({ key, name: key, text: `${key} text` })) }));

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

describe("recurring strengths", () => {
  const view = recurringView(games, all, strengthItems, true);
  const row = (id: string) => view.rows.find((r) => r.id === id)!;

  test("counts each strength in losses and in wins, with the trend of the last 5 against the 5 before", () => {
    expect(row("kills")).toMatchObject({ inLosses: 5, inWins: 2, recent: 5, before: 2 });
    expect(row("heroes_up")).toMatchObject({ recent: 1, before: 2 });
    expect(row("kills").headline).toBe("kills text");
    expect(row("kills").latest).toBe("g11");
  });

  test("most wins first; keep doing this: the strength in most of the last 10 wins", () => {
    expect(view.rows.map((r) => r.id)).toEqual(["kills", "heroes_up"]);
    expect(view.focus).toMatchObject({ id: "kills", n: 2 });
    expect(view.last10).toBe(5);
  });

  test("no rows without strengths", () => {
    expect(recurringView(games, all.map((g) => ({ ...g, strengths: [] })), strengthItems, true).rows).toEqual([]);
  });
});
