// How metric tables are split: Core (decides games, with verdicts), Mechanics (skill level),
// Details (everything else, collapsed).
import type { MetricDef } from "@replay-altar/core/ui";
import { CORE_METRICS, MECHANICS_METRICS } from "@replay-altar/core/metrics";
import { tr } from "@replay-altar/core/i18n";

export const SECTION_INFO = {
  core: {
    title: tr("Core", "Essencial"),
    note: tr("What decides games: in pro games and yours, the winner was better on these most of the time.", "O que decide partidas: nas partidas dos pros e nas suas, o vencedor foi melhor nestes números na maioria das vezes."),
  },
  upgrades: {
    title: "Upgrades",
    note: tr("When you ordered each research; pros column = their median time · share of pro games that research it. Timing depends on strategy, so no verdict.", "Quando você pediu cada pesquisa; coluna dos pros = tempo mediano deles · parte das partidas de pros que fazem essa pesquisa. O tempo depende da estratégia, então não há veredito."),
  },
  mechanics: {
    title: tr("Mechanics", "Mecânica"),
    note: tr("Skill habits: speed, hotkeys, not getting supply blocked. They grow over months and are a big part of what separates you from pros.", "Hábitos de habilidade: velocidade, atalhos, não travar no food. Melhoram ao longo de meses e são boa parte do que separa você dos pros."),
  },
  details: {
    title: tr("Details", "Detalhes"),
    note: tr("Everything else. Useful for digging into a game, weak as a verdict on its own.", "Todo o resto. Útil para investigar uma partida, fraco como veredito sozinho."),
  },
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
