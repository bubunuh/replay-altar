// A game's report as Markdown for Reddit or Discord: result, matchup, map, heroes, the findings
// with their advice. Nobody's battletag: the opponent is named by race only.
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import type { RulesBook } from "@replay-altar/rules/types";
import { tr } from "@replay-altar/core/i18n";
import { mmss, RACE, SOURCE } from "./format.ts";

export const PROJECT_URL = "https://github.com/bubunuh/replay-altar";

const mapName = (file: string) => file.replace(/^.*[\\/]/, "").replace(/^\(\d+\)|\.w3[xm]$/gi, "").replace(/^\d*_?w3c_(s\d+_)?\d+_\d+_/, "").replace(/_/g, " ");
const heroes = (p: PlayerRecord) =>
  [...p.heroes]
    .sort((a, b) => a.order - b.order)
    .map((h) => `${h.name} ${h.level}`)
    .join(", ") || "—";

export function shareText(r: GameRecord, me: PlayerRecord, opp: PlayerRecord, result: string, book: RulesBook | null): string {
  const outcome = result === "win" ? tr("Victory", "Vitória", "Victoria", "Victoire") : result === "loss" ? tr("Defeat", "Derrota", "Derrota", "Défaite") : tr("Game", "Partida", "Partida", "Partie");
  const lines = [
    `**${outcome}** · ${RACE[me.race] ?? me.race} vs ${RACE[opp.race] ?? opp.race} · ${mapName(r.game.map.file)} · ${mmss(r.game.durationMs)} (${SOURCE[r.classification.source] ?? r.classification.source})`,
    `${tr("Heroes", "Heróis", "Héroes", "Héros")}: ${heroes(me)} ${tr("vs", "contra", "contra", "contre")} ${heroes(opp)}`,
  ];
  if (book) {
    lines.push("", book.recap);
    if (book.findings.length) {
      lines.push("", `**${tr("Findings", "Problemas", "Análisis", "Analyse")}**`);
      book.findings.forEach((f, i) => {
        lines.push(`${i + 1}. **${f.headline}**`);
        for (const e of f.evidence) lines.push(`   - ${e}`);
        if (f.advice) lines.push(`   - *${tr("Next time", "Na próxima", "La próxima vez", "La prochaine fois")}:* ${f.advice}`);
      });
    }
    if (book.turningPoint) lines.push("", `**${tr("Turning point", "Momento decisivo", "Momento decisivo", "Tournant")}:** ${book.turningPoint}`);
    if (book.strengths.length) lines.push("", `**${tr("Strengths", "Pontos fortes", "Puntos fuertes", "Points forts")}:** ${book.strengths.join(" ")}`);
  }
  lines.push("", `*${tr("Analyzed with Replay Altar", "Analisado com o Replay Altar", "Analizado con Replay Altar", "Analysé avec Replay Altar")}: ${PROJECT_URL}*`);
  return lines.join("\n");
}
