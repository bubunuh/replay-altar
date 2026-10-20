// The score screen's numbers column: you against your opponent on a few whole-game totals, the
// bigger number highlighted. Hover a row for its definition and how pros compare.
import type { GameRecord, MetricDef, PlayerRecord } from "@replay-altar/core/ui";
import { per10Minutes } from "@replay-altar/core/metrics";
import { assess } from "@replay-altar/reference/compare";
import type { MatchupProfile } from "@replay-altar/reference/types";
import { metricValue } from "./format.ts";
import { tr } from "@replay-altar/core/i18n";

/** Rows in order; where the game's official number is missing (Battle.net games), the replay's own stands in. */
const ROWS: string[][] = [
  ["units_killed"],
  ["units_produced", "units_ordered"],
  ["gold_collected"],
  ["lumber_collected"],
  ["resources_killed_total"],
  ["largest_army"],
  ["hero_xp_total"],
  ["heroes_killed"],
  ["apm"],
];

export function ScorePanel({ record, me, opp, metrics, mp }: { record: GameRecord; me: PlayerRecord; opp: PlayerRecord; metrics: MetricDef[]; mp: MatchupProfile | null }) {
  const has = (m?: MetricDef): m is MetricDef => !!m && (me.metrics[m.key] != null || opp.metrics[m.key] != null);
  const rows = ROWS.map((keys) => keys.map((k) => metrics.find((m) => m.key === k)).find(has)).filter(has);
  if (!rows.length) return null;
  return (
    <table className="score-panel">
      <thead>
        <tr>
          <th />
          <th className="num"><span className="key me" />{tr("You", "Você")}</th>
          <th className="num"><span className="key opp" />{tr("Opp", "Oponente")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const def: MetricDef = record.metricSources?.[m.key] === "official" ? { ...m, source: "official" } : m;
          const a = me.metrics[m.key];
          const b = opp.metrics[m.key];
          const lead = typeof a === "number" && typeof b === "number" && a !== b ? (a > b ? "me" : "opp") : null;
          const pro = assess(def, mp, { value: a, per10: typeof a === "number" ? per10Minutes(a, record.game.durationMs) : null }, b);
          const tip = [m.description, pro.proMedian !== null ? tr(
            `Pros' median: ${metricValue(def, pro.proMedian)}${pro.per10 ? " per 10 minutes" : ""}${pro.text !== "—" ? `; this game: ${pro.text}` : ""}.`,
            `Mediana dos pros: ${metricValue(def, pro.proMedian)}${pro.per10 ? " a cada 10 minutos" : ""}${pro.text !== "—" ? `; esta partida: ${pro.text}` : ""}.`,
          ) : ""].filter(Boolean).join(" ");
          return (
            <tr key={m.key} data-tip={tip}>
              <td>{m.label}</td>
              <td className={`num${lead === "me" ? " lead" : ""}`}>{metricValue(def, a)}</td>
              <td className={`num${lead === "opp" ? " lead" : ""}`}>{metricValue(def, b)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
