// Who won, from the leave records (result.ts). The records below are the patterns found in real
// replays (scripts/w3c-result-study.ts), with the players as 1 and 2, an observer as 3 and
// W3Champions' server (FLO) as 24. Each record: [player, reason, result].
import { describe, expect, test } from "vitest";
import { readLeaves, type LeaveRecord } from "../src/index.ts";

const PLAYERS = [
  { playerId: 1, teamId: 0 },
  { playerId: 2, teamId: 1 },
];
const recs = (...list: [number, string, string][]): LeaveRecord[] => list.map(([playerId, reason, result]) => ({ playerId, reason: `${reason}000000`, result: `${result}000000` }));
const flo = (...list: [number, string, string][]) => readLeaves(recs(...list), PLAYERS, true);
const bnet = (...list: [number, string, string][]) => readLeaves(recs(...list), PLAYERS, false);

describe("a W3Champions (FLO) game saved by a player: the file's last record is the saver's", () => {
  test("the opponent was beaten without leaving: FLO's and the opponent's records say 09, the saver won", () => {
    // Two real games, both won by the saver according to W3Champions; read the Battle.net way,
    // the 09 on the opponent's record made the opponent the winner.
    const won: [number, string, string][] = [[24, "0c", "09"], [2, "0c", "09"], [1, "0c", "07"]];
    expect(flo(...won)).toEqual({ winnerTeamId: 0, method: "flo_saver_won", confidence: "high" });
    expect(bnet(...won)).toMatchObject({ winnerTeamId: 1, method: "leave_victory" });
    // The same with the saver as player 2, their own record 0c/0b.
    expect(flo([24, "0c", "09"], [1, "0c", "09"], [2, "0c", "0b"])).toMatchObject({ winnerTeamId: 1, method: "flo_saver_won" });
  });

  test("the opponent left first: FLO's record says 09, the saver won", () => {
    expect(flo([2, "01", "07"], [24, "0c", "09"], [1, "0c", "07"])).toMatchObject({ winnerTeamId: 0, method: "flo_saver_won", confidence: "high" });
    // With observers, closed after FLO with the same 09.
    expect(flo([1, "01", "07"], [24, "0c", "09"], [3, "0c", "09"], [2, "0c", "0b"])).toMatchObject({ winnerTeamId: 1, method: "flo_saver_won" });
  });

  test("the saver left: every record 0c/07, the other player won", () => {
    expect(flo([24, "0c", "07"], [1, "0c", "07"], [2, "0c", "07"])).toEqual({ winnerTeamId: 0, method: "leave_game_over", confidence: "high" });
    expect(flo([24, "0c", "07"], [3, "0c", "07"], [2, "0c", "07"], [1, "0c", "07"])).toMatchObject({ winnerTeamId: 1, method: "leave_game_over" });
  });
});

describe("the other copies of a W3Champions (FLO) game", () => {
  test("the server's copy: the loser's record 07/07, the winner's 09/09", () => {
    expect(flo([1, "07", "07"], [2, "09", "09"])).toEqual({ winnerTeamId: 1, method: "leave_victory", confidence: "high" });
    expect(flo([2, "07", "07"], [1, "09", "09"], [3, "0b", "0d"])).toMatchObject({ winnerTeamId: 0, method: "leave_victory" });
    // The game went on after the record of the player who left: only that one.
    expect(flo([1, "07", "07"])).toEqual({ winnerTeamId: 1, method: "first_leaver_lost", confidence: "medium" });
  });

  test("an observer's copy: the players' records name their own results", () => {
    expect(flo([1, "01", "07"], [2, "01", "09"], [24, "0c", "0b"], [3, "0c", "0b"])).toMatchObject({ winnerTeamId: 1, method: "leave_victory" });
    // The winner stayed until FLO closed the game.
    expect(flo([1, "01", "07"], [2, "0c", "01"], [3, "0c", "01"], [24, "0c", "01"], [3, "0c", "0b"])).toMatchObject({ winnerTeamId: 1, method: "leave_game_over" });
    // A 09 with reason 0c in a file an observer saved says nothing of a saver who plays: as before.
    expect(flo([1, "01", "07"], [24, "0c", "09"])).toMatchObject({ winnerTeamId: 1, method: "first_leaver_lost" });
  });

  test("a player who left as the winner is the winner, whatever FLO's record says after", () => {
    expect(flo([1, "01", "09"], [3, "01", "0b"], [24, "0c", "09"], [2, "0c", "0b"])).toMatchObject({ winnerTeamId: 0, method: "leave_victory" });
  });

  test("no leave record (most of the launcher's copies): nothing decided", () => {
    expect(flo()).toEqual({ winnerTeamId: null, method: "none", confidence: "none" });
  });
});

describe("games that aren't on FLO are read as before", () => {
  test("Battle.net ladder: the host's 09 names no player; the player still in the game when it ends won", () => {
    expect(bnet([2, "01", "0d"], [3, "0c", "09"], [1, "0c", "07"])).toEqual({ winnerTeamId: 0, method: "leave_game_over", confidence: "high" });
    expect(bnet([1, "01", "0d"], [2, "0c", "07"], [3, "0c", "07"])).toMatchObject({ winnerTeamId: 1, method: "leave_game_over" });
  });

  test("a custom game (a private game on a W3Champions map too): the one who left lost", () => {
    expect(bnet([1, "01", "0d"], [2, "0c", "07"])).toMatchObject({ winnerTeamId: 1, method: "leave_game_over" });
    expect(bnet([1, "01", "0d"], [2, "01", "0d"])).toMatchObject({ winnerTeamId: 1, method: "first_leaver_lost", confidence: "medium" });
  });
});
