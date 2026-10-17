// SQLite projection of the game records. The JSON files in games/ are the source of truth;
// `w3stats reingest --all` can rebuild every table here except `annotations`, which holds
// things only people (or later an LLM) can add: result overrides, notes, coaching.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { METRICS } from "./metrics.ts";
import type { GameRecord } from "./record.ts";

export const DB_VERSION = 1;

const SCHEMA_V1 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE games (
  game_key TEXT PRIMARY KEY,           -- w3gjs id, see provenance.gameKeyMethod
  played_at TEXT NOT NULL,             -- ISO UTC, estimated game start (ended_at - duration)
  ended_at TEXT NOT NULL,
  time_source TEXT NOT NULL,           -- w3c_filename | lastreplay_mtime | saved_file_mtime
  duration_ms INTEGER NOT NULL,
  source TEXT NOT NULL,                -- bnet_ladder | w3champions | custom
  category TEXT NOT NULL,              -- 1v1_human | vs_ai | team | ffa | observed | unknown
  analyzed INTEGER NOT NULL,           -- 1 = counts toward stats
  skip_reason TEXT,
  map_file TEXT, map_name TEXT, map_checksum TEXT,
  game_name TEXT, game_type_raw TEXT, version TEXT, build INTEGER,
  me_player_id INTEGER, me_name TEXT, me_race TEXT,
  opp_player_id INTEGER, opp_name TEXT, opp_race TEXT,
  matchup TEXT,                        -- my race first, e.g. HvU
  result_detected TEXT NOT NULL,       -- win | loss | unknown, from leave records
  result_method TEXT NOT NULL,
  result_confidence TEXT NOT NULL,
  user_label TEXT,                     -- name you gave the replay when saving it
  archive_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,                -- of the archived file
  parser TEXT NOT NULL,
  classifier_version INTEGER NOT NULL,
  metrics_version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  ingested_at TEXT NOT NULL
);
CREATE INDEX games_played_at ON games(played_at);

CREATE TABLE game_players (
  game_key TEXT NOT NULL REFERENCES games ON DELETE CASCADE,
  player_id INTEGER NOT NULL,
  name TEXT NOT NULL, team_id INTEGER NOT NULL,
  race_picked TEXT, race TEXT,
  is_me INTEGER NOT NULL, result TEXT NOT NULL, apm REAL,
  PRIMARY KEY (game_key, player_id)
);
CREATE INDEX game_players_name ON game_players(name);

-- Long format so any metric can be grouped by result, matchup, map... without schema changes.
CREATE TABLE player_metrics (
  game_key TEXT NOT NULL REFERENCES games ON DELETE CASCADE,
  player_id INTEGER NOT NULL,
  metric TEXT NOT NULL,
  value REAL,
  PRIMARY KEY (game_key, player_id, metric)
);

CREATE TABLE metric_defs (key TEXT PRIMARY KEY, label TEXT, unit TEXT, grp TEXT, description TEXT);

CREATE TABLE build_events (
  game_key TEXT NOT NULL REFERENCES games ON DELETE CASCADE,
  player_id INTEGER NOT NULL, ms INTEGER NOT NULL,
  kind TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL
);
CREATE INDEX build_events_game ON build_events(game_key, player_id, ms);

CREATE TABLE heroes (
  game_key TEXT NOT NULL REFERENCES games ON DELETE CASCADE,
  player_id INTEGER NOT NULL, hero_order INTEGER NOT NULL,
  code TEXT NOT NULL, name TEXT NOT NULL, level INTEGER NOT NULL, retrainings INTEGER NOT NULL,
  PRIMARY KEY (game_key, player_id, hero_order)
);

CREATE TABLE hero_skills (
  game_key TEXT NOT NULL REFERENCES games ON DELETE CASCADE,
  player_id INTEGER NOT NULL, hero_order INTEGER NOT NULL,
  ms INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL
);

CREATE TABLE apm_minutes (
  game_key TEXT NOT NULL REFERENCES games ON DELETE CASCADE,
  player_id INTEGER NOT NULL, minute INTEGER NOT NULL, actions INTEGER NOT NULL,
  PRIMARY KEY (game_key, player_id, minute)
);

CREATE TABLE chat (
  game_key TEXT NOT NULL REFERENCES games ON DELETE CASCADE,
  ms INTEGER NOT NULL, player TEXT, mode TEXT, message TEXT
);

