// Who won, from the leave records. Same decision order as w3gjs' determineWinningTeam,
// but we keep which signal decided it so low-confidence results can be spotted later.
import type { Classification } from "./classify.ts";
import type { RawReplay } from "./parse.ts";

export type ResultMethod = "leave_victory" | "leave_game_over" | "first_leaver_lost" | "none";

export type ResultInfo = {
  winnerTeamId: number | null;
  method: ResultMethod;
  confidence: "high" | "medium" | "none";
  me: "win" | "loss" | "unknown";
  evidence: string;
};

// Leave record codes (little-endian hex as w3gjs prints them).
const RESULT_VICTORY = "09000000";
const REASON_GAME_OVER = "0c000000";

export function detectResult(raw: RawReplay, c: Classification): ResultInfo {
  const players = c.seats.filter((s) => !s.isObserver);
  const teamOf = new Map(players.map((s) => [s.playerId, s.teamId]));
  const leaves = raw.leaveEvents.filter((e) => teamOf.has(e.playerId));
  const evidence =
    leaves.map((e) => `player ${e.playerId} left reason=${e.reason} result=${e.result}`).join("; ") +
    ` | w3gjs winningTeamId=${raw.output.winningTeamId}`;

  let winnerTeamId: number | null = null;
  let method: ResultMethod = "none";
  const victory = leaves.find((e) => e.result === RESULT_VICTORY);
  const gameOver = leaves.find((e) => e.reason === REASON_GAME_OVER);
  if (victory) {
    winnerTeamId = teamOf.get(victory.playerId)!;
    method = "leave_victory";
  } else if (gameOver) {
    // The winner is still in the game when WC3 ends it.
    winnerTeamId = teamOf.get(gameOver.playerId)!;
    method = "leave_game_over";
  } else if (leaves.length > 0) {
    const loserTeam = teamOf.get(leaves[0].playerId);
    const other = players.find((s) => s.teamId !== loserTeam);
    if (other) {
      winnerTeamId = other.teamId;
      method = "first_leaver_lost";
    }
  }

  const meTeam = c.meId === null ? undefined : teamOf.get(c.meId);
  return {
    winnerTeamId,
    method,
    confidence: method === "none" ? "none" : method === "first_leaver_lost" ? "medium" : "high",
    me: winnerTeamId === null || meTeam === undefined ? "unknown" : winnerTeamId === meTeam ? "win" : "loss",
    evidence,
  };
}
