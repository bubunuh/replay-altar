import { useEffect, useState } from "react";
import type { Config, Paths } from "@replay-altar/core/ui";
import { LANGUAGES, language, locale, tr, type Language } from "@replay-altar/core/i18n";
import { setTextScale, TEXT_SCALES, textScale } from "../textSize.ts";
import { api, type AppInfo, type Folders, type MapFolders as MapFolderInfo, type RefGroupInfo, type UpdateState } from "../api.ts";
import { groupLabel } from "../format.ts";
import { openIssue } from "../feedback.ts";

/**
 * Where replays are read from: the folders found by themselves, and the ones you added with the
 * picker. `empty`: shown on an empty match list, as a hint when no folder holds replays.
 */
export function ReplayFolders({ empty = false }: { empty?: boolean }) {
  const [folders, setFolders] = useState<Folders | null>(null);
  useEffect(() => {
    api.folders().then(setFolders);
  }, []);
  if (!folders) return null;
  const add = async () => {
    const next = await api.addFolder();
    if (next) setFolders(next);
  };
  const all = [...folders.found, ...folders.added];
  if (empty && folders.replayDirs > 0) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h2>{empty ? tr("No replays found yet", "Nenhum replay encontrado ainda", "Todavía no se encontraron replays", "Aucun replay trouvé pour l'instant") : tr("Replay folders", "Pastas de replays", "Carpetas de replays", "Dossiers de replays")}</h2>
        <button className="btn" onClick={add}>
          {tr("Choose folder…", "Escolher pasta…", "Elegir carpeta…", "Choisir un dossier…")}
        </button>
      </div>
      <p className="sub">
        {empty
          ? tr(
              "Replay Altar looks for the game's replays in Documents\\Warcraft III\\BattleNet\\<account>\\Replays. If yours are somewhere else, choose the folder: the Warcraft III folder, its BattleNet or Replays folder, or any folder of replays.",
              "O Replay Altar procura os replays do jogo em Documentos\\Warcraft III\\BattleNet\\<conta>\\Replays. Se os seus estão em outro lugar, escolha a pasta: a pasta Warcraft III, a pasta BattleNet ou Replays dentro dela, ou qualquer pasta com replays.",
              "Replay Altar busca los replays del juego en Documents\\Warcraft III\\BattleNet\\<cuenta>\\Replays. Si los tuyos están en otro sitio, elige la carpeta: la de Warcraft III, su carpeta BattleNet o Replays, o cualquier carpeta con replays.",
              "Replay Altar cherche les replays du jeu dans Documents\\Warcraft III\\BattleNet\\<compte>\\Replays. Si les vôtres sont ailleurs, choisissez le dossier : celui de Warcraft III, son dossier BattleNet ou Replays, ou n'importe quel dossier de replays.",
            )
          : tr(
              "New replays in these folders are imported as soon as a game ends. Found automatically: the game's own Documents folder (including OneDrive). Add another if yours is elsewhere.",
              "Replays novos nestas pastas são importados assim que a partida acaba. Encontradas automaticamente: a pasta Documentos do jogo (inclusive no OneDrive). Adicione outra se a sua estiver em outro lugar.",
              "Los replays nuevos de estas carpetas se importan en cuanto termina una partida. Encontradas automáticamente: la carpeta Documentos del propio juego (OneDrive incluido). Añade otra si los tuyos están en otro sitio.",
              "Les nouveaux replays de ces dossiers sont importés dès la fin d'une partie. Trouvés automatiquement : le dossier Documents du jeu (OneDrive compris). Ajoutez-en un autre si les vôtres sont ailleurs.",
            )}
      </p>
      {all.length > 0 && (
        <table>
          <tbody>
            {folders.found.map((d) => (
              <tr key={d}>
                <td><code>{d}</code></td>
                <td className="muted small">{tr("found automatically", "encontrada automaticamente", "encontrada automáticamente", "trouvé automatiquement")}</td>
                <td><button className="btn" onClick={() => api.openPath(d)}>{tr("Open", "Abrir", "Abrir", "Ouvrir")}</button></td>
              </tr>
            ))}
            {folders.added.map((d) => (
              <tr key={d}>
                <td><code>{d}</code></td>
                <td className="muted small">{tr("added by you", "adicionada por você", "añadida por ti", "ajouté par vous")}</td>
                <td>
                  <button className="btn" onClick={async () => setFolders(await api.removeFolder(d))}>{tr("Remove", "Remover", "Quitar", "Retirer")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {all.length === 0 && <p className="sub">{tr("No Warcraft III folder found on this computer.", "Nenhuma pasta do Warcraft III encontrada neste computador.", "No se encontró ninguna carpeta de Warcraft III en este equipo.", "Aucun dossier Warcraft III trouvé sur cet ordinateur.")}</p>}
    </div>
  );
}

/**
 * Where the simulation finds each game's map: every Warcraft III folder's Maps folder, and the
 * ones you added. Extracted maps are kept in the data folder (an update doesn't lose them).
 */
function MapFolders() {
  const [info, setInfo] = useState<MapFolderInfo | null>(null);
  useEffect(() => {
    api.mapFolders().then(setInfo);
  }, []);
  if (!info) return null;
  const add = async () => {
    const next = await api.addMapFolder();
    if (next) setInfo(next);
  };
  return (
    <div className="card">
      <div className="card-head">
        <h2>{tr("Map folders", "Pastas de mapas", "Carpetas de mapas", "Dossiers de cartes")}</h2>
        <button className="btn" onClick={add}>{tr("Choose folder…", "Escolher pasta…", "Elegir carpeta…", "Choisir un dossier…")}</button>
      </div>
      <p className="sub">
        {tr(
          "To simulate a game, Replay Altar reads its map from your own copy, the first time a game on that map is simulated: Battle.net ladder maps are in Documents\\Warcraft III\\Maps\\Download, W3Champions maps in Maps\\W3Champions; the maps that come with the game are read from the game itself. Add another folder if your maps are elsewhere. Replay Altar ships no maps.",
          "Para simular uma partida, o Replay Altar lê o mapa da sua própria cópia, na primeira vez que uma partida naquele mapa é simulada: os mapas da ladder do Battle.net ficam em Documentos\\Warcraft III\\Maps\\Download, os do W3Champions em Maps\\W3Champions; os mapas que vêm com o jogo são lidos do próprio jogo. Adicione outra pasta se os seus mapas estiverem em outro lugar. O Replay Altar não distribui nenhum mapa.",
          "Para simular una partida, Replay Altar lee su mapa de tu propia copia, la primera vez que se simula una partida en ese mapa: los mapas de la ladder de Battle.net están en Documents\\Warcraft III\\Maps\\Download, los de W3Champions en Maps\\W3Champions; los mapas que vienen con el juego se leen del propio juego. Añade otra carpeta si tus mapas están en otro sitio. Replay Altar no distribuye ningún mapa.",
          "Pour simuler une partie, Replay Altar lit sa carte dans votre propre copie, la première fois qu'une partie sur cette carte est simulée : les cartes du ladder Battle.net sont dans Documents\\Warcraft III\\Maps\\Download, celles de W3Champions dans Maps\\W3Champions ; les cartes fournies avec le jeu sont lues dans le jeu lui-même. Ajoutez un autre dossier si vos cartes sont ailleurs. Replay Altar ne distribue aucune carte.",
        )}
      </p>
      <table>
        <tbody>
          {info.found.map((d) => (
            <tr key={d}>
              <td><code>{d}</code></td>
              <td className="muted small">{tr("found automatically", "encontrada automaticamente", "encontrada automáticamente", "trouvé automatiquement")}</td>
              <td><button className="btn" onClick={() => api.openPath(d)}>{tr("Open", "Abrir", "Abrir", "Ouvrir")}</button></td>
            </tr>
          ))}
          {info.added.map((d) => (
            <tr key={d}>
              <td><code>{d}</code></td>
              <td className="muted small">{tr("added by you", "adicionada por você", "añadida por ti", "ajouté par vous")}</td>
              <td><button className="btn" onClick={async () => setInfo(await api.removeMapFolder(d))}>{tr("Remove", "Remover", "Quitar", "Retirer")}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sub" style={{ marginTop: 10 }}>
        {info.found.length + info.added.length === 0
          ? tr("No map folder found on this computer.", "Nenhuma pasta de mapas encontrada neste computador.", "No se encontró ninguna carpeta de mapas en este equipo.", "Aucun dossier de cartes trouvé sur cet ordinateur.")
          : tr(`${info.maps} maps in these folders.`, `${info.maps} mapas nestas pastas.`, `${info.maps} mapas en estas carpetas.`, `${info.maps} cartes dans ces dossiers.`)}{" "}
        {tr(`Maps prepared for the simulation so far: ${info.saved}, kept in`, `Mapas preparados para a simulação até agora: ${info.saved}, guardados em`, `Mapas preparados para la simulación hasta ahora: ${info.saved}, guardados en`, `Cartes préparées pour la simulation jusqu'ici : ${info.saved}, conservées dans`)}{" "}
        <code>{info.savedDir}</code>.
      </p>
    </div>
  );
}

/** The pro statistics shipped with this version: what your numbers are compared with. */
function ProGames({ refs }: { refs: RefGroupInfo[] }) {
  return (
    <div className="card">
      <h2>{tr("Pro games", "Partidas de pros", "Partidas de pros", "Parties de pros")}</h2>
      <p className="sub">
        {tr(
          "The games your numbers are compared with: tournament games of each race from warcraft3.info: recent pro games on the current patch, plus tournament games from 2022 on (older patches, players from semi-pro to the very top), all analyzed the same way as yours. The Replay Altar maintainers collect them and ship only the statistics, updated with new versions of Replay Altar.",
          "As partidas com que os seus números são comparados: partidas de torneios de cada raça do warcraft3.info: partidas recentes de pros no patch atual, mais partidas de torneio desde 2022 (patches anteriores, jogadores de semi-pros ao topo), todas analisadas do mesmo jeito que as suas. Os mantenedores do Replay Altar coletam essas partidas e distribuem só as estatísticas, atualizadas a cada nova versão do Replay Altar.",
          "Las partidas con las que se comparan tus números: partidas de torneos de cada raza de warcraft3.info: partidas recientes de pros en el parche actual, más partidas de torneo desde 2022 (parches anteriores, jugadores desde semi-pros hasta lo más alto), todas analizadas igual que las tuyas. Los mantenedores de Replay Altar las recopilan y solo distribuyen las estadísticas, actualizadas con cada nueva versión de Replay Altar.",
          "Les parties auxquelles vos chiffres sont comparés : des parties de tournois pour chaque race, de warcraft3.info : des parties récentes de pros sur le patch actuel, plus des parties de tournoi depuis 2022 (patchs antérieurs, joueurs du semi-pro au plus haut niveau), toutes analysées de la même façon que les vôtres. Les mainteneurs de Replay Altar les rassemblent et ne distribuent que les statistiques, mises à jour avec chaque nouvelle version de Replay Altar.",
        )}
      </p>
      <table>
        <tbody>
          {refs.map((r) => (
            <tr key={r.group.id}>
              <td>{groupLabel(r.group)}</td>
              <td className="small">
                {r.profile
                  ? tr(`${r.profile.games} games`, `${r.profile.games} partidas`, `${r.profile.games} partidas`, `${r.profile.games} parties`) +
                    ` (${Object.entries(r.profile.matchups).filter(([k]) => k !== "all").map(([k, v]) => `${k} ${v.n}`).join(", ")})` +
                    (r.profile.pooled
                      ? ` · ${(({ games, sourceGames: n, years }) => {
                          const y = years ? ` ${years[0]}–${years[1]}` : "";
                          return tr(`${games} of them from ${n} tournament games${y} (older patches too)`, `${games} delas de ${n} partidas de torneio${y} (patches anteriores também)`, `${games} de ellas de ${n} partidas de torneo${y} (también parches anteriores)`, `dont ${games} issues de ${n} parties de tournoi${y} (patchs antérieurs aussi)`);
                        })(r.profile.pooled)}`
                      : r.profile.replayBuild ? ` · ${tr("game build", "build do jogo", "build del juego", "build du jeu")} ${r.profile.replayBuild}` : "") +
                    ` · ${tr("updated", "atualizado em", "actualizado", "mis à jour le")} ${new Date(r.profile.builtAt).toLocaleDateString(locale())}`
                  : tr("not included in this version", "não incluídas nesta versão", "no incluidas en esta versión", "non incluses dans cette version")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


/** Release notes as plain text: GitHub's Markdown without its marks (never rendered as HTML). */
const plainNotes = (md: string) => md.replace(/\r/g, "").replace(/\*\*|`/g, "").replace(/^#+\s*/gm, "").trim();

/** This version, and the newer one when there is one: what's new, and the Update button. */
function Version({ update }: { update: UpdateState | null }) {
  const [notes, setNotes] = useState(false);
  const [checking, setChecking] = useState(false);
  if (!update) return null;
  const latest = update.latest;
  const check = async () => {
    setChecking(true);
    await api.checkUpdate();
    setChecking(false);
  };
  return (
    <div className="card">
      <div className="card-head">
        <h2>Replay Altar {update.current}</h2>
        <button className="btn" disabled={checking} onClick={check}>{checking ? tr("Checking…", "Verificando…", "Comprobando…", "Vérification…") : tr("Check for updates", "Procurar atualizações", "Buscar actualizaciones", "Rechercher des mises à jour")}</button>
      </div>
      {!latest ? (
        <p className="sub">
          {update.checkedAt
            ? tr(`You have the latest version (checked ${new Date(update.checkedAt).toLocaleString(locale())}).`, `Você tem a versão mais recente (verificado em ${new Date(update.checkedAt).toLocaleString(locale())}).`, `Tienes la última versión (comprobado el ${new Date(update.checkedAt).toLocaleString(locale())}).`, `Vous avez la dernière version (vérifié le ${new Date(update.checkedAt).toLocaleString(locale())}).`)
            : update.error
              ? tr(`Could not check for updates: ${update.error}.`, `Não foi possível procurar atualizações: ${update.error}.`, `No se pudieron buscar actualizaciones: ${update.error}.`, `Impossible de rechercher les mises à jour : ${update.error}.`)
              : tr("Not checked yet.", "Ainda não verificado.", "Todavía sin comprobar.", "Pas encore vérifié.")}
        </p>
      ) : (
        <>
          <p>
            <span className="tab-alert" style={{ marginLeft: 0, marginRight: 8 }}>!</span>
            {tr(`Replay Altar ${latest.version} is available.`, `O Replay Altar ${latest.version} está disponível.`, `Replay Altar ${latest.version} está disponible.`, `Replay Altar ${latest.version} est disponible.`)}{" "}
            <span className="muted small">{tr("Updating is optional; your games and settings are kept.", "Atualizar é opcional; as suas partidas e configurações são mantidas.", "Actualizar es opcional; tus partidas y tu configuración se conservan.", "La mise à jour est facultative ; vos parties et vos paramètres sont conservés.")}</span>
          </p>
          <div className="filters">
            <button className="btn" onClick={() => setNotes(!notes)}>{tr("What's new", "O que há de novo", "Novedades", "Nouveautés")}</button>
            {update.installable && update.download === "idle" && <button className="btn" onClick={() => api.downloadUpdate()}>{tr("Update", "Atualizar", "Actualizar", "Mettre à jour")}</button>}
            {update.installable && update.download === "failed" && <button className="btn" onClick={() => api.downloadUpdate()}>{tr("Try again", "Tentar de novo", "Reintentar", "Réessayer")}</button>}
            {update.download === "ready" && <button className="btn" onClick={() => api.installUpdate()}>{tr("Restart and install", "Reiniciar e instalar", "Reiniciar e instalar", "Redémarrer et installer")}</button>}
          </div>
          {update.download === "downloading" && (
            <div style={{ marginTop: 10 }}>
              <div className="progress"><div style={{ width: `${update.percent}%` }} /></div>
              <p className="sub">{tr(`Downloading… ${update.percent}%`, `Baixando… ${update.percent}%`, `Descargando… ${update.percent}%`, `Téléchargement… ${update.percent} %`)}</p>
            </div>
          )}
          {update.download === "failed" && <p className="sub">{tr(`The download failed: ${update.error}.`, `O download falhou: ${update.error}.`, `La descarga falló: ${update.error}.`, `Le téléchargement a échoué : ${update.error}.`)}</p>}
          {!update.installable && (
            <p className="sub">
              {tr("This copy runs from the project folder: update it with", "Esta cópia roda da pasta do projeto: atualize com", "Esta copia se ejecuta desde la carpeta del proyecto: actualízala con", "Cette copie s'exécute depuis le dossier du projet : mettez-la à jour avec")} <code>git pull</code>, <code>npm install</code> {tr("and", "e", "y", "et")} <code>npm run build</code>.
            </p>
          )}
          {notes && (
            <>
              <div className="notes">{plainNotes(latest.notes) || tr("No notes for this version.", "Esta versão não tem notas.", "Esta versión no tiene notas.", "Pas de notes pour cette version.")}</div>
              <p className="sub"><a href="#" onClick={(e) => { e.preventDefault(); api.openUrl(latest.url); }}>{tr("This release on GitHub", "Esta versão no GitHub", "Esta versión en GitHub", "Cette version sur GitHub")}</a></p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Problems and ideas go to the project's GitHub issues, with the version and system filled in. */
function Help({ info }: { info: AppInfo | null }) {
  if (!info) return null;
  const open = (template: "bug.yml" | "idea.yml") => openIssue(template);
  return (
    <div className="card">
      <h2>{tr("Help and feedback", "Ajuda e sugestões", "Ayuda y sugerencias", "Aide et suggestions")}</h2>
      <p className="sub">
        {tr(
          "Problems and ideas are collected on the project's GitHub page (a free GitHub account is needed to write there). The version and system are filled in for you.",
          "Problemas e ideias ficam na página do projeto no GitHub (é preciso uma conta gratuita do GitHub para escrever lá). A versão e o sistema já vêm preenchidos.",
          "Los problemas y las ideas se reúnen en la página del proyecto en GitHub (hace falta una cuenta gratuita de GitHub para escribir allí). La versión y el sistema se rellenan por ti.",
          "Les problèmes et les idées sont rassemblés sur la page GitHub du projet (il faut un compte GitHub gratuit pour y écrire). La version et le système sont remplis pour vous.",
        )}
        {info.logDir && " " + tr("For a problem, please attach the collector's log, collector.log.", "Para um problema, anexe o registro do coletor, collector.log.", "Si es un problema, adjunta el registro del recolector, collector.log.", "Pour un problème, joignez le journal du collecteur, collector.log.")}
      </p>
      <div className="filters">
        <button className="btn" onClick={() => open("bug.yml")}>{tr("Report a problem", "Relatar um problema", "Informar de un problema", "Signaler un problème")}</button>
        <button className="btn" onClick={() => open("idea.yml")}>{tr("Suggest an idea", "Sugerir uma ideia", "Sugerir una idea", "Proposer une idée")}</button>
        {info.logDir && <button className="btn" onClick={() => api.openPath(info.logDir!)}>{tr("Open the log folder", "Abrir a pasta do registro", "Abrir la carpeta del registro", "Ouvrir le dossier du journal")}</button>}
      </div>
    </div>
  );
}

export function Settings({ refs, update }: { refs: RefGroupInfo[]; update: UpdateState | null }) {
  const [state, setState] = useState<{ config: Config; configPath: string; paths: Paths } | null>(null);
  const [accounts, setAccounts] = useState("");
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState("…");
  const [scale, setScale] = useState(textScale);
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    api.appInfo().then(setInfo);
    api.getConfig().then((s) => {
      setState(s);
      setAccounts(s.config.accounts.join(", "));
    });
    api.collectorStatus().then(setStatus);
  }, []);
  if (!state) return null;
  const { paths } = state;
  // Folders are saved by the picker in the main process: keep them as they are on disk.
  const save = async (change: Partial<Config>) => {
    const fresh = await api.getConfig();
    const next = { ...fresh.config, ...change };
    await api.setConfig(next);
    setState({ ...state, config: next });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const config = state.config;
  const setLanguage = async (l: Language) => {
    await save({ language: l });
    window.location.reload();
  };
  const setTheme = async (theme: "system" | "light" | "dark") => {
    await save({ theme });
    window.location.reload();
  };

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <Version update={update} />
      <div className="card">
        <h2>{tr("You", "Você", "Tú", "Vous")}</h2>
        <p className="sub">
          {tr(
            'Your battletags, comma separated, exactly as in the game (name#1234). Games where none of them played are kept as "observed". After you save, your games are sorted again.',
            'Suas battletags, separadas por vírgula, exatamente como no jogo (nome#1234). Partidas em que nenhuma delas jogou ficam como "assistidas". Depois de salvar, as suas partidas são separadas de novo.',
            'Tus battletags, separadas por comas, exactamente como en el juego (nombre#1234). Las partidas en las que no jugó ninguna se guardan como "observadas". Al guardar, tus partidas se ordenan de nuevo.',
            "Vos battletags, séparés par des virgules, exactement comme dans le jeu (nom#1234). Les parties où aucun d'eux n'a joué sont gardées comme « observées ». Après l'enregistrement, vos parties sont triées à nouveau.",
          )}
        </p>
        <div className="filters">
          <input type="text" style={{ flex: 1 }} value={accounts} onChange={(e) => setAccounts(e.target.value)} />
          <button className="btn" onClick={() => save({ accounts: accounts.split(",").map((a) => a.trim()).filter(Boolean) })}>{tr("Save", "Salvar", "Guardar", "Enregistrer")}</button>
          {saved && <span className="muted small">{tr("Saved", "Salvo", "Guardado", "Enregistré")}</span>}
        </div>
      </div>
      <div className="card">
        <h2>{tr("Display", "Exibição", "Pantalla", "Affichage")}</h2>
        <div className="filters">
          <label>
            {tr("Language", "Idioma", "Idioma", "Langue")}
            <select value={language()} onChange={(e) => setLanguage(e.target.value as Language)}>
              {LANGUAGES.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </label>
          <label>
            {tr("Theme", "Tema", "Tema", "Thème")}
            <select value={config.theme ?? "system"} onChange={(e) => setTheme(e.target.value as "system" | "light" | "dark")}>
              <option value="system">{tr("Same as the system", "Igual ao sistema", "Igual que el sistema", "Comme le système")}</option>
              <option value="light">{tr("Light", "Claro", "Claro", "Clair")}</option>
              <option value="dark">{tr("Dark", "Escuro", "Oscuro", "Sombre")}</option>
            </select>
          </label>
          <label>
            {tr("Text size", "Tamanho do texto", "Tamaño del texto", "Taille du texte")}
            <select value={scale} onChange={(e) => { const v = Number(e.target.value); setTextScale(v); setScale(v); }}>
              {TEXT_SCALES.map((v) => (
                <option key={v} value={v}>{Math.round(v * 100)}%</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <ReplayFolders />
      <MapFolders />
      <div className="card">
        <h2>{tr("Behaviour", "Comportamento", "Comportamiento", "Comportement")}</h2>
        <p className="sub">{tr("Collector", "Coletor", "Recolector", "Collecteur")}: <b>{collectorStatus(status)}</b>. {tr("Changes restart it.", "Mudanças reiniciam o coletor.", "Los cambios lo reinician.", "Les changements le redémarrent.")}</p>
        <div className="filters" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          <label><input type="checkbox" checked={config.openWindowOnGameStart} onChange={(e) => save({ openWindowOnGameStart: e.target.checked })} />{tr("Open this window (without taking focus) when Warcraft III starts", "Abrir esta janela (sem tirar o foco) quando o Warcraft III abrir", "Abrir esta ventana (sin quitar el foco) cuando se inicia Warcraft III", "Ouvrir cette fenêtre (sans prendre le focus) au lancement de Warcraft III")}</label>
          <label><input type="checkbox" checked={config.notifyAfterGame} onChange={(e) => save({ notifyAfterGame: e.target.checked })} />{tr("Notify me after each analyzed game", "Me avisar depois de cada partida analisada", "Avisarme después de cada partida analizada", "Me notifier après chaque partie analysée")}</label>
          <label><input type="checkbox" checked={config.fetchOfficialStats !== false} onChange={(e) => save({ fetchOfficialStats: e.target.checked })} />{tr("After each W3Champions game, fetch its end-of-game statistics from W3Champions (sends both battletags to W3Champions)", "Depois de cada partida do W3Champions, buscar as estatísticas de fim de partida no W3Champions (envia as duas battletags ao W3Champions)", "Después de cada partida de W3Champions, obtener sus estadísticas de final de partida de W3Champions (envía las dos battletags a W3Champions)", "Après chaque partie W3Champions, récupérer ses statistiques de fin de partie auprès de W3Champions (envoie les deux battletags à W3Champions)")}</label>
          <label><input type="checkbox" checked={config.checkUpdates !== false} onChange={(e) => save({ checkUpdates: e.target.checked })} />{tr("Check once a day whether a new version is out (asks GitHub; nothing about you is sent)", "Verificar uma vez por dia se saiu uma versão nova (pergunta ao GitHub; nada sobre você é enviado)", "Comprobar una vez al día si hay una versión nueva (pregunta a GitHub; no se envía nada sobre ti)", "Vérifier une fois par jour si une nouvelle version est sortie (interroge GitHub ; rien vous concernant n'est envoyé)")}</label>
        </div>
      </div>
      <ProGames refs={refs} />
      <Help info={info} />
      <div className="card">
        <h2>{tr("Where things live", "Onde ficam as coisas", "Dónde están las cosas", "Où se trouvent les choses")}</h2>
        <table>
          <tbody>
            <tr><td>{tr("Archived replays", "Replays arquivados", "Replays archivados", "Replays archivés")}</td><td><code>{paths.archive}</code></td><td><button className="btn" onClick={() => api.openPath(paths.archive)}>{tr("Open", "Abrir", "Abrir", "Ouvrir")}</button></td></tr>
            <tr><td>{tr("Game records (JSON)", "Registros das partidas (JSON)", "Registros de las partidas (JSON)", "Fiches des parties (JSON)")}</td><td><code>{paths.games}</code></td><td><button className="btn" onClick={() => api.openPath(paths.games)}>{tr("Open", "Abrir", "Abrir", "Ouvrir")}</button></td></tr>
            <tr><td>{tr("Database", "Banco de dados", "Base de datos", "Base de données")}</td><td><code>{paths.db}</code></td><td /></tr>
            <tr><td>{tr("Settings file", "Arquivo de configurações", "Archivo de configuración", "Fichier des paramètres")}</td><td><code>{state.configPath}</code></td><td /></tr>
          </tbody>
        </table>
        <p className="sub" style={{ marginTop: 12 }}>
          {tr("Pause", "Pausar", "Pausar", "Pause")}: <code>replay-altar suspend</code> · {tr("resume", "retomar", "reanudar", "reprendre")}: <code>replay-altar resume</code> · {tr("remove", "remover", "quitar", "désinstaller")}: <code>replay-altar uninstall</code> ({tr("add", "adicione", "añade", "ajoutez")} <code>--purge</code> {tr("to also delete your archive and stats", "para apagar também o seu arquivo e estatísticas", "para borrar también tu archivo y tus estadísticas", "pour supprimer aussi votre archive et vos statistiques")}).
        </p>
      </div>
    </div>
  );
}

/** The collector's state in words ("active" and the like come from systemd or service.ts). */
const collectorStatus = (s: string) =>
  ({ active: tr("active", "rodando", "activo", "actif"), inactive: tr("inactive", "parado", "inactivo", "inactif"), "not installed": tr("not installed", "não instalado", "no instalado", "non installé") })[s] ?? s;