CREATE TABLE files (
  path TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, mtime TEXT NOT NULL,
  game_key TEXT NOT NULL REFERENCES games ON DELETE CASCADE,
  duration_ms INTEGER, time_source TEXT,
  PRIMARY KEY (path, sha256)
);

CREATE TABLE classification_reasons (
  game_key TEXT NOT NULL REFERENCES games ON DELETE CASCADE,
  seq INTEGER NOT NULL, rule TEXT NOT NULL, passed INTEGER NOT NULL, evidence TEXT NOT NULL,
  PRIMARY KEY (game_key, seq)
);

-- Human- or machine-authored additions. Never rebuilt by reingest.
-- kind: result_override (body {"result":"win|loss"}), note, coach_report, audit_finding
-- source: user | llm | rule; model/prompt_hash identify an LLM run.
CREATE TABLE annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_key TEXT,                       -- NULL = about the whole history
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  author TEXT,
  model TEXT,
  prompt_hash TEXT,
  body TEXT NOT NULL,                  -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX annotations_game ON annotations(game_key, kind);

-- Effective result = latest manual override, else detected.
CREATE VIEW v_games AS
SELECT g.*,
  COALESCE((SELECT json_extract(a.body, '$.result') FROM annotations a
            WHERE a.game_key = g.game_key AND a.kind = 'result_override'
            ORDER BY a.id DESC LIMIT 1), g.result_detected) AS result
FROM games g;

CREATE VIEW v_analyzed AS SELECT * FROM v_games WHERE analyzed = 1;

CREATE VIEW v_matchup_winrates AS
SELECT matchup, COUNT(*) AS games,
  SUM(result = 'win') AS wins, SUM(result = 'loss') AS losses,
  ROUND(1.0 * SUM(result = 'win') / NULLIF(SUM(result IN ('win','loss')), 0), 3) AS winrate
FROM v_analyzed GROUP BY matchup;

CREATE VIEW v_map_winrates AS
SELECT map_name, COUNT(*) AS games,
  SUM(result = 'win') AS wins, SUM(result = 'loss') AS losses,
  ROUND(1.0 * SUM(result = 'win') / NULLIF(SUM(result IN ('win','loss')), 0), 3) AS winrate
FROM v_analyzed GROUP BY map_name;

CREATE VIEW v_opponents AS
SELECT opp_name, COUNT(*) AS games,
  SUM(result = 'win') AS wins, SUM(result = 'loss') AS losses,
  GROUP_CONCAT(DISTINCT opp_race) AS races, MAX(played_at) AS last_played
FROM v_analyzed GROUP BY opp_name;

