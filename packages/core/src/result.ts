// Who won, from the leave records. Same decision order as w3gjs' determineWinningTeam,
// but we keep which signal decided it so low-confidence results can be spotted later.
// Games on W3Champions' servers (FLO) write these records another way: readLeaves.
import type { Classification } from "./classify.ts";
import { LADDER_HOSTS } from "./gamedata.ts";
import type { RawReplay } from "./parse.ts";

/** "flo_saver_won": readLeaves, rule 2. "w3champions": W3Champions' own winner (official.ts), for your W3Champions 1v1s. */
export type ResultMethod = "leave_victory" | "leave_game_over" | "first_leaver_lost" | "flo_saver_won" | "w3champions" | "none";

export type ResultInfo = {
  winnerTeamId: number | null;
  method: ResultMethod;
  confidence: "high" | "medium" | "none";
  /** "reviewing": a W3Champions game the replay doesn't decide, still being looked up on W3Champions. */
  me: "win" | "loss" | "unknown" | "reviewing";
  evidence: string;
  /** What the replay's leave records said, when the result comes from elsewhere (W3Champions). */
  replay?: Omit<ResultInfo, "replay">;
};

// Leave record codes (little-endian hex as w3gjs prints them).
const RESULT_VICTORY = "09000000";
const REASON_GAME_OVER = "0c000000";

export type LeaveRecord = { playerId: number; reason: string; result: string };
type Decision = Pick<ResultInfo, "winnerTeamId" | "method" | "confidence">;

/** The Battle.net reading (every replay up to 0.2.5). `leaves`: the players' records, in file order. */
function readBattleNet(leaves: LeaveRecord[], players: { playerId: number; teamId: number }[]): Decision {
  const teamOf = new Map(players.map((s) => [s.playerId, s.teamId]));
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
  return { winnerTeamId, method, confidence: method === "none" ? "none" : method === "first_leaver_lost" ? "medium" : "high" };
}

/**
 * Who won, from the leave records (all of them, in file order: observers' records matter on FLO).
 * `flo`: a game on a W3Champions server (FLO sits in an observer slot).
 *
 * A replay a player saved from a FLO game (the game's own LastReplay.w3g) says the result from the
 * saver's side: once the saver has won, FLO's record, and every connection FLO closes after it, is
 * written with reason 0c and result 09, whoever it names (the opponent too, when they were beaten
 * without leaving). The saver's own record is the file's last. Read the Battle.net way, that 09 on
 * the opponent's record made the opponent the winner. So on FLO:
 *  1. a player's record with result 09 and another reason than 0c (they left as the winner: the
 *     server's and the observers' copies have it) names the winner, as on Battle.net;
 *  2. else a record with reason 0c and result 09, in a file whose last record is a player's: that
 *     player (the saver) won;
 *  3. else the Battle.net reading. It covers the saver who left (every record 0c/07 at the same
 *     moment: the first player record is the opponent's, who was still in the game) and the copies
 *     with one record (the player who left).
 * Evidence (scripts/w3c-result-study.ts, 2026-11): rule 2 against W3Champions' own result on 3
 * games, 2 of which the Battle.net reading got wrong, and against the player who left first on 225
 * tournament games (no difference there); rule 3's "saver left" on 2 games with W3Champions'
 * result and 43 where the saver wrote "gg" first. Result 08 was never seen in 4,500 replays.
 */
export function readLeaves(all: LeaveRecord[], players: { playerId: number; teamId: number }[], flo: boolean): Decision {
  const teamOf = new Map(players.map((s) => [s.playerId, s.teamId]));
  const leaves = all.filter((e) => teamOf.has(e.playerId));
  // Only checked on 1v1 (two players, two teams): team games on FLO are read as on Battle.net until
  // there are team replays with a known winner to test rule 2 on.
  if (flo && players.length === 2 && players[0].teamId !== players[1].teamId) {
    const named = leaves.some((e) => e.result === RESULT_VICTORY && e.reason !== REASON_GAME_OVER);
    const saverTeam = all.length ? teamOf.get(all[all.length - 1].playerId) : undefined;
    if (!named && saverTeam !== undefined && all.some((e) => e.reason === REASON_GAME_OVER && e.result === RESULT_VICTORY)) {
      return { winnerTeamId: saverTeam, method: "flo_saver_won", confidence: "high" };
    }
  }
  return readBattleNet(leaves, players);
}

/** FLO, W3Champions' game server, sits in an observer slot of the games it hosts. */
export const isFloGame = (c: Pick<Classification, "seats">) => c.seats.some((s) => s.isObserver && s.name === LADDER_HOSTS.w3c);

/** The result as one replay file's leave records give it (`all`: every record, in file order). */
export function resultFromLeaves(all: LeaveRecord[], c: Classification, w3gjsWinner?: number): ResultInfo {
  const players = c.seats.filter((s) => !s.isObserver);
  const teamOf = new Map(players.map((s) => [s.playerId, s.teamId]));
  const flo = isFloGame(c);
  const { winnerTeamId, method, confidence } = readLeaves(all, players, flo);
  const meTeam = c.meId === null ? undefined : teamOf.get(c.meId);
  // On FLO the records of FLO and the observers count, so they are kept too.
  const shown = flo ? all : all.filter((e) => teamOf.has(e.playerId));
  return {
    winnerTeamId,
    method,
    confidence,
    me: winnerTeamId === null || meTeam === undefined ? "unknown" : winnerTeamId === meTeam ? "win" : "loss",
    evidence: shown.map((e) => `player ${e.playerId} left reason=${e.reason} result=${e.result}`).join("; ") + (w3gjsWinner === undefined ? "" : ` | w3gjs winningTeamId=${w3gjsWinner}`),
  };
}

export function detectResult(raw: RawReplay, c: Classification): ResultInfo {
  return resultFromLeaves(raw.leaveEvents, c, raw.output.winningTeamId);
}
