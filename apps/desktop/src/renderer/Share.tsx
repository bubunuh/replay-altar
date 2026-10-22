// "Share": the report as text (Markdown, for Reddit or Discord) or as a PDF of the whole page
// (result, findings, charts, numbers, heroes, build orders). The opponent's battletag is hidden
// unless you show it.
import { useState } from "react";
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import { tr } from "@replay-altar/core/i18n";
import { api } from "./api.ts";
import { shareText } from "./shareText.ts";

type Props = {
  record: GameRecord;
  me: PlayerRecord;
  opp: PlayerRecord;
  result: string;
  hideNames: boolean;
  setHideNames: (v: boolean) => void;
  /** Shows the opponent as "Opponent" everywhere on the page while the PDF is made. */
  setAnonymous: (v: boolean) => void;
};

/** The box under the Share button: what to share and how. */
export function Share({ record, me, opp, result, hideNames, setHideNames, setAnonymous }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const done = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 2500);
  };

  const copyText = async () => {
    const book = await api.rules(record.gameKey).catch(() => null);
    await api.copyText(shareText(record, me, opp, result, book));
    done(tr("Text copied", "Texto copiado", "Texto copiado", "Texte copié"));
  };
  const savePdf = async () => {
    setStatus(tr("Making the PDF…", "Gerando o PDF…", "Generando el PDF…", "Création du PDF…"));
    // The page laid out for paper: no buttons or menus, every section full length.
    document.documentElement.classList.add("printing");
    setAnonymous(hideNames);
    try {
      // Charts redraw for the new layout and names: give them a moment.
      await new Promise((r) => setTimeout(r, 600));
      const saved = await api.savePdf(`replay-altar-${record.game.playedAt.slice(0, 10)}-${me.race}v${opp.race}.pdf`);
      if (saved) done(tr("PDF saved", "PDF salvo", "PDF guardado", "PDF enregistré"));
      else setStatus(null);
    } finally {
      setAnonymous(false);
      document.documentElement.classList.remove("printing");
    }
  };

  return (
    <div className="share-box">
      <label>
        <input type="checkbox" checked={hideNames} onChange={(e) => setHideNames(e.target.checked)} />
        {tr("Hide the opponent's battletag", "Esconder a battletag do oponente", "Ocultar la battletag del rival", "Masquer le battletag de l'adversaire")}
      </label>
      <div className="filters">
        <button className="btn" onClick={copyText}>{tr("Copy as text", "Copiar como texto", "Copiar como texto", "Copier en texte")}</button>
        <button className="btn" onClick={savePdf}>{tr("Save as PDF…", "Salvar como PDF…", "Guardar como PDF…", "Enregistrer en PDF…")}</button>
        {status && <span className="muted small">{status}</span>}
      </div>
      <p className="sub" style={{ margin: 0 }}>{tr("The text names no one; the PDF holds the whole report: result, findings, charts, numbers, heroes and build orders.", "O texto não cita ninguém; o PDF traz a análise inteira: resultado, problemas, gráficos, números, heróis e builds.", "El texto no nombra a nadie; el PDF contiene el análisis completo: resultado, hallazgos, gráficos, números, héroes y órdenes de construcción.", "Le texte ne nomme personne ; le PDF contient toute l'analyse : résultat, constats, graphiques, chiffres, héros et ordres de construction.")}</p>
    </div>
  );
}
