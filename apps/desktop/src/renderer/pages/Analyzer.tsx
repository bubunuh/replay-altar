// The Analyzer page: a replay that isn't yours (a pro game, a friend's, one found online),
// analyzed from one player's side like your own games, kept apart so it never counts in your
// stats.
import { useEffect, useState } from "react";
import { tr } from "@replay-altar/core/i18n";
import { api, type AnalyzedReplay, type PickedReplay } from "../api.ts";
import { dateTime, mmss, RACE, shortName } from "../format.ts";
import { RaceIcon } from "../RaceIcon.tsx";
import { Result } from "./Matches.tsx";
import { MIN_GAME_MS } from "@replay-altar/rules/findings";

const fileName = (path: string) => path.replace(/^.*[\\/]/, "");
const mapName = (file: string) => file.replace(/^.*[\\/]/, "").replace(/^\(\d+\)|\.w3[xm]$/gi, "").replace(/^\d*_?w3c_(s\d+_)?\d+_\d+_/, "").replace(/_/g, " ");
/** "1.31" → 1.31; Reforged replays are 1.32 and later. */
const versionNumber = (v: string | undefined) => (v ? Number.parseFloat(v) : NaN);

/** What could make this analysis wrong or impossible: errors block it, warnings don't. */
function check(r: PickedReplay, players: NonNullable<PickedReplay["players"]>) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (r.error)
    errors.push(
      tr(
        `This file couldn't be read as a Warcraft III replay (${r.error}).`,
        `Este arquivo não pôde ser lido como replay do Warcraft III (${r.error}).`,
        `Este archivo no se pudo leer como replay de Warcraft III (${r.error}).`,
        `Ce fichier n'a pas pu être lu comme un replay de Warcraft III (${r.error}).`,
      ),
    );
  if (!r.error && players.length !== 2)
    errors.push(
      tr(
        `Only 1v1 games against another player can be analyzed; this replay has ${players.length} players.`,
        `Só partidas 1v1 contra outro jogador podem ser analisadas; este replay tem ${players.length} jogadores.`,
        `Solo se pueden analizar partidas 1v1 contra otro jugador; este replay tiene ${players.length} jugadores.`,
        `Seules les parties en 1v1 contre un autre joueur peuvent être analysées ; ce replay compte ${players.length} joueurs.`,
      ),
    );
  if (r.durationMs !== undefined && r.durationMs < MIN_GAME_MS)
    errors.push(tr("The game is too short to analyze (under 3 minutes).", "A partida é curta demais para analisar (menos de 3 minutos).", "La partida es demasiado corta para analizarla (menos de 3 minutos).", "La partie est trop courte pour être analysée (moins de 3 minutes)."));
  const v = versionNumber(r.version);
  if (Number.isFinite(v) && v < 1.32)
    warnings.push(
      tr(
        `This replay is from Warcraft III ${r.version}, before Reforged: it may not be readable, and the simulation may fail.`,
        `Este replay é do Warcraft III ${r.version}, anterior ao Reforged: talvez não possa ser lido, e a simulação pode falhar.`,
        `Este replay es de Warcraft III ${r.version}, anterior a Reforged: puede que no se pueda leer y que la simulación falle.`,
        `Ce replay date de Warcraft III ${r.version}, avant Reforged : il risque de ne pas être lisible, et la simulation peut échouer.`,
      ),
    );
  else if (r.build && r.currentBuild && r.build < r.currentBuild)
    warnings.push(
      tr(
        `This replay is from an older version of the game (${r.version}, build ${r.build}; the current one is build ${r.currentBuild}). The balance may have changed since: costs, the simulation and the comparison with pros use today's numbers, so some may be off.`,
        `Este replay é de uma versão mais antiga do jogo (${r.version}, build ${r.build}; a atual é a build ${r.currentBuild}). O balanceamento pode ter mudado desde então: custos, simulação e comparação com os pros usam os números de hoje, então alguns podem estar errados.`,
        `Este replay es de una versión más antigua del juego (${r.version}, build ${r.build}; la actual es la build ${r.currentBuild}). El balance puede haber cambiado desde entonces: los costes, la simulación y la comparación con los pros usan los números de hoy, así que algunos pueden no ser exactos.`,
        `Ce replay vient d'une version plus ancienne du jeu (${r.version}, build ${r.build} ; l'actuelle est la build ${r.currentBuild}). L'équilibrage a pu changer depuis : les coûts, la simulation et la comparaison avec les pros utilisent les chiffres d'aujourd'hui, donc certains peuvent être faux.`,
      ),
    );
  return { errors, warnings };
}

