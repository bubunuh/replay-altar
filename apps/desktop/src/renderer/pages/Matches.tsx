import { useEffect, useMemo, useState } from "react";
import { api, type GameFindings } from "../api.ts";
import type { GameRow } from "@replay-altar/core/ui";
import { dateTime, mmss, problemName, RACE, shortName, SOURCE } from "../format.ts";
import { RaceIcon } from "../RaceIcon.tsx";
import { locale, tr } from "@replay-altar/core/i18n";
import { ReplayFolders } from "./Other.tsx";
import { changeList, NO_FILTER, pageOf, type ListState } from "../paging.ts";

export function Result({ result }: { result: string }) {
  return <span className={`result ${result}`}>{result === "win" ? tr("Win", "Vitória", "Victoria", "Victoire") : result === "loss" ? tr("Loss", "Derrota", "Derrota", "Défaite") : tr("Unknown", "Desconhecido", "Desconocido", "Inconnu")}</span>;
}

// The filters and the page, kept while a game's report is open: the list is made again on the way back.
let kept: ListState = NO_FILTER;

export function Matches({ games, onOpen }: { games: GameRow[]; onOpen: (key: string) => void }) {
  const [list, setList] = useState(kept);
  const change = (c: Partial<ListState>) => setList((before) => (kept = changeList(before, c)));
  const { source, result, oppRace, q, problem, page } = list;
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
  // Newest first (the list comes sorted), PAGE_SIZE at a time; the filters and counts take every game.
  const shown = pageOf(rows, page);
  const pager = (bottom: boolean) => (
    <Pager
      at={shown}
      total={rows.length}
      onPage={(n) => {
        change({ page: n });
        if (bottom) document.querySelector("main")?.scrollTo(0, 0);
      }}
    />
  );

  return (
    <div className="page">
      <div className="filters">
        <label>
          {tr("Source", "Origem", "Origen", "Origine")}
          <select value={source} onChange={(e) => change({ source: e.target.value })}>
            <option value="all">{tr("All", "Todas", "Todos", "Toutes")}</option>
            {Object.entries(SOURCE).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          {tr("Result", "Resultado", "Resultado", "Résultat")}
          <select value={result} onChange={(e) => change({ result: e.target.value })}>
            <option value="all">{tr("All", "Todos", "Todos", "Toutes")}</option>
            <option value="win">{tr("Wins", "Vitórias", "Victorias", "Victoires")}</option>
            <option value="loss">{tr("Losses", "Derrotas", "Derrotas", "Défaites")}</option>
          </select>
        </label>
        <label>
          {tr("Opponent race", "Raça do oponente", "Raza del rival", "Race de l'adversaire")}
          <select value={oppRace} onChange={(e) => change({ oppRace: e.target.value })}>
            <option value="all">{tr("All", "Todas", "Todos", "Toutes")}</option>
            {["H", "O", "U", "N"].map((r) => (
              <option key={r} value={r}>{RACE[r]}</option>
            ))}
          </select>
        </label>
        <label>
          {tr("Problem", "Problema", "Problema", "Problème")}
          <select value={problem} onChange={(e) => change({ problem: e.target.value })}>
            <option value="all">{tr("All", "Todos", "Todos", "Toutes")}</option>
            {problems.map((id) => (
              <option key={id} value={id}>{problemName(id)}</option>
            ))}
          </select>
        </label>
        <input type="text" placeholder={tr("Search opponent, map, label", "Buscar oponente, mapa, nome", "Buscar rival, mapa, etiqueta", "Chercher adversaire, carte, étiquette")} value={q} onChange={(e) => change({ q: e.target.value })} />
        <span className="muted small">{tr(`${rows.length} games`, `${rows.length} partidas`, `${rows.length} partidas`, `${rows.length} parties`)}</span>
      </div>
      {games.length === 0 && <ReplayFolders empty />}
      {/* Nothing imported yet (a first start): the offer to import comes first. */}
      {games.length === 0 && <ImportMore games={games} />}
      {pager(false)}
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
              {shown.rows.map((g) => (
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
      {pager(true)}
      {games.length > 0 && <ImportMore games={games} />}
    </div>
  );
}

/** Page controls: first, newer, "page 2 of 51 · games 101–200 of 5,016", older, last. Hidden for one page. */
function Pager({ at, total, onPage }: { at: ReturnType<typeof pageOf>; total: number; onPage: (page: number) => void }) {
  if (at.pages <= 1) return null;
  const first = at.page === 0;
  const last = at.page === at.pages - 1;
  const from = (at.from + 1).toLocaleString(locale());
  const to = (at.from + at.rows.length).toLocaleString(locale());
  const of = total.toLocaleString(locale());
  return (
    <div className="pager">
      <button className="btn" disabled={first} onClick={() => onPage(0)} title={tr("Newest games", "Partidas mais recentes", "Partidas más recientes", "Parties les plus récentes")}>
        «
      </button>
      <button className="btn" disabled={first} onClick={() => onPage(at.page - 1)}>
        ‹ {tr("Newer", "Mais recentes", "Más recientes", "Plus récentes")}
      </button>
      <span className="muted small">
        {tr(`Page ${at.page + 1} of ${at.pages}`, `Página ${at.page + 1} de ${at.pages}`, `Página ${at.page + 1} de ${at.pages}`, `Page ${at.page + 1} sur ${at.pages}`)} ·{" "}
        {tr(`games ${from}–${to} of ${of}`, `partidas ${from}–${to} de ${of}`, `partidas ${from}–${to} de ${of}`, `parties ${from} à ${to} sur ${of}`)}
      </span>
      <button className="btn" disabled={last} onClick={() => onPage(at.page + 1)}>
        {tr("Older", "Mais antigas", "Más antiguas", "Plus anciennes")} ›
      </button>
      <button className="btn" disabled={last} onClick={() => onPage(at.pages - 1)} title={tr("Oldest games", "Partidas mais antigas", "Partidas más antiguas", "Parties les plus anciennes")}>
        »
      </button>
    </div>
  );
}

/**
 * Replays that were in your folders (or Replay Altar's archive) before the first start and aren't
 * imported yet: nothing is imported until you ask (a folder with thousands of replays took ages
 * and kept the window busy, and not everyone wants their old games). New games are imported by
 * themselves. After an update that reads games differently the list starts over the same way
 * (`startedOver`, core analysis.ts).
 */
function ImportMore({ games }: { games: GameRow[] }) {
  const [scan, setScan] = useState<{ found: number; older: number; asked: boolean; startedOver: boolean } | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    api.replaysScan().then((s) => {
      setScan(s);
      setAsked(false);
    });
  }, [games]);
  if (!scan?.older) return null;
  const more = async (all: boolean) => {
    setAsked(true);
    await api.importMore(all);
  };
  return (
    <div className="import-more">
      <p className="sub">
        {!scan.asked && scan.startedOver
          ? tr(
              "This version of Replay Altar reads your games in a new way, so the match list starts over: import your replays again to see them with the new analysis.",
              "Esta versão do Replay Altar lê as suas partidas de um jeito novo, então a lista de partidas recomeça: importe os seus replays de novo para vê-los com a nova análise.",
              "Esta versión de Replay Altar lee tus partidas de una forma nueva, así que la lista de partidas empieza de nuevo: vuelve a importar tus replays para verlos con el nuevo análisis.",
              "Cette version de Replay Altar lit vos parties d'une nouvelle façon, la liste des parties repart donc de zéro : importez à nouveau vos replays pour les voir avec la nouvelle analyse.",
            ) +
            " " +
            (scan.older === 1
              ? tr("1 replay found, counting the copies Replay Altar keeps.", "1 replay encontrado, contando as cópias que o Replay Altar guarda.", "1 replay encontrado, contando las copias que guarda Replay Altar.", "1 replay trouvé, en comptant les copies que garde Replay Altar.")
              : tr(`${scan.older} replays found, counting the copies Replay Altar keeps.`, `${scan.older} replays encontrados, contando as cópias que o Replay Altar guarda.`, `${scan.older} replays encontrados, contando las copias que guarda Replay Altar.`, `${scan.older} replays trouvés, en comptant les copies que garde Replay Altar.`)) +
            " " +
            tr("The games you play from now on are added by themselves.", "As partidas que você jogar a partir de agora entram sozinhas.", "Las partidas que juegues a partir de ahora se añaden solas.", "Les parties que vous jouerez désormais s'ajoutent toutes seules.")
          : !scan.asked
          ? (scan.older === 1
              ? tr("1 replay found in your folders.", "1 replay encontrado nas suas pastas.", "1 replay encontrado en tus carpetas.", "1 replay trouvé dans vos dossiers.")
              : tr(`${scan.older} replays found in your folders.`, `${scan.older} replays encontrados nas suas pastas.`, `${scan.older} replays encontrados en tus carpetas.`, `${scan.older} replays trouvés dans vos dossiers.`)) +
            " " +
            tr(
              "Nothing is imported until you ask. The games you play from now on are added by themselves.",
              "Nada é importado até você pedir. As partidas que você jogar a partir de agora entram sozinhas.",
              "No se importa nada hasta que lo pidas. Las partidas que juegues a partir de ahora se añaden solas.",
              "Rien n'est importé tant que vous ne le demandez pas. Les parties que vous jouerez désormais s'ajoutent toutes seules.",
            )
          : scan.older === 1
            ? tr("1 older replay in your folders isn't imported yet.", "1 replay mais antigo nas suas pastas ainda não foi importado.", "1 replay más antiguo de tus carpetas aún no se ha importado.", "1 replay plus ancien de vos dossiers n'est pas encore importé.")
            : tr(`${scan.older} older replays in your folders aren't imported yet.`, `${scan.older} replays mais antigos nas suas pastas ainda não foram importados.`, `${scan.older} replays más antiguos de tus carpetas aún no se han importado.`, `${scan.older} replays plus anciens de vos dossiers ne sont pas encore importés.`)}
      </p>
      <div className="filters">
        {scan.older > 50 && (
          <button className="btn" disabled={asked} onClick={() => more(false)}>
            {scan.asked
              ? tr("Import 50 more replays", "Importar mais 50 replays", "Importar 50 replays más", "Importer 50 replays de plus")
              : tr("Import 50 replays", "Importar 50 replays", "Importar 50 replays", "Importer 50 replays")}
          </button>
        )}
        <button className="btn" disabled={asked} onClick={() => more(true)}>
          {tr(`Import all replays (${scan.older})`, `Importar todos os replays (${scan.older})`, `Importar todos los replays (${scan.older})`, `Importer tous les replays (${scan.older})`)}
        </button>
        {asked && <span className="muted small">{tr("Importing… the list fills in as they're read.", "Importando… a lista se completa conforme eles são lidos.", "Importando… la lista se completa a medida que se leen.", "Importation… la liste se remplit au fur et à mesure.")}</span>}
      </div>
    </div>
  );
}
