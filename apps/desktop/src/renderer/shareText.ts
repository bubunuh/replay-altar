// A game's report as Markdown for Reddit or Discord: result, matchup, map, heroes, the findings
// with their advice. Nobody's battletag: the opponent is named by race only.
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import type { RulesBook } from "@replay-altar/rules/types";
import { tr } from "@replay-altar/core/i18n";
import { mmss, RACE, SOURCE } from "./format.ts";

export const PROJECT_URL = "https://github.com/bubunuh/replay-altar";

const mapName = (file: string) => file.replace(/^.*[\\/]/, "").replace(/^\(\d+\)|\.w3x$/gi, "").replace(/_/g, " ");
const heroes = (p: PlayerRecord) =>
  [...p.heroes]
    .sort((a, b) => a.order - b.order)
    .map((h) => `${h.name} ${h.level}`)
    .join(", ") || "—";

export function shareText(r: GameRecord, me: PlayerRecord, opp: PlayerRecord, result: string, book: RulesBook | null): string {
  const outcome = result === "win" ? tr("Victory", "Vitória") : result === "loss" ? tr("Defeat", "Derrota") : tr("Game", "Partida");
  const lines = [
    `**${outcome}** · ${RACE[me.race] ?? me.race} vs ${RACE[opp.race] ?? opp.race} · ${mapName(r.game.map.file)} · ${mmss(r.game.durationMs)} (${SOURCE[r.classification.source] ?? r.classification.source})`,
    `${tr("Heroes", "Heróis")}: ${heroes(me)} ${tr("vs", "contra")} ${heroes(opp)}`,
  ];
  if (book) {
    lines.push("", book.recap);
    if (book.findings.length) {
      lines.push("", `**${tr("Findings", "Problemas")}**`);
      book.findings.forEach((f, i) => {
        lines.push(`${i + 1}. **${f.headline}**`);
        for (const e of f.evidence) lines.push(`   - ${e}`);
        if (f.advice) lines.push(`   - *${tr("Next time", "Na próxima")}:* ${f.advice}`);
      });
    }
    if (book.turningPoint) lines.push("", `**${tr("Turning point", "Momento decisivo")}:** ${book.turningPoint}`);
    if (book.strengths.length) lines.push("", `**${tr("Strengths", "Pontos fortes")}:** ${book.strengths.join(" ")}`);
  }
  lines.push("", `*${tr("Analyzed with Replay Altar", "Analisado com o Replay Altar")}: ${PROJECT_URL}*`);
  return lines.join("\n");
}
