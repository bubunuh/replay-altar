// The rules' report on one of your games, as the match page and `replay-altar rules` show it:
// recap, findings (most important first), turning point, strengths, the opponent's plan and the
// fact sheet behind it all.
import { getGame, type DB, type Paths } from "@replay-altar/core/ui";
import { factsRefFor } from "./context.ts";
import { gameFacts } from "./facts.ts";
import { findings as findFindings, MIN_GAME_MS, opponentPlan, strengths as findStrengths } from "./findings.ts";
import { recapOf, turningPoint } from "./report.ts";
import type { RulesBook } from "./types.ts";

export function rulesBook(db: DB, paths: Paths, gameKey: string): RulesBook {
  try {
    const detail = getGame(db, paths, gameKey);
    if (!detail) throw new Error(`no such game: ${gameKey}`);
    const record = detail.record;
    const me = record.players.find((p) => p.isMe);
    const opp = record.players.find((p) => p.playerId === record.classification.opponentId);
    if (!me || !opp) throw new Error("the report needs one of your 1v1 games");
    if (record.game.durationMs < MIN_GAME_MS) throw new Error("the game is too short to analyze (under 3 minutes)");
    const result = detail.row.result ?? "unknown";
    const ref = factsRefFor(record);
    const found = findFindings(record, ref);
    const good = findStrengths(record, ref, found);
    return {
      problem: null,
      recap: recapOf(record, opp, result, found, good),
      findings: found,
      turningPoint: turningPoint(record, me, opp, result)?.text ?? null,
      oneThing: found[0]?.advice ?? null,
      strengths: good,
      opponentPlan: opponentPlan(record, ref),
      facts: gameFacts(record, { result, ref }),
    };
  } catch (e) {
    return { problem: (e as Error).message, recap: "", findings: [], turningPoint: null, oneThing: null, strengths: [], opponentPlan: [], facts: "" };
  }
}
