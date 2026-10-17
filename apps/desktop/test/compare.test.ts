import { describe, expect, test } from "vitest";
import { METRICS } from "@w3stats/core/metrics";
import type { MatchupProfile } from "@w3stats/reference/types";
import { assess } from "../src/renderer/compare.ts";

const def = (key: string) => METRICS.find((m) => m.key === key)!;
const stat = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  return { n: v.length, p10: v[0], p25: v[1], p50: v[Math.floor(v.length / 2)], p75: v[v.length - 2], p90: v.at(-1)!, values: v };
};
// Ten pro games: resources lost per 10 min 500..1400; APM 200..290.
const mp: MatchupProfile = {
  n: 10,
  metrics: {
    resources_lost_total: { ...stat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => i * 1000)), per10: stat([5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((i) => i * 100)) },
    apm: stat([200, 210, 220, 230, 240, 250, 260, 270, 280, 290]),
    tier2_ms: stat([180, 190, 200, 210, 220, 230, 240, 250, 260, 270].map((s) => s * 1000)),
  },
  curves: { apm: [], workers: [], spent: [], food: [], armyFood: [] },
};

describe("where you stand", () => {
  test("losing more than most pros reads as worse, compared per 10 minutes", () => {
    // 2441 lost in a 15.5-minute game = 1575 per 10 min: more than every pro game.
    const a = assess(def("resources_lost_total"), mp, { value: 2441, per10: 1575 }, 2000);
    expect(a.per10).toBe(true);
    expect(a.text).toBe("worse than every pro game");
    expect(a.tier).toBe("below"); // also lost more than the opponent (2000)
  });
  test("losing less than your opponent but more than pros is yellow", () => {
    expect(assess(def("resources_lost_total"), mp, { value: 1500, per10: 1450 }, 2000).tier).toBe("above");
  });
  test("inside the pros' normal range is green", () => {
    const a = assess(def("resources_lost_total"), mp, { value: 900, per10: 800 }, 2000);
    expect(a.tier).toBe("pro");
    expect(a.text).toBe("better than 65% of pro games");
  });
  test("higher-is-better metrics", () => {
    expect(assess(def("apm"), mp, { value: 134 }, 108)).toMatchObject({ text: "worse than every pro game", tier: "above" });
    expect(assess(def("apm"), mp, { value: 134 }, 150).tier).toBe("below");
    expect(assess(def("apm"), mp, { value: 235 }, 150)).toMatchObject({ text: "better than 40% of pro games", tier: "pro" }); // above 4 of 10
  });
  test("strategy timings get neutral words and no colour", () => {
    const a = assess(def("tier2_ms"), mp, { value: 271_000 }, 230_000);
    expect(a).toMatchObject({ text: "later than every pro game", tier: null });
  });
});
