import type { MetricDef } from "@replay-altar/core/ui";
import { TIER_LABEL, TYPICAL_LABEL, type Assessment } from "@replay-altar/reference/compare";
import { metricValue } from "./format.ts";
import { tr } from "@replay-altar/core/i18n";

/** Coloured label (with words, never colour alone) plus the plain-language comparison. */
export function Standing({ a }: { a: Assessment }) {
  return (
    <span className="standing">
      {a.tier && <span className={`tier ${a.tier}`}>{(a.typicality ? TYPICAL_LABEL : TIER_LABEL)[a.tier]}</span>}
      <span className="muted small">{a.text}</span>
    </span>
  );
}

/** Pro median in the compared unit; whole-game totals are per 10 minutes. */
export function ProMedian({ def, a }: { def: MetricDef; a: Assessment }) {
  if (a.proMedian === null) return <>—</>;
  return (
    <>
      {metricValue(def, a.proMedian)}
      {a.per10 && <span className="muted small"> {tr("/10 min", "a cada 10 min", "/10 min", "/10 min")}</span>}
    </>
  );
}
