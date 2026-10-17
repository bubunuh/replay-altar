// Reference profile: per-matchup distributions of every metric, plus per-minute curves,
// for the subject players of a reference group. Read by the desktop app and exports.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { METRICS, readRecord, transaction, type DB, type GameRecord, type ReferenceGroup } from "@w3stats/core";
import { summarizeValues, type Stat } from "./quantiles.ts";
import type { RefPaths } from "./store.ts";

export const CURVES = ["apm", "workers", "spent", "food", "armyFood"] as const;
export type CurveKey = (typeof CURVES)[number];
export type CurvePoint = { minute: number; n: number; p25: number; p50: number; p75: number };

export type MatchupProfile = {
  n: number;
  metrics: Record<string, Stat & { values: number[] }>;
  curves: Record<CurveKey, CurvePoint[]>;
};

export type RefProfile = {
  group: Pick<ReferenceGroup, "id" | "label" | "minMmr" | "race">;
  builtAt: string;
  replayBuild: number | null;
  games: number;
  /** "all" plus one entry per matchup from the subject's side, e.g. "HvO". */
  matchups: Record<string, MatchupProfile>;
};

const MIN_CURVE_N = 5;

type Sample = { record: GameRecord; subjectId: number };

function curveValues(s: Sample, key: CurveKey): Map<number, number> {
  const out = new Map<number, number>();
  const p = s.record.players.find((x) => x.playerId === s.subjectId)!;
  const fullMinutes = Math.floor(s.record.game.durationMs / 60_000);
  if (key === "apm") {
    p.apmPerMinute.slice(0, fullMinutes).forEach((v, i) => out.set(i + 1, v));
    return out;
  }
  const sim = s.record.sim?.status === "ok" ? s.record.sim.players.find((x) => x.playerId === s.subjectId) : null;
  if (!sim) return out;
  for (let m = 1; m <= fullMinutes; m++) {
    const sample = sim.series.filter((x) => x.t <= m * 60_000).at(-1);
    if (!sample) continue;
    const v =
      key === "workers" ? sample.workers
      : key === "spent" ? sample.goldSpent + sample.lumberSpent
      : key === "food" ? sample.foodUsed
      : Math.max(0, sample.foodUsed - sample.workers);
    out.set(m, v);
  }
  return out;
}

function profileOf(samples: Sample[]): MatchupProfile {
  const metrics: MatchupProfile["metrics"] = {};
  for (const m of METRICS) {
    const values = samples.map((s) => s.record.players.find((p) => p.playerId === s.subjectId)?.metrics[m.key]);
    const stat = summarizeValues(values);
    if (stat) metrics[m.key] = { ...stat, values: values.filter((v): v is number => typeof v === "number").sort((a, b) => a - b) };
  }
  const curves = {} as MatchupProfile["curves"];
  for (const key of CURVES) {
    const perMinute = new Map<number, number[]>();
    for (const s of samples) {
      for (const [minute, v] of curveValues(s, key)) {
        if (!perMinute.has(minute)) perMinute.set(minute, []);
        perMinute.get(minute)!.push(v);
      }
    }
    curves[key] = [...perMinute.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([minute, vs]) => ({ minute, stat: summarizeValues(vs)! }))
      .filter((x) => x.stat.n >= MIN_CURVE_N)
      .map(({ minute, stat }) => ({ minute, n: stat.n, p25: stat.p25, p50: stat.p50, p75: stat.p75 }));
  }
  return { n: samples.length, metrics, curves };
}

export function buildProfile(db: DB, paths: RefPaths, group: ReferenceGroup, replayBuild: number | null): RefProfile {
  const rows = db
    .prepare(
      `SELECT r.game_key, r.subject_player_id FROM ref_matches r JOIN games g ON g.game_key = r.game_key
       WHERE g.sim_status = 'ok' ${replayBuild === null ? "" : "AND r.replay_build = ?"}`,
    )
    .all(...(replayBuild === null ? [] : [replayBuild])) as { game_key: string; subject_player_id: number }[];
  const samples: (Sample & { matchup: string })[] = [];
  for (const row of rows) {
    const record = readRecord(paths, row.game_key);
    const subject = record?.players.find((p) => p.playerId === row.subject_player_id);
    const opp = record?.players.find((p) => p.playerId !== row.subject_player_id);
    if (!record || !subject || !opp) continue;
    samples.push({ record, subjectId: subject.playerId, matchup: `${subject.race}v${opp.race}` });
  }
  const matchups: RefProfile["matchups"] = { all: profileOf(samples) };
  for (const mu of new Set(samples.map((s) => s.matchup))) matchups[mu] = profileOf(samples.filter((s) => s.matchup === mu));

  const profile: RefProfile = {
    group: { id: group.id, label: group.label, minMmr: group.minMmr, race: group.race },
    builtAt: new Date().toISOString(),
    replayBuild,
    games: samples.length,
    matchups,
  };
  writeFileSync(join(paths.root, "profile.json"), JSON.stringify(profile));
  transaction(db, () => {
    db.exec("DELETE FROM ref_metric_stats");
    const ins = db.prepare("INSERT INTO ref_metric_stats VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const [mu, p] of Object.entries(matchups)) {
      for (const [metric, s] of Object.entries(p.metrics)) ins.run(mu, metric, s.n, s.p10, s.p25, s.p50, s.p75, s.p90);
    }
  });
  return profile;
}
