// The rules' report on one of your games, as the match page and `replay-altar rules` show it:
// recap, findings (most important first), turning point, strengths, the opponent's plan and the
// fact sheet behind it all.
import { getGame, type DB, type Paths } from "@replay-altar/core/ui";
import { inLanguage, tr } from "@replay-altar/core/i18n";
import { factsRefFor } from "./context.ts";
import { gameFacts } from "./facts.ts";
import { findings as findFindings, MIN_GAME_MS, opponentPlan, strengths as findStrengths } from "./findings.ts";
import { recapOf, turningPoint } from "./report.ts";
import type { RulesBook } from "./types.ts";

export function rulesBook(db: DB, paths: Paths, gameKey: string): RulesBook {
  try {
    const detail = getGame(db, paths, gameKey);
    if (!detail) throw new Error(tr(`no such game: ${gameKey}`, `partida não encontrada: ${gameKey}`));
    const record = detail.record;
    const me = record.players.find((p) => p.isMe);
    const opp = record.players.find((p) => p.playerId === record.classification.opponentId);
    if (!me || !opp) throw new Error(tr("the report needs one of your 1v1 games", "a análise precisa de uma partida 1v1 sua"));
    if (record.game.durationMs < MIN_GAME_MS) throw new Error(tr("the game is too short to analyze (under 3 minutes)", "a partida é curta demais para analisar (menos de 3 minutos)"));
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
      // A reference sheet of every number, in English only.
      facts: inLanguage("en", () => gameFacts(record, { result, ref })),
    };
  } catch (e) {
    return { problem: (e as Error).message, recap: "", findings: [], turningPoint: null, oneThing: null, strengths: [], opponentPlan: [], facts: "" };
  }
}
