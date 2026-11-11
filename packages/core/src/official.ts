// The game's own end-of-game statistics (the score screen), as W3Champions stores them for its
// matches. Battle.net ladder games have none. When present they replace our estimates.
import type { GameRecord } from "./record.ts";
import type { ResultInfo } from "./result.ts";

export type OfficialPlayer = {
  playerId: number;
  battleTag: string;
  unitsProduced: number;
  unitsKilled: number;
  largestArmy: number;
  heroesKilled: number;
  itemsObtained: number;
  mercsHired: number;
  expGained: number;
  goldCollected: number;
  lumberCollected: number;
  goldUpkeepLost: number;
  /** W3Champions' winner. Missing in statistics fetched before 0.2.5 (they are fetched again). */
  won?: boolean;
};

/** `final`: no more lookups for this game (its result stays unknown unless the statistics say who won). */
export type OfficialStats =
  | { status: "ok"; source: "w3champions"; matchId: string; fetchedAt: string; players: OfficialPlayer[]; final?: boolean }
  /** Looked for but not found (yet); `attempts` drives retries. `final` unset: written before 0.2.5. */
  | { status: "missing"; source: "w3champions"; fetchedAt: string; attempts: number; reason: string; final?: boolean };

/** Metrics the official stats fill in (official-only ones stay null without them). */
export const OFFICIAL_ONLY = ["lumber_collected", "upkeep_gold_lost", "units_killed", "units_produced", "largest_army", "heroes_killed", "items_obtained"] as const;

/** Copy official numbers into the players' metrics; marks overridden estimates in metricSources. */
export function mergeOfficial(record: GameRecord, official: OfficialStats | undefined): GameRecord {
  if (!official) return record;
  record.official = official;
  if (official.status !== "ok") return record;
  record.metricSources = { ...(record.metricSources ?? {}) };
  for (const op of official.players) {
    const p = record.players.find((x) => x.playerId === op.playerId);
    if (!p) continue;
    Object.assign(p.metrics, {
      gold_collected: op.goldCollected,
      lumber_collected: op.lumberCollected,
      upkeep_gold_lost: op.goldUpkeepLost,
      units_killed: op.unitsKilled,
      units_produced: op.unitsProduced,
      largest_army: op.largestArmy,
      heroes_killed: op.heroesKilled,
      items_obtained: op.itemsObtained,
      hero_xp_total: op.expGained,
    });
  }
  // Hero XP share and per-minute follow the official totals too.
  for (const p of record.players) {
    const mine = p.metrics.hero_xp_total;
    const theirs = record.players.filter((x) => x.teamId !== p.teamId).reduce((s, x) => s + (x.metrics.hero_xp_total ?? 0), 0);
    p.metrics.hero_xp_share = typeof mine === "number" && mine + theirs > 0 ? mine / (mine + theirs) : null;
    p.metrics.hero_xp_per_min = typeof mine === "number" && record.game.durationMs > 0 ? mine / (record.game.durationMs / 60_000) : null;
  }
  for (const k of ["gold_collected", "hero_xp_total", "hero_xp_share", "hero_xp_per_min", ...OFFICIAL_ONLY]) record.metricSources[k] = "official";
  return record;
}

/**
 * Where your W3Champions games' results come from in a store. The replay says it at once when its
 * leave records decide (result.ts reads the records of W3Champions' server, FLO, since 0.2.6; in
 * 0.2.5 they weren't trusted). "lookup": W3Champions' own winner is looked up too and is the
 * authority: it replaces the replay's when found, and a game the replay doesn't decide is
 * "Reviewing" until then, "Unknown" if it never is found. "off": the lookups are turned off
 * (Settings): the replay's result, else "Unknown". Unset (reference games, analyzed replays): the
 * replay's leave records only.
 */
export type W3cResults = "lookup" | "off";

/** A W3Champions 1v1 of yours: the games the lookup can find (officialForOwnGame). */
export function takesW3cResult(r: GameRecord): boolean {
  return r.classification.source === "w3champions" && r.classification.category === "1v1_human" && r.players.some((p) => p.isMe) && r.players.some((p) => p.playerId === r.classification.opponentId);
}

/** Whether the statistics already say who won (or never will). */
export function w3cResultDone(o: OfficialStats | undefined): boolean {
  if (!o) return false;
  if (o.status === "ok") return o.players.some((p) => p.won !== undefined) || !!o.final;
  return !!o.final;
}

/**
 * A W3Champions game where W3Champions' winner isn't the one the replay's leave records gave: the
 * two winners' teams. W3Champions' stands; the collector writes it to its log, so that we learn of
 * replays the reading gets wrong.
 */
export function w3cResultDiffers(record: GameRecord): { replay: number; w3champions: number } | null {
  const r = record.result;
  if (r.method !== "w3champions" || r.winnerTeamId === null || !r.replay || r.replay.winnerTeamId === null || r.replay.winnerTeamId === r.winnerTeamId) return null;
  return { replay: r.replay.winnerTeamId, w3champions: r.winnerTeamId };
}

/** Set a W3Champions game's result (see W3cResults); other games are left as they are. */
export function settleW3cResult(record: GameRecord, mode: W3cResults | undefined): GameRecord {
  if (!mode || !takesW3cResult(record)) return record;
  // What the replay said, kept from the first time (record.result is W3Champions' after).
  const { replay: before, ...fresh } = record.result;
  const fromReplay = before ?? fresh;
  const o = record.official;
  const winner = o?.status === "ok" ? o.players.find((p) => p.won) : undefined;
  const winnerTeamId = winner ? (record.players.find((p) => p.playerId === winner.playerId)?.teamId ?? null) : null;
  const meTeam = record.players.find((p) => p.isMe)?.teamId;
  if (winnerTeamId === null && fromReplay.winnerTeamId !== null && fromReplay.method !== "w3champions") {
    // W3Champions hasn't said (yet): the replay's own result.
    record.result = { ...fromReplay, me: fromReplay.winnerTeamId === meTeam ? "win" : "loss" };
    for (const p of record.players) p.result = p.teamId === fromReplay.winnerTeamId ? "win" : "loss";
    return record;
  }
  const me: ResultInfo["me"] = winnerTeamId !== null ? (winnerTeamId === meTeam ? "win" : "loss") : mode === "off" || w3cResultDone(o) ? "unknown" : "reviewing";
  const evidence =
    winnerTeamId !== null && o?.status === "ok" ? `W3Champions match ${o.matchId}: ${winner!.battleTag} won`
    : mode === "off" ? "W3Champions lookups are turned off (Settings)"
    : me === "unknown" ? `not found on W3Champions${o?.status === "missing" ? `: ${o.reason}` : ""}`
    : "looking it up on W3Champions";
  record.result = { winnerTeamId, method: "w3champions", confidence: winnerTeamId === null ? "none" : "high", me, evidence, replay: fromReplay };
  for (const p of record.players) p.result = winnerTeamId === null ? "unknown" : p.teamId === winnerTeamId ? "win" : "loss";
  return record;
}
