import { useEffect, useMemo, useState } from "react";
import { api, type GameFindings } from "../api.ts";
import type { GameRow } from "@replay-altar/core/ui";
import { dateTime, mmss, problemName, RACE, shortName, SOURCE } from "../format.ts";
import { RaceIcon } from "../RaceIcon.tsx";
import { tr } from "@replay-altar/core/i18n";
import { ReplayFolders } from "./Other.tsx";

export function Result({ result }: { result: string }) {
  return <span className={`result ${result}`}>{result === "win" ? tr("Win", "Vitória", "Victoria", "Victoire") : result === "loss" ? tr("Loss", "Derrota", "Derrota", "Défaite") : tr("Unknown", "Desconhecido", "Desconocido", "Inconnu")}</span>;
}

export function Matches({ games, onOpen }: { games: GameRow[]; onOpen: (key: string) => void }) {
  const [source, setSource] = useState("all");
  const [result, setResult] = useState("all");
  const [oppRace, setOppRace] = useState("all");
  const [q, setQ] = useState("");
  const [problem, setProblem] = useState("all");
  const [found, setFound] = useState<Map<string, GameFindings["findings"]>>(new Map());
  useEffect(() => {
    api.findingsSummary().then((list) => setFound(new Map(list.map((g) => [g.key, g.findings]))));
  }, [games]);
  // Replays found before you confirmed your battletag are kept, but none of them is yours yet.
  const [noBattletag, setNoBattletag] = useState(false);
  useEffect(() => {
    api.getConfig().then((s) => setNoBattletag(s.config.accounts.length === 0));
  }, [games]);
  // Problems that come up in the reports (the top three each), most frequent first.
  const problems = useMemo(() => {
    const n = new Map<string, number>();
    for (const f of found.values()) for (const x of f.slice(0, 3)) n.set(x.id, (n.get(x.id) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [found]);

  const rows = useMemo(
    () =>
      games.filter(
        (g) =>
          g.analyzed === 1 &&
          (source === "all" || g.source === source) &&
          (result === "all" || g.result === result) &&
          (oppRace === "all" || g.opp_race === oppRace) &&
          (problem === "all" || (found.get(g.game_key) ?? []).slice(0, 3).some((f) => f.id === problem)) &&
          (!q || `${g.opp_name} ${g.map_name} ${g.user_label ?? ""}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [games, source, result, oppRace, q, problem, found],
  );

  return (
    <div className="page">
      <div className="filters">
        <label>
          {tr("Source", "Origem", "Origen", "Origine")}
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">{tr("All", "Todas", "Todos", "Toutes")}</option>
            {Object.entries(SOURCE).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          {tr("Result", "Resultado", "Resultado", "Résultat")}
          <select value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="all">{tr("All", "Todos", "Todos", "Toutes")}</option>
            <option value="win">{tr("Wins", "Vitórias", "Victorias", "Victoires")}</option>
            <option value="loss">{tr("Losses", "Derrotas", "Derrotas", "Défaites")}</option>
          </select>
        </label>
        <label>
          {tr("Opponent race", "Raça do oponente", "Raza del rival", "Race de l'adversaire")}
          <select value={oppRace} onChange={(e) => setOppRace(e.target.value)}>
            <option value="all">{tr("All", "Todas", "Todos", "Toutes")}</option>
            {["H", "O", "U", "N"].map((r) => (
              <option key={r} value={r}>{RACE[r]}</option>
            ))}
          </select>
        </label>
        <label>
          {tr("Problem", "Problema", "Problema", "Problème")}
          <select value={problem} onChange={(e) => setProblem(e.target.value)}>
            <option value="all">{tr("All", "Todos", "Todos", "Toutes")}</option>
            {problems.map((id) => (
              <option key={id} value={id}>{problemName(id)}</option>
            ))}
          </select>
        </label>
        <input type="text" placeholder={tr("Search opponent, map, label", "Buscar oponente, mapa, nome", "Buscar rival, mapa, etiqueta", "Chercher adversaire, carte, étiquette")} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{tr(`${rows.length} games`, `${rows.length} partidas`, `${rows.length} partidas`, `${rows.length} parties`)}</span>
      </div>
      {games.length === 0 && <ReplayFolders empty />}
      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty">
            {noBattletag && games.length
              ? (games.length === 1 ? tr("1 replay found.", "1 replay encontrado.", "1 replay encontrado.", "1 replay trouvé.") : tr(`${games.length} replays found.`, `${games.length} replays encontrados.`, `${games.length} replays encontrados.`, `${games.length} replays trouvés.`)) +
                " " +
                tr("Confirm your battletag above (or type it in Settings) to see your games.", "Confirme a sua battletag acima (ou digite-a em Configurações) para ver as suas partidas.", "Confirma tu battletag arriba (o escríbela en Configuración) para ver tus partidas.", "Confirmez votre battletag ci-dessus (ou saisissez-le dans les Paramètres) pour voir vos parties.")
              : games.some((g) => g.analyzed === 1)
              ? tr("No games match these filters.", "Nenhuma partida com esses filtros.", "Ninguna partida coincide con estos filtros.", "Aucune partie ne correspond à ces filtres.")
              : tr("No analyzed games yet. Play a 1v1 — it shows up here when the game ends.", "Nenhuma partida analisada ainda. Jogue um 1v1 — ele aparece aqui quando a partida acabar.", "Todavía no hay partidas analizadas. Juega un 1v1: aparece aquí cuando termina la partida.", "Aucune partie analysée pour l'instant. Jouez un 1v1 : il apparaît ici à la fin de la partie.")}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{tr("Played", "Jogada em", "Jugada", "Jouée")}</th>
                <th>{tr("Result", "Resultado", "Resultado", "Résultat")}</th>
                <th>{tr("Matchup", "Confronto", "Enfrentamiento", "Matchup")}</th>
                <th>{tr("Opponent", "Oponente", "Rival", "Adversaire")}</th>
                <th>{tr("Map", "Mapa", "Mapa", "Carte")}</th>
                <th className="num">{tr("Length", "Duração", "Duración", "Durée")}</th>
                <th className="num">APM</th>
                <th>{tr("Source", "Origem", "Origen", "Origine")}</th>
                <th data-tip={tr("The report's most important finding; hover for the full sentence.", "O problema mais importante da análise; passe o mouse para ver a frase completa.", "El hallazgo más importante del análisis; pasa el cursor para ver la frase completa.", "Le constat le plus important de l'analyse ; survolez pour la phrase complète.")}>{tr("Main problem", "Problema principal", "Problema principal", "Problème principal")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.game_key} className="click" onClick={() => onOpen(g.game_key)}>
                  <td>{dateTime(g.played_at)}</td>
                  <td><Result result={g.result} /></td>
                  <td>
                    <span className="matchup">
                      <RaceIcon race={g.matchup?.[0]} size="small" />
                      <span className="muted small">vs</span>
                      <RaceIcon race={g.opp_race ?? g.matchup?.[2]} size="small" />
                    </span>
                  </td>
                  <td title={g.opp_name ?? ""}>{shortName(g.opp_name)}</td>
                  <td>{g.map_name}</td>
                  <td className="num">{mmss(g.duration_ms)}</td>
                  <td className="num">{g.apm === null ? "—" : Math.round(g.apm)}</td>
                  <td className="muted">{SOURCE[g.source]}</td>
                  <td>
                    {(() => {
                      const top = found.get(g.game_key)?.[0];
                      return top ? <span data-tip={top.headline}>{problemName(top.id)}</span> : <span className="muted">—</span>;
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
