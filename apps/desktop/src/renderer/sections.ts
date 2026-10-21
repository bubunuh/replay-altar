// How metric tables are split: Core (decides games, with verdicts), Mechanics (skill level),
// Details (everything else, collapsed).
import type { MetricDef } from "@replay-altar/core/ui";
import { CORE_METRICS, MECHANICS_METRICS } from "@replay-altar/core/metrics";
import { tr } from "@replay-altar/core/i18n";

export const SECTION_INFO = {
  core: {
    title: tr("Core", "Essencial", "Lo esencial", "L'essentiel"),
    note: tr("What decides games: in pro games and yours, the winner was better on these most of the time.", "O que decide partidas: nas partidas dos pros e nas suas, o vencedor foi melhor nestes números na maioria das vezes.", "Lo que decide las partidas: en las de los pros y en las tuyas, el ganador fue mejor en esto la mayoría de las veces.", "Ce qui décide les parties : dans celles des pros comme dans les vôtres, le gagnant était meilleur sur ces points la plupart du temps."),
  },
  upgrades: {
    title: "Upgrades",
    note: tr("When you ordered each research; pros column = their median time · share of pro games that research it. Timing depends on strategy, so no verdict.", "Quando você pediu cada pesquisa; coluna dos pros = tempo mediano deles · parte das partidas de pros que fazem essa pesquisa. O tempo depende da estratégia, então não há veredito.", "Cuándo ordenaste cada investigación; columna de pros = su tiempo mediano · porcentaje de partidas de pros que la investigan. El momento depende de la estrategia, así que no hay veredicto.", "Quand vous avez commandé chaque recherche ; colonne des pros = leur temps médian · part des parties de pros qui la font. Le timing dépend de la stratégie, donc pas de verdict."),
  },
  mechanics: {
    title: tr("Mechanics", "Mecânica", "Mecánica", "Mécanique"),
    note: tr("Skill habits: speed, hotkeys, not getting supply blocked. They grow over months and are a big part of what separates you from pros.", "Hábitos de habilidade: velocidade, atalhos, não travar no food. Melhoram ao longo de meses e são boa parte do que separa você dos pros.", "Hábitos de habilidad: velocidad, atajos, no quedarse bloqueado por food. Mejoran con los meses y son una gran parte de lo que te separa de los pros.", "Habitudes techniques : vitesse, raccourcis, ne pas être bloqué par la food. Elles progressent sur des mois et sont une grande partie de ce qui vous sépare des pros."),
  },
  details: {
    title: tr("Details", "Detalhes", "Detalles", "Détails"),
    note: tr("Everything else. Useful for digging into a game, weak as a verdict on its own.", "Todo o resto. Útil para investigar uma partida, fraco como veredito sozinho.", "Todo lo demás. Útil para profundizar en una partida, poco fiable como veredicto por sí solo.", "Tout le reste. Utile pour creuser une partie, peu fiable comme verdict à lui seul."),
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
