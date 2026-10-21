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
    const tip = tr(`In ${r.recent} of your last 5 games, ${r.before} of the 5 before.`, `Em ${r.recent} das suas últimas 5 partidas, ${r.before} das 5 anteriores.`, `En ${r.recent} de tus últimas 5 partidas, ${r.before} de las 5 anteriores.`, `Dans ${r.recent} de vos 5 dernières parties, ${r.before} des 5 précédentes.`);
    if (r.recent < r.before) return <span className="trend better" data-tip={tip}>▼ {tr("better", "melhor", "mejor", "mieux")}</span>;
    if (r.recent > r.before) return <span className="trend worse" data-tip={tip}>▲ {tr("worse", "pior", "peor", "moins bien")}</span>;
    return <span className="trend muted" data-tip={tr(`In ${r.recent} of your last 5 games and of the 5 before.`, `Em ${r.recent} das suas últimas 5 partidas e das 5 anteriores.`, `En ${r.recent} de tus últimas 5 partidas y de las 5 anteriores.`, `Dans ${r.recent} de vos 5 dernières parties et des 5 précédentes.`)}>= {tr("same", "igual", "igual", "pareil")}</span>;
  };
  return (
    <div className="card">
      <h2>
        {tr("Recurring problems", "Problemas recorrentes", "Problemas recurrentes", "Problèmes récurrents")}{" "}
        <Tip text={tr("The rules' findings across the games in view (the three a report shows). Trend: your last 5 games against the 5 before. Click a row to open the latest game with it.", "Os problemas encontrados nas partidas em vista (os três que cada análise mostra). Tendência: suas últimas 5 partidas contra as 5 anteriores. Clique numa linha para abrir a partida mais recente com ele.", "Lo que encuentran las reglas en las partidas a la vista (los tres que muestra un análisis). Tendencia: tus últimas 5 partidas contra las 5 anteriores. Haz clic en una fila para abrir la última partida con ese problema.", "Ce que trouvent les règles dans les parties affichées (les trois que montre une analyse). Tendance : vos 5 dernières parties contre les 5 précédentes. Cliquez sur une ligne pour ouvrir la dernière partie concernée.")} />
      </h2>
      {view.focus && (
        <p className="one-thing">
          <b>{tr("Work on this now", "Trabalhe nisto agora", "Trabaja en esto ahora", "À travailler maintenant")}</b>
          <br />
          {problemName(view.focus.id)}: {tr(`in ${view.focus.n} of your last ${view.last10} games.`, `em ${view.focus.n} das suas últimas ${view.last10} partidas.`, `en ${view.focus.n} de tus últimas ${view.last10} partidas.`, `dans ${view.focus.n} de vos ${view.last10} dernières parties.`)} {view.focusRow?.advice}
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>{tr("Problem", "Problema", "Problema", "Problème")}</th>
            <th className="num">{tr("In losses", "Em derrotas", "En derrotas", "Dans les défaites")}</th>
            <th className="num">{tr("In wins", "Em vitórias", "En victorias", "Dans les victoires")}</th>
            <th>{tr("Trend", "Tendência", "Tendencia", "Tendance")}</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.id} className="click" onClick={() => onOpen(r.latest)} data-tip={`${tr("Latest", "Mais recente", "Última", "Dernière")}: ${r.headline}.${r.advice ? ` ${r.advice}` : ""}`}>
              <td>{problemName(r.id)}</td>
              <td className="num">{r.inLosses} {tr("of", "de", "de", "sur")} {view.losses}</td>
              <td className="num">{r.inWins} {tr("of", "de", "de", "sur")} {view.wins}</td>
              <td>{trend(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
