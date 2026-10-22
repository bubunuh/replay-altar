import { describe, expect, test } from "vitest";
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import type { RulesBook } from "@replay-altar/rules/types";
import { shareText } from "../src/renderer/shareText.ts";

const player = (name: string, race: string, heroes: [string, number][]) =>
  ({ name, race, heroes: heroes.map(([n, level], order) => ({ name: n, level, order })) }) as unknown as PlayerRecord;

describe("sharing a report as text", () => {
  const me = player("Me#1234", "H", [["Archmage", 5], ["Mountain King", 1]]);
  const opp = player("Someone#5678", "O", [["Far Seer", 3]]);
  const r = { game: { map: { file: "Maps/W3Champions/(2)AutumnLeaves_v2.0.w3x" }, durationMs: 851_000 }, classification: { source: "w3champions" } } as unknown as GameRecord;
  const book = {
    recap: "You won in 14:11 against Orc.",
    findings: [{ headline: "You reached 50 food and waited", evidence: ["First at 50 food at 8:00."], advice: "Attack, expand or tech." }],
    turningPoint: "The game turned at 9:47.",
    strengths: ["Units killed: 63."],
  } as unknown as RulesBook;

  test("result, matchup, map, heroes, findings with advice, and a link; no battletags", () => {
    const text = shareText(r, me, opp, "win", book);
    expect(text.split("\n")[0]).toBe("**Victory** · Human vs Orc · AutumnLeaves v2.0 · 14:11 (W3Champions)");
    expect(text).toContain("Heroes: Archmage 5, Mountain King 1 vs Far Seer 3");
    expect(text).toContain("1. **You reached 50 food and waited**\n   - First at 50 food at 8:00.\n   - *Next time:* Attack, expand or tech.");
    expect(text).toContain("**Turning point:** The game turned at 9:47.");
    expect(text).toContain("https://github.com/bubunuh/replay-altar");
    expect(text).not.toMatch(/Me#1234|Someone|#\d{4}/);
  });

  test("W3Champions map files read as the map's name", () => {
    const w3c = { ...r, game: { ...r.game, map: { file: "1051_w3c_260919_1153_EchoIsles_v2.2.w3x" } } } as unknown as GameRecord;
    expect(shareText(w3c, me, opp, "win", null).split("\n")[0]).toContain("· EchoIsles v2.2 ·");
  });

  test("without a report, just the game", () => {
    expect(shareText(r, me, opp, "loss", null).split("\n")).toHaveLength(4);
  });
});
