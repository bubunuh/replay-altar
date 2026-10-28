// The match list in pages of 50 (renderer/paging.ts, used by pages/Matches.tsx).
import { describe, expect, test } from "vitest";
import { changeList, NO_FILTER, PAGE_SIZE, pageOf } from "../src/renderer/paging.ts";

/** n games, newest first, as the list comes. */
const games = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `g${i}`, playedAt: new Date(Date.UTC(2026, 9, 27) - i * 3_600_000).toISOString() }));

describe("match list pages", () => {
  test("50 per page, newest first; the last page holds the rest", () => {
    const rows = games(5016);
    expect(PAGE_SIZE).toBe(50);
    const first = pageOf(rows, 0);
    expect(first).toMatchObject({ page: 0, pages: 101, from: 0 });
    expect(first.rows).toHaveLength(50);
    expect(first.rows[0].key).toBe("g0");
    expect(first.rows.every((g, i) => i === 0 || g.playedAt < first.rows[i - 1].playedAt)).toBe(true);
    const last = pageOf(rows, 100);
    expect(last).toMatchObject({ page: 100, from: 5000 });
    expect(last.rows.map((g) => g.key)).toEqual(Array.from({ length: 16 }, (_, i) => `g${5000 + i}`));
  });

  test("no games, or fewer than a page: one page", () => {
    expect(pageOf([], 3)).toMatchObject({ page: 0, pages: 1, rows: [] });
    expect(pageOf(games(42), 0)).toMatchObject({ page: 0, pages: 1 });
  });

  test("a page past the end (the filtered list got shorter) shows the last one", () => {
    expect(pageOf(games(230), 7)).toMatchObject({ page: 4, from: 200 });
    expect(pageOf(games(230), 7).rows).toHaveLength(30);
  });

  test("a filter or a search goes back to page 1; turning pages keeps the filters", () => {
    const on3 = changeList(NO_FILTER, { page: 3 });
    expect(on3.page).toBe(3);
    expect(changeList(on3, { result: "win" })).toEqual({ ...NO_FILTER, result: "win", page: 0 });
    expect(changeList(on3, { q: "boy" }).page).toBe(0);
    const filtered = changeList(NO_FILTER, { source: "w3champions" });
    expect(changeList(filtered, { page: 2 })).toEqual({ ...NO_FILTER, source: "w3champions", page: 2 });
    // Choosing the filter already chosen isn't a change.
    expect(changeList({ ...filtered, page: 2 }, { source: "w3champions" }).page).toBe(2);
  });

  test("a refresh while importing stays on the page, with the newer games pushing the list down", () => {
    const state = changeList(NO_FILTER, { page: 4 });
    const before = pageOf(games(1000), state.page);
    // 50 older replays imported meanwhile: the list grows at the end; the page stays the 5th.
    const after = pageOf([...games(1000), ...games(1050).slice(1000)], state.page);
    expect(after.page).toBe(4);
    expect(after.rows).toEqual(before.rows);
  });
});
