import { describe, expect, test } from "vitest";
import { accountCandidates } from "../src/firstrun.ts";

describe("battletag suggestions", () => {
  test("the name in most replays, and a frequent opponent too: both only suggested, most frequent first", () => {
    // 20 replays: you in all of them, your practice partner in 14, others once each.
    const count = new Map<string, number>([["Tester#1", 20], ["Partner#2", 14], ["Random#3", 1]]);
    expect(accountCandidates(count, 20)).toEqual([
      { name: "Tester#1", games: 20, of: 20 },
      { name: "Partner#2", games: 14, of: 20 },
    ]);
  });
  test("downloaded games of other players: no suggestion", () => {
    const count = new Map<string, number>([["ProA#1", 3], ["ProB#2", 2], ["You#3", 8]]);
    expect(accountCandidates(count, 20)).toEqual([]);
  });
});
