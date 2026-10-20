// Recurring problems on Performance: the table and the habit to work on now (recurring.ts).
import { useEffect, useMemo, useState } from "react";
import type { PerfGame } from "@replay-altar/core/ui";
import { api, type GameFindings } from "./api.ts";
import { problemName } from "./format.ts";
import { recurringView } from "./recurring.ts";
import { Tip } from "./Tip.tsx";
import { tr } from "@replay-altar/core/i18n";

export function Recurring({ games, onOpen }: { games: PerfGame[]; onOpen: (key: string) => void }) {
  const [all, setAll] = useState<GameFindings[] | null>(null);
  useEffect(() => {
    api.findingsSummary().then(setAll);
  }, [games.length]);

  const view = useMemo(() => (all ? recurringView(games, all) : null), [all, games]);

  if (!view || !view.rows.length) return null;
  const trend = (r: (typeof view.rows)[number]) => {
    if (!view.enough) return <span className="muted">—</span>;
    const tip = tr(`In ${r.recent} of your last 5 games, ${r.before} of the 5 before.`, `Em ${r.recent} das suas últimas 5 partidas, ${r.before} das 5 anteriores.`);
    if (r.recent < r.before) return <span className="trend better" data-tip={tip}>▼ {tr("better", "melhor")}</span>;
    if (r.recent > r.before) return <span className="trend worse" data-tip={tip}>▲ {tr("worse", "pior")}</span>;
    return <span className="trend muted" data-tip={tr(`In ${r.recent} of your last 5 games and of the 5 before.`, `Em ${r.recent} das suas últimas 5 partidas e das 5 anteriores.`)}>= {tr("same", "igual")}</span>;
  };
  return (
    <div className="card">
      <h2>
        {tr("Recurring problems", "Problemas recorrentes")}{" "}
        <Tip text={tr("The rules' findings across the games in view (the three a report shows). Trend: your last 5 games against the 5 before. Click a row to open the latest game with it.", "Os problemas encontrados nas partidas em vista (os três que cada análise mostra). Tendência: suas últimas 5 partidas contra as 5 anteriores. Clique numa linha para abrir a partida mais recente com ele.")} />
      </h2>
      {view.focus && (
        <p className="one-thing">
          <b>{tr("Work on this now", "Trabalhe nisto agora")}</b>
          <br />
          {problemName(view.focus.id)}: {tr(`in ${view.focus.n} of your last ${view.last10} games.`, `em ${view.focus.n} das suas últimas ${view.last10} partidas.`)} {view.focusRow?.advice}
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>{tr("Problem", "Problema")}</th>
            <th className="num">{tr("In losses", "Em derrotas")}</th>
            <th className="num">{tr("In wins", "Em vitórias")}</th>
            <th>{tr("Trend", "Tendência")}</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.id} className="click" onClick={() => onOpen(r.latest)} data-tip={`${tr("Latest", "Mais recente")}: ${r.headline}.${r.advice ? ` ${r.advice}` : ""}`}>
              <td>{problemName(r.id)}</td>
              <td className="num">{r.inLosses} {tr("of", "de")} {view.losses}</td>
              <td className="num">{r.inWins} {tr("of", "de")} {view.wins}</td>
              <td>{trend(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
