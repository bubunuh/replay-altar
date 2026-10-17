// Compact, self-explaining digests of games for people and LLMs.
// Effective results (with manual overrides) come from the DB; details from the game records.
import type { DB } from "./db.ts";
import { readRecord, type Paths } from "./store.ts";
import { METRICS } from "./metrics.ts";
import { RACE_NAMES } from "./gamedata.ts";
import type { GameRecord, PlayerRecord } from "./record.ts";

export const mmss = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

type GameRow = { game_key: string; result: string };

/** Reference distributions for one matchup (shape of profile.json's matchups[x].metrics). */
export type RefMetrics = { label: string; matchup: string; games: number; metrics: Record<string, { p50: number; values: number[] }> };
export type RefLookup = (matchup: string | null) => RefMetrics | null;

function vsReference(metrics: Record<string, number | null>, ref: RefMetrics) {
  const out: Record<string, { proMedian: number | string; shareOfProGamesBelow: number }> = {};
  for (const m of METRICS) {
    const x = metrics[m.key];
    const r = ref.metrics[m.key];
    if (x === null || x === undefined || !r || r.values.length < 5) continue;
    const below = r.values.filter((v) => v < x).length + r.values.filter((v) => v === x).length / 2;
    out[m.key] = {
      proMedian: m.unit === "ms" ? mmss(r.p50) : Math.round(r.p50 * 1000) / 1000,
      shareOfProGamesBelow: Math.round((below / r.values.length) * 100) / 100,
    };
  }
  return { reference: `${ref.label}, ${ref.matchup === "all" ? "all matchups" : ref.matchup}, ${ref.games} games`, metrics: out };
}

function playerDigest(p: PlayerRecord, buildLimit: number) {
  return {
    name: p.name,
    race: RACE_NAMES[p.race] ?? p.race,
    result: p.result,
    metrics: Object.fromEntries(
      METRICS.map((m) => [m.key, m.unit === "ms" ? mmss(p.metrics[m.key]) : p.metrics[m.key] === null ? null : Math.round(p.metrics[m.key]! * 1000) / 1000]),
    ),
    heroes: p.heroes.map((h) => `${h.name} L${h.level}: ${h.skills.map((s) => s.name).join(" > ")}`),
    buildOrder: p.build.slice(0, buildLimit).map((b) => `${mmss(b.ms)} ${b.name}`),
  };
}

export function gameDigest(r: GameRecord, effectiveResult: string, buildLimit = 40, refLookup?: RefLookup) {
  const me = r.players.find((p) => p.isMe);
  const opp = r.players.find((p) => p.playerId === r.classification.opponentId);
  const ref = refLookup && me && opp ? refLookup(`${me.race}v${opp.race}`) : null;
  return {
    gameKey: r.gameKey,
    playedAt: r.game.playedAt,
    playedAtSource: r.game.timeSource,
    source: r.classification.source,
    map: r.game.map.file,
    durationMin: Math.round(r.game.durationMs / 6000) / 10,
    result: effectiveResult,
    resultDetected: r.result.me,
    resultMethod: r.result.method,
    resultConfidence: r.result.confidence,
    userLabel: r.userLabel,
    me: me && playerDigest(me, buildLimit),
    meVsPros: me && ref ? vsReference(me.metrics, ref) : null,
    opponent: opp && playerDigest(opp, buildLimit),
    caveats:
      "Replay metrics: times are when orders were issued (cancels included); heroes are timed by first skill learned. Economy, supply, fight and hero-level metrics come from simulating the replay (WC3V); metrics with source 'estimate' (losses, trades, mined/unspent resources) are approximate. See each metric's definition.",
    provenance: { archive: r.provenance.archivePath, parser: `${r.provenance.parser.name}@${r.provenance.parser.version}`, metricsVersion: r.provenance.metricsVersion, classifierVersion: r.provenance.classifierVersion },
  };
}

export function exportJsonl(db: DB, paths: Paths, refLookup?: RefLookup): string {
  const rows = db.prepare("SELECT game_key, result FROM v_analyzed ORDER BY played_at").all() as GameRow[];
  return rows
    .map((row) => readRecord(paths, row.game_key))
    .filter((r): r is GameRecord => r !== null)
    .map((r, i) => JSON.stringify(gameDigest(r, rows[i].result, 40, refLookup)))
    .join("\n");
}

export function exportMarkdown(db: DB, paths: Paths, gameKey: string, refLookup?: RefLookup): string | null {
  const row = db.prepare("SELECT game_key, result FROM v_games WHERE game_key = ?").get(gameKey) as GameRow | undefined;
  const r = row && readRecord(paths, row.game_key);
  if (!r || !row) return null;
  const d = gameDigest(r, row.result, 1000, refLookup);
  const lines = [
    `# ${d.result.toUpperCase()} — ${d.me?.race ?? "?"} vs ${d.opponent?.name ?? "?"} (${d.opponent?.race ?? "?"}) on ${d.map}`,
    "",
    `- Played: ${d.playedAt} (time from ${d.playedAtSource}); duration ${d.durationMin} min; source ${d.source}`,
    `- Result: ${d.result} (detected ${d.resultDetected} via ${d.resultMethod}, confidence ${d.resultConfidence})`,
    d.userLabel ? `- Your label: ${d.userLabel}` : "",
    `- Game key: ${d.gameKey}`,
    "",
    `> ${d.caveats}`,
    "",
    "## Metrics",
    "",
    d.meVsPros ? `Pros: ${d.meVsPros.reference}. "Pro games below" = share of pro games with a lower value.` : "",
    "",
    "| Metric | Me | Opponent | Pros (median) | Pro games below me | Definition |",
    "|---|---|---|---|---|---|",
    ...METRICS.map((m) => {
      const vp = d.meVsPros?.metrics[m.key];
      return `| ${m.label} | ${d.me?.metrics[m.key] ?? "—"} | ${d.opponent?.metrics[m.key] ?? "—"} | ${vp ? vp.proMedian : "—"} | ${vp ? `${Math.round(vp.shareOfProGamesBelow * 100)}%` : "—"} | ${m.description} |`;
    }),
    "",
  ];
  for (const [who, p] of [["Me", d.me], ["Opponent", d.opponent]] as const) {
    if (!p) continue;
    lines.push(`## ${who}: ${p.name} (${p.race})`, "", "Heroes:", ...p.heroes.map((h) => `- ${h}`), "", "Build order:", ...p.buildOrder.map((b) => `- ${b}`), "");
  }
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}
