// Recurring problems and strengths on Performance: a table each, and the habit to work on now or to keep (recurring.ts).
import { useEffect, useMemo, useState } from "react";
import type { PerfGame } from "@replay-altar/core/ui";
import { api, type GameFindings } from "./api.ts";
import { problemName, strengthName } from "./format.ts";
import { recurringView, strengthItems, type RecurringView } from "./recurring.ts";
import { Tip } from "./Tip.tsx";
import { tr } from "@replay-altar/core/i18n";

export function Recurring({ games, onOpen }: { games: PerfGame[]; onOpen: (key: string) => void }) {
  const [all, setAll] = useState<GameFindings[] | null>(null);
  useEffect(() => {
    api.findingsSummary().then(setAll);
  }, [games.length]);

  const problems = useMemo(() => (all ? recurringView(games, all) : null), [all, games]);
  const strengths = useMemo(() => (all ? recurringView(games, all, strengthItems, true) : null), [all, games]);
  return (
    <>
      {problems && <RecurringCard view={problems} strengths={false} onOpen={onOpen} />}
      {strengths && <RecurringCard view={strengths} strengths onOpen={onOpen} />}
    </>
  );
}

/** One card: `strengths` false for the problems (fewer is better), true for the strengths (more is better). */
function RecurringCard({ view, strengths, onOpen }: { view: RecurringView; strengths: boolean; onOpen: (key: string) => void }) {
  const name = strengths ? strengthName : problemName;
  if (!view.rows.length) return null;
  const trend = (r: (typeof view.rows)[number]) => {
    if (!view.enough) return <span className="muted">—</span>;
    const tip = tr(`In ${r.recent} of your last 5 games, ${r.before} of the 5 before.`, `Em ${r.recent} das suas últimas 5 partidas, ${r.before} das 5 anteriores.`, `En ${r.recent} de tus últimas 5 partidas, ${r.before} de las 5 anteriores.`, `Dans ${r.recent} de vos 5 dernières parties, ${r.before} des 5 précédentes.`);
    const better = <span className="trend better" data-tip={tip}>{strengths ? "▲" : "▼"} {tr("better", "melhor", "mejor", "mieux")}</span>;
    const worse = <span className="trend worse" data-tip={tip}>{strengths ? "▼" : "▲"} {tr("worse", "pior", "peor", "moins bien")}</span>;
    if (r.recent !== r.before) return (r.recent > r.before) === strengths ? better : worse;
    return <span className="trend muted" data-tip={tr(`In ${r.recent} of your last 5 games and of the 5 before.`, `Em ${r.recent} das suas últimas 5 partidas e das 5 anteriores.`, `En ${r.recent} de tus últimas 5 partidas y de las 5 anteriores.`, `Dans ${r.recent} de vos 5 dernières parties et des 5 précédentes.`)}>= {tr("same", "igual", "igual", "pareil")}</span>;
  };
  return (
    <div className="card">
      <h2>
        {strengths ? tr("Recurring strengths", "Pontos fortes recorrentes", "Puntos fuertes recurrentes", "Points forts récurrents") : tr("Recurring problems", "Problemas recorrentes", "Problemas recurrentes", "Problèmes récurrents")}{" "}
        <Tip text={strengths ? tr("What went well across the games in view. Trend: your last 5 games against the 5 before; more is better. Click a row to open the latest game with it.", "O que foi bem nas partidas em vista. Tendência: suas últimas 5 partidas contra as 5 anteriores; mais é melhor. Clique numa linha para abrir a partida mais recente com ele.", "Lo que salió bien en las partidas a la vista. Tendencia: tus últimas 5 partidas contra las 5 anteriores; más es mejor. Haz clic en una fila para abrir la última partida con ese punto fuerte.", "Ce qui s'est bien passé dans les parties affichées. Tendance : vos 5 dernières parties contre les 5 précédentes ; plus, c'est mieux. Cliquez sur une ligne pour ouvrir la dernière partie concernée.") : tr("The rules' findings across the games in view (the three a report shows). Trend: your last 5 games against the 5 before. Click a row to open the latest game with it.", "Os problemas encontrados nas partidas em vista (os três que cada análise mostra). Tendência: suas últimas 5 partidas contra as 5 anteriores. Clique numa linha para abrir a partida mais recente com ele.", "Lo que encuentran las reglas en las partidas a la vista (los tres que muestra un análisis). Tendencia: tus últimas 5 partidas contra las 5 anteriores. Haz clic en una fila para abrir la última partida con ese problema.", "Ce que trouvent les règles dans les parties affichées (les trois que montre une analyse). Tendance : vos 5 dernières parties contre les 5 précédentes. Cliquez sur une ligne pour ouvrir la dernière partie concernée.")} />
      </h2>
      {view.focus && (
        <p className="one-thing">
          <b>{strengths ? tr("Keep doing this", "Continue assim", "Sigue así", "Continuez ainsi") : tr("Work on this now", "Trabalhe nisto agora", "Trabaja en esto ahora", "À travailler maintenant")}</b>
          <br />
          {name(view.focus.id)}:{" "}
          {strengths
            ? tr(`in ${view.focus.n} of your last ${view.last10} wins.`, `em ${view.focus.n} das suas últimas ${view.last10} vitórias.`, `en ${view.focus.n} de tus últimas ${view.last10} victorias.`, `dans ${view.focus.n} de vos ${view.last10} dernières victoires.`)
            : tr(`in ${view.focus.n} of your last ${view.last10} games.`, `em ${view.focus.n} das suas últimas ${view.last10} partidas.`, `en ${view.focus.n} de tus últimas ${view.last10} partidas.`, `dans ${view.focus.n} de vos ${view.last10} dernières parties.`)}{" "}
          {view.focusRow?.advice}
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>{strengths ? tr("Strength", "Ponto forte", "Punto fuerte", "Point fort") : tr("Problem", "Problema", "Problema", "Problème")}</th>
            <th className="num">{tr("In losses", "Em derrotas", "En derrotas", "Dans les défaites")}</th>
            <th className="num">{tr("In wins", "Em vitórias", "En victorias", "Dans les victoires")}</th>
            <th>{tr("Trend", "Tendência", "Tendencia", "Tendance")}</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.id} className="click" onClick={() => onOpen(r.latest)} data-tip={`${tr("Latest", "Mais recente", "Última", "Dernière")}: ${r.headline}.${r.advice ? ` ${r.advice}` : ""}`}>
              <td>{name(r.id)}</td>
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
