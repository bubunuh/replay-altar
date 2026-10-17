// How metric tables are split: Core (decides games, with verdicts), Mechanics (skill level),
// Details (everything else, collapsed).
import type { MetricDef } from "@w3stats/core/ui";
import { CORE_METRICS, MECHANICS_METRICS } from "@w3stats/core/metrics";

export const SECTION_INFO = {
  core: { title: "Core", note: "What decides games: in pro games and yours, the winner was better on these most of the time." },
  mechanics: { title: "Mechanics", note: "Skill level: these grow over months and separate you from pros, but don't decide single games, so no verdict per game." },
  details: { title: "Details", note: "Everything else. Useful for digging into a game, weak as a verdict on its own." },
} as const;

const byOrder = (order: string[]) => (a: MetricDef, b: MetricDef) => order.indexOf(a.key) - order.indexOf(b.key);

export function splitMetrics(metrics: MetricDef[]) {
  return {
    core: metrics.filter((m) => m.section === "core").sort(byOrder(CORE_METRICS)),
    mechanics: metrics.filter((m) => m.section === "mechanics").sort(byOrder(MECHANICS_METRICS)),
    details: metrics.filter((m) => m.section === "details"),
  };
}

/** Details grouped as before (Speed, Control, Heroes, ...), in first-appearance order. */
export function groupDetails(details: MetricDef[]): [string, MetricDef[]][] {
  const groups = [...new Set(details.map((m) => m.group))];
  return groups.map((g) => [g, details.filter((m) => m.group === g)]);
}
