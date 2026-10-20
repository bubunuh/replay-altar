// Read API for the desktop app. Everything here is plain JSON so it can cross Electron IPC.
import type { DB } from "./db.ts";
import { localizeMetric, METRICS, type MetricDef } from "./metrics.ts";
import type { GameRecord } from "./record.ts";
import { readRecord, type Paths } from "./store.ts";

export type GameRow = {
  game_key: string;
  played_at: string;
  duration_ms: number;
  source: string;
  category: string;
  analyzed: number;
  skip_reason: string | null;
  map_name: string;
  matchup: string | null;
  me_race: string | null;
  opp_name: string | null;
  opp_race: string | null;
  result: "win" | "loss" | "unknown";
  result_detected: string;
  result_confidence: string;
  user_label: string | null;
  apm: number | null;
  sim_status: "ok" | "failed" | null;
};

export function listGames(db: DB): GameRow[] {
  return db
    .prepare(
      `SELECT g.game_key, g.played_at, g.duration_ms, g.source, g.category, g.analyzed, g.skip_reason,
              g.map_name, g.matchup, g.me_race, g.opp_name, g.opp_race, g.result, g.result_detected,
              g.result_confidence, g.user_label, p.apm, g.sim_status
       FROM v_games g LEFT JOIN game_players p ON p.game_key = g.game_key AND p.player_id = g.me_player_id
       ORDER BY g.played_at DESC`,
    )
    .all() as GameRow[];
}

export type Annotation = { id: number; kind: string; source: string; author: string | null; model: string | null; body: unknown; created_at: string };

export type GameDetail = { record: GameRecord; row: GameRow; annotations: Annotation[] } | null;

export function getGame(db: DB, paths: Paths, key: string): GameDetail {
  const record = readRecord(paths, key);
  const row = listGames(db).find((g) => g.game_key === key);
  if (!record || !row) return null;
  const annotations = (db.prepare("SELECT * FROM annotations WHERE game_key = ? ORDER BY id").all(key) as (Annotation & { body: string })[]).map((a) => ({
    ...a,
    body: JSON.parse(a.body),
  }));
  return { record, row, annotations };
}

/** One row per analyzed game with both players' metrics, for the Performance view to aggregate. */
export type PerfGame = GameRow & {
  first_hero: string | null;
  /** Your research orders in time order (for the Upgrades section). */
  upgrades: { code: string; ms: number }[];
  me: Record<string, number | null>;
  opp: Record<string, number | null>;
};

export function performanceData(db: DB): { games: PerfGame[]; metrics: MetricDef[] } {
  const games = listGames(db).filter((g) => g.analyzed === 1);
  const metricRows = db
    .prepare(
      `SELECT m.game_key, m.metric, m.value, (m.player_id = g.me_player_id) AS is_me
       FROM player_metrics m JOIN games g ON g.game_key = m.game_key
       WHERE g.analyzed = 1 AND m.player_id IN (g.me_player_id, g.opp_player_id)`,
    )
    .all() as { game_key: string; metric: string; value: number | null; is_me: number }[];
  const heroes = db
    .prepare(
      `SELECT h.game_key, h.name FROM heroes h JOIN games g ON g.game_key = h.game_key
       WHERE h.player_id = g.me_player_id AND h.hero_order = 1`,
    )
    .all() as { game_key: string; name: string }[];
  const byKey = new Map<string, PerfGame>(games.map((g) => [g.game_key, { ...g, first_hero: null, upgrades: [], me: {}, opp: {} }]));
  const research = db
    .prepare(
      `SELECT b.game_key, b.code, b.ms FROM build_events b JOIN games g ON g.game_key = b.game_key
       WHERE g.analyzed = 1 AND b.player_id = g.me_player_id AND b.kind = 'upgrade' ORDER BY b.game_key, b.ms`,
    )
    .all() as { game_key: string; code: string; ms: number }[];
  for (const r of research) byKey.get(r.game_key)?.upgrades.push({ code: r.code, ms: r.ms });
  for (const m of metricRows) {
    const g = byKey.get(m.game_key);
    if (g) (m.is_me ? g.me : g.opp)[m.metric] = m.value;
  }
  for (const h of heroes) {
    const g = byKey.get(h.game_key);
    if (g) g.first_hero = h.name;
  }
  return { games: [...byKey.values()], metrics: METRICS.map(localizeMetric) };
}
