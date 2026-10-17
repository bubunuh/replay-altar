// The game's own end-of-game statistics (the score screen), as W3Champions stores them for its
// matches. Battle.net ladder games have none. When present they replace our estimates.
import type { GameRecord } from "./record.ts";

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
};

export type OfficialStats =
  | { status: "ok"; source: "w3champions"; matchId: string; fetchedAt: string; players: OfficialPlayer[] }
  /** Looked for but not found (yet); `attempts` drives retries. */
  | { status: "missing"; source: "w3champions"; fetchedAt: string; attempts: number; reason: string };

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