export function Analyzer({ onOpen }: { onOpen: (key: string) => void }) {
  const [picked, setPicked] = useState<PickedReplay | null>(null);
  const [player, setPlayer] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [list, setList] = useState<AnalyzedReplay[]>([]);
  useEffect(() => {
    api.analyzerList().then(setList);
  }, []);

  const pick = async () => {
    setFailed(null);
    const r = await api.analyzerPick();
    if (!r) return;
    setPicked(r);
    const players = (r.players ?? []).filter((p) => !p.isObserver && !p.isComputer);
    // From your side when you played in it, else the first player.
    const mine = players.find((p) => (r.accounts ?? []).some((a) => a.toLowerCase() === p.name.toLowerCase()));
    setPlayer((mine ?? players[0])?.playerId ?? null);
  };
  const players = (picked?.players ?? []).filter((p) => !p.isObserver && !p.isComputer);
  const { errors, warnings } = picked ? check(picked, players) : { errors: [], warnings: [] };

  const run = async () => {
    const p = players.find((x) => x.playerId === player);
    if (!picked || !p) return;
    setRunning(true);
    setFailed(null);
    const res = await api.analyzerRun(picked.file, { playerId: p.playerId, name: p.name });
    setRunning(false);
    if (!res.ok || !res.key) return setFailed(res.reason);
    setPicked(null);
    api.analyzerList().then(setList);
    onOpen(res.key);
  };

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="card">
        <div className="card-head">
          <h2>{tr("Analyze a replay", "Analisar um replay", "Analizar un replay", "Analyser un replay")}</h2>
          <button className="btn" onClick={pick} disabled={running}>{tr("Choose a replay…", "Escolher um replay…", "Elegir un replay…", "Choisir un replay…")}</button>
        </div>
        <p className="sub">
          {tr(
            "Any 1v1 replay, such as a pro game or one found online, analyzed from the side of the player you choose, the same way as your own games. Analyzed replays are kept here and never count in your stats.",
            "Qualquer replay 1v1, como uma partida de pro ou uma encontrada na internet, analisado do lado do jogador que você escolher, do mesmo jeito que as suas partidas. Os replays analisados ficam aqui e nunca entram nas suas estatísticas.",
            "Cualquier replay 1v1, como una partida de un pro o una encontrada en internet, analizado desde el lado del jugador que elijas, igual que tus propias partidas. Los replays analizados se guardan aquí y nunca cuentan en tus estadísticas.",
            "N'importe quel replay en 1v1, comme une partie de pro ou une partie trouvée en ligne, analysé du côté du joueur que vous choisissez, comme vos propres parties. Les replays analysés restent ici et ne comptent jamais dans vos statistiques.",
          )}
        </p>
        {picked && (
          <div className="analyzer-pick">
            <p style={{ margin: "0 0 6px" }}>
              <b>{fileName(picked.file)}</b>
              {picked.map && (
                <span className="muted small">
                  {" "}
                  · {mapName(picked.map)} · {mmss(picked.durationMs ?? 0)} · Warcraft III {picked.version} ({tr("build", "build", "build", "build")} {picked.build})
                </span>
              )}
            </p>
            {errors.map((e) => (
              <p key={e} className="analyzer-error">{e}</p>
            ))}
            {warnings.map((w) => (
              <p key={w} className="analyzer-warning">⚠ {w}</p>
            ))}
            {!errors.length && (
              <>
                <p className="sub" style={{ margin: "8px 0 4px" }}>{tr("Analyze from the side of:", "Analisar do lado de:", "Analizar desde el lado de:", "Analyser du côté de :")}</p>
                <div className="filters" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                  {players.map((p) => (
                    <label key={p.playerId}>
                      <input type="radio" name="analyzer-player" checked={player === p.playerId} onChange={() => setPlayer(p.playerId)} />
                      <RaceIcon race={p.race ?? undefined} size="small" /> {p.name} <span className="muted small">{RACE[p.race ?? ""] ?? ""}</span>
                    </label>
                  ))}
                </div>
                <div className="filters" style={{ marginTop: 10 }}>
                  <button className="btn" onClick={run} disabled={running || player === null}>
                    {running ? tr("Analyzing…", "Analisando…", "Analizando…", "Analyse…") : tr("Analyze", "Analisar", "Analizar", "Analyser")}
                  </button>
                  {running && <span className="muted small">{tr("Reading and simulating the game, usually under a minute.", "Lendo e simulando a partida, normalmente em menos de um minuto.", "Leyendo y simulando la partida, normalmente en menos de un minuto.", "Lecture et simulation de la partie, en général moins d'une minute.")}</span>}
                </div>
              </>
            )}
            {failed && <p className="analyzer-error">{tr("The analysis failed", "A análise falhou", "El análisis falló", "L'analyse a échoué")}: {failed}</p>}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {list.length === 0 ? (
          <div className="empty">{tr("No replays analyzed yet.", "Nenhum replay analisado ainda.", "Todavía no hay replays analizados.", "Aucun replay analysé pour l'instant.")}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{tr("Played", "Jogada em", "Jugada", "Jouée")}</th>
                <th>{tr("From the side of", "Do lado de", "Desde el lado de", "Du côté de")}</th>
                <th>{tr("Result", "Resultado", "Resultado", "Résultat")}</th>
                <th>{tr("Matchup", "Confronto", "Enfrentamiento", "Matchup")}</th>
                <th>{tr("Opponent", "Oponente", "Rival", "Adversaire")}</th>
                <th>{tr("Map", "Mapa", "Mapa", "Carte")}</th>
                <th className="num">{tr("Length", "Duração", "Duración", "Durée")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="click" onClick={() => onOpen(a.key)} title={a.file}>
                  <td>{dateTime(a.row.played_at)}</td>
                  <td>{shortName(a.player)}</td>
                  <td><Result result={a.row.result} /></td>
                  <td>
                    <RaceIcon race={a.row.matchup?.[0]} size="small" /> <span className="muted small">vs</span> <RaceIcon race={a.row.opp_race ?? a.row.matchup?.[2]} size="small" />
                  </td>
                  <td>{shortName(a.row.opp_name ?? "")}</td>
                  <td>{a.row.map_name}</td>
                  <td className="num">{mmss(a.row.duration_ms)}</td>
                  <td>
                    <button
                      className="btn"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await api.analyzerRemove(a.id);
                        setList(await api.analyzerList());
                      }}
                    >
                      {tr("Remove", "Remover", "Quitar", "Retirer")}
                    </button>
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
