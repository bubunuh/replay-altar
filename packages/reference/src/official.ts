// Fetching the game's own end-of-game stats from W3Champions for a stored game.
import type { GameRecord, OfficialStats } from "@replay-altar/core";
import type { W3cClient, W3cMatch, W3cScore } from "./w3c.ts";

const GATEWAYS = [20, 10];
const START_TOLERANCE_MS = 10 * 60_000;

/** W3Champions' winner for a player of the match (the player's own flag, else the team's). */
function wonIn(match: W3cMatch, battleTag: string): boolean | undefined {
  for (const t of match.teams) {
    const p = t.players.find((x) => x.battleTag.toLowerCase() === battleTag.toLowerCase());
    if (p) return p.won ?? t.won;
  }
  return undefined;
}

export function officialFromScores(matchId: string, scores: W3cScore[], record: GameRecord, match?: W3cMatch): OfficialStats {
  const players = record.players.flatMap((p) => {
    const s = scores.find((x) => x.battleTag.toLowerCase() === p.name.toLowerCase());
    if (!s) return [];
    const won = match ? wonIn(match, s.battleTag) : undefined;
    return [
      {
        playerId: p.playerId,
        battleTag: s.battleTag,
        unitsProduced: s.unitScore.unitsProduced,
        unitsKilled: s.unitScore.unitsKilled,
        largestArmy: s.unitScore.largestArmy,
        heroesKilled: s.heroScore.heroesKilled,
        itemsObtained: s.heroScore.itemsObtained,
        mercsHired: s.heroScore.mercsHired,
        expGained: s.heroScore.expGained,
        goldCollected: s.resourceScore.goldCollected,
        lumberCollected: s.resourceScore.lumberCollected,
        goldUpkeepLost: s.resourceScore.goldUpkeepLost,
        ...(won === undefined ? {} : { won }),
      },
    ];
  });
  if (players.length !== record.players.length) {
    return { status: "missing", source: "w3champions", fetchedAt: new Date().toISOString(), attempts: 1, reason: "players in the score sheet don't match the replay" };
  }
  return { status: "ok", source: "w3champions", matchId, fetchedAt: new Date().toISOString(), players };
}

/** Official stats for a game whose W3Champions match id is known (reference games). */
export async function officialForMatch(client: W3cClient, matchId: string, record: GameRecord): Promise<OfficialStats> {
  const detail = await client.matchDetail(matchId);
  if (!detail) return { status: "missing", source: "w3champions", fetchedAt: new Date().toISOString(), attempts: 1, reason: "match not found" };
  return officialFromScores(matchId, detail.playerScores, record, detail.match);
}

/**
 * Official stats for one of your own W3Champions games: find the match by opponent and start
 * time (the replay has no W3C id), then read its score sheet.
 */
export async function officialForOwnGame(client: W3cClient, record: GameRecord, previousAttempts = 0): Promise<OfficialStats> {
  const me = record.players.find((p) => p.isMe);
  const opp = record.players.find((p) => p.playerId === record.classification.opponentId);
  const missing = (reason: string): OfficialStats => ({ status: "missing", source: "w3champions", fetchedAt: new Date().toISOString(), attempts: previousAttempts + 1, reason });
  if (!me || !opp) return missing("not a 1v1 with you in it");
  const started = Date.parse(record.game.playedAt);
  const season = await client.currentSeason();
  for (const s of [season, season - 1]) {
    for (const gateway of GATEWAYS) {
      const matches = await client.searchPlayerMatches({ playerTag: me.name, opponentTag: opp.name, gateway, season: s });
      const hit = matches.find((m) => Math.abs(Date.parse(m.startTime) - started) <= START_TOLERANCE_MS);
      if (hit) {
        const found = await officialForMatch(client, hit.id, record);
        return found.status === "ok" ? found : missing(found.reason);
      }
    }
  }
  return missing("no W3Champions match with this opponent near this time");
}