-- My metrics joined to game context: the base for "how I play" (wins vs losses, trends).
CREATE VIEW v_my_metrics AS
SELECT g.game_key, g.played_at, g.result, g.matchup, g.map_name, g.source, m.metric, m.value
FROM v_analyzed g
JOIN player_metrics m ON m.game_key = g.game_key AND m.player_id = g.me_player_id;
`;

export type DB = DatabaseSync;

export function openDb(file: string, opts: { readOnly?: boolean } = {}): DB {
  if (!opts.readOnly) mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { readOnly: opts.readOnly ?? false });
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (opts.readOnly) return db;
  db.exec("PRAGMA journal_mode = WAL;");
  const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'meta'").get();
  const version = hasMeta ? Number((db.prepare("SELECT value FROM meta WHERE key = 'db_version'").get() as { value: string } | undefined)?.value ?? 0) : 0;
  if (version < 1) {
    transaction(db, () => {
      db.exec(SCHEMA_V1);
      db.prepare("INSERT INTO meta (key, value) VALUES ('db_version', ?)").run(String(DB_VERSION));
    });
  }
  // Metric definitions are code; refresh them every start so the DB documents itself.
  transaction(db, () => {
    db.exec("DELETE FROM metric_defs");
    const ins = db.prepare("INSERT INTO metric_defs VALUES (?, ?, ?, ?, ?)");
    for (const m of METRICS) ins.run(m.key, m.label, m.unit, m.group, m.description);
  });
  return db;
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

const mapName = (file: string) =>
  file
    .replace(/\.w3[xm]$/i, "")
    .replace(/^\(\d+\)/, "")
    .replace(/^\d+_w3c_\d+_\d+_/, "") // W3Champions pool prefix: 44_w3c_260919_1153_
    .replace(/_(S\d+|LV|v[\d.]+)+$/i, "")
    .replace(/_/g, " ")
    .trim();

export { mapName };

/** Replace everything stored for one game with the given record (annotations are kept). */
export function writeGame(db: DB, r: GameRecord, archiveSha256: string) {
  const me = r.players.find((p) => p.isMe);
  const opp = r.classification.opponentId === null ? undefined : r.players.find((p) => p.playerId === r.classification.opponentId);
  transaction(db, () => {
    // Child rows go with it (ON DELETE CASCADE); annotations are not linked and survive.
    db.prepare("DELETE FROM games WHERE game_key = ?").run(r.gameKey);
    db.prepare(`INSERT INTO games VALUES (${Array(34).fill("?").join(", ")})`).run(
      r.gameKey, r.game.playedAt, r.game.endedAt, r.game.timeSource, r.game.durationMs,
      r.classification.source, r.classification.category, r.classification.analyzed ? 1 : 0, r.classification.skipReason,
      r.game.map.file, mapName(r.game.map.file), r.game.map.checksum,
      r.game.gameName, r.game.gameTypeRaw, r.game.version, r.game.build,
      me?.playerId ?? null, me?.name ?? null, me?.race ?? null,
      opp?.playerId ?? null, opp?.name ?? null, opp?.race ?? null,
      me && opp ? `${me.race}v${opp.race}` : null,
      r.result.me, r.result.method, r.result.confidence,
      r.userLabel, r.provenance.archivePath, archiveSha256,
      `${r.provenance.parser.name}@${r.provenance.parser.version}`,
      r.provenance.classifierVersion, r.provenance.metricsVersion, r.schemaVersion, r.provenance.ingestedAt,
    );
    const insPlayer = db.prepare("INSERT INTO game_players VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insMetric = db.prepare("INSERT INTO player_metrics VALUES (?, ?, ?, ?)");
    const insBuild = db.prepare("INSERT INTO build_events VALUES (?, ?, ?, ?, ?, ?)");
    const insHero = db.prepare("INSERT INTO heroes VALUES (?, ?, ?, ?, ?, ?, ?)");
    const insSkill = db.prepare("INSERT INTO hero_skills VALUES (?, ?, ?, ?, ?, ?)");
    const insApm = db.prepare("INSERT INTO apm_minutes VALUES (?, ?, ?, ?)");
    for (const p of r.players) {
      insPlayer.run(r.gameKey, p.playerId, p.name, p.teamId, p.racePicked, p.race, p.isMe ? 1 : 0, p.result, p.metrics.apm);
      for (const [k, v] of Object.entries(p.metrics)) insMetric.run(r.gameKey, p.playerId, k, v);
      for (const b of p.build) insBuild.run(r.gameKey, p.playerId, b.ms, b.kind, b.code, b.name);
      for (const h of p.heroes) {
        insHero.run(r.gameKey, p.playerId, h.order, h.code, h.name, h.level, h.retrainings);
        for (const s of h.skills) insSkill.run(r.gameKey, p.playerId, h.order, s.ms, s.code, s.name);
      }
      p.apmPerMinute.forEach((n, i) => insApm.run(r.gameKey, p.playerId, i, n));
    }
    const insChat = db.prepare("INSERT INTO chat VALUES (?, ?, ?, ?, ?)");
    for (const c of r.chat) insChat.run(r.gameKey, c.ms, c.player, c.mode, c.message);
    const insFile = db.prepare("INSERT INTO files VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const f of r.provenance.files) insFile.run(f.path, f.sha256, f.size, f.mtime, r.gameKey, f.durationMs, f.timeSource);
    const insRule = db.prepare("INSERT INTO classification_reasons VALUES (?, ?, ?, ?, ?)");
    r.classification.rules.forEach((x, i) => insRule.run(r.gameKey, i, x.rule, x.passed ? 1 : 0, x.evidence));
  });
}

export function addAnnotation(
  db: DB,
  a: { gameKey: string | null; kind: string; source: "user" | "llm" | "rule"; author?: string; model?: string; promptHash?: string; body: unknown },
) {
  db.prepare(
    "INSERT INTO annotations (game_key, kind, source, author, model, prompt_hash, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(a.gameKey, a.kind, a.source, a.author ?? null, a.model ?? null, a.promptHash ?? null, JSON.stringify(a.body), new Date().toISOString());
}
