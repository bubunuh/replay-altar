import { useEffect, useState } from "react";
import type { Config, GameRow, Paths } from "@replay-altar/core/ui";
import { LANGUAGES, language, locale, tr, type Language } from "@replay-altar/core/i18n";
import { setTextScale, TEXT_SCALES, textScale } from "../textSize.ts";
import { api, type Folders, type RefGroupInfo } from "../api.ts";
import { dateTime, groupLabel, mmss, SKIP, SOURCE } from "../format.ts";

export function Skipped({ games, onOpen }: { games: GameRow[]; onOpen: (key: string) => void }) {
  const rows = games.filter((g) => g.analyzed === 0);
  return (
    <div className="page">
      <p className="muted" style={{ margin: 0 }}>
        {tr(
          "Archived but not counted in your stats: custom maps, games against computers, team games, and games you only observed.",
          "Arquivadas, mas fora das suas estatísticas: mapas customizados, partidas contra o computador, partidas em equipe e partidas que você só assistiu.",
        )}
      </p>
      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty">{tr("Nothing skipped.", "Nada ignorado.")}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{tr("Played", "Jogada em")}</th>
                <th>{tr("Why skipped", "Por que ignorada")}</th>
                <th>{tr("Kind", "Tipo")}</th>
                <th>{tr("Map", "Mapa")}</th>
                <th className="num">{tr("Length", "Duração")}</th>
                <th>{tr("Source", "Origem")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.game_key} className="click" onClick={() => onOpen(g.game_key)}>
                  <td>{dateTime(g.played_at)}</td>
                  <td>{SKIP[g.skip_reason ?? ""] ?? g.skip_reason}</td>
                  <td className="muted">{g.category}</td>
                  <td>{g.map_name}</td>
                  <td className="num">{mmss(g.duration_ms)}</td>
                  <td className="muted">{SOURCE[g.source]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

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
        <h2>{empty ? tr("No replays found yet", "Nenhum replay encontrado ainda") : tr("Replay folders", "Pastas de replays")}</h2>
        <button className="btn" onClick={add}>
          {tr("Choose folder…", "Escolher pasta…")}
        </button>
      </div>
      <p className="sub">
        {empty
          ? tr(
              "Replay Altar looks for the game's replays in Documents\\Warcraft III\\BattleNet\\<account>\\Replays. If yours are somewhere else, choose the folder: the Warcraft III folder, its BattleNet or Replays folder, or any folder of replays.",
              "O Replay Altar procura os replays do jogo em Documentos\\Warcraft III\\BattleNet\\<conta>\\Replays. Se os seus estão em outro lugar, escolha a pasta: a pasta Warcraft III, a pasta BattleNet ou Replays dentro dela, ou qualquer pasta com replays.",
            )
          : tr(
              "New replays in these folders are imported as soon as a game ends. Found automatically: the game's own Documents folder (including OneDrive). Add another if yours is elsewhere.",
              "Replays novos nestas pastas são importados assim que a partida acaba. Encontradas automaticamente: a pasta Documentos do jogo (inclusive no OneDrive). Adicione outra se a sua estiver em outro lugar.",
            )}
      </p>
      {all.length > 0 && (
        <table>
          <tbody>
            {folders.found.map((d) => (
              <tr key={d}>
                <td><code>{d}</code></td>
                <td className="muted small">{tr("found automatically", "encontrada automaticamente")}</td>
                <td><button className="btn" onClick={() => api.openPath(d)}>{tr("Open", "Abrir")}</button></td>
              </tr>
            ))}
            {folders.added.map((d) => (
              <tr key={d}>
                <td><code>{d}</code></td>
                <td className="muted small">{tr("added by you", "adicionada por você")}</td>
                <td>
                  <button className="btn" onClick={async () => setFolders(await api.removeFolder(d))}>{tr("Remove", "Remover")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {all.length === 0 && <p className="sub">{tr("No Warcraft III folder found on this computer.", "Nenhuma pasta do Warcraft III encontrada neste computador.")}</p>}
    </div>
  );
}

/** "Update pro games": downloads recent tournament games and recomputes the pro comparison. */
function ProGames({ refs, onChanged }: { refs: RefGroupInfo[]; onChanged: () => void }) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [warcraft, setWarcraft] = useState(false);
  useEffect(() => {
    api.refUpdateStatus().then((s) => {
      setRunning(s.running);
      setLog(s.log);
    });
    api.warcraftRunning().then(setWarcraft);
    return api.onRefUpdate((event, value) => {
      if (event === "progress") setLog((l) => [...l.slice(-39), String(value)]);
      else {
        setRunning(false);
        onChanged();
      }
    });
  }, []);
  const start = async () => {
    setLog([]);
    setRunning(await api.refUpdate());
  };
  return (
    <div className="card">
      <div className="card-head">
        <h2>{tr("Pro games", "Partidas de pros")}</h2>
        <button className="btn" disabled={running} onClick={start}>
          {running ? tr("Updating…", "Atualizando…") : tr("Update pro games", "Atualizar partidas de pros")}
        </button>
      </div>
      <p className="sub">
        {tr(
          'The games your numbers are compared with. "Update pro games" downloads recent tournament replays from warcraft3.info (players with a curated profile, playing your race, on your current patch) until each race you play has its target, simulates them here, and recalculates the comparison. Games from an older patch are dropped. It takes a few minutes and uses the processor; best not while you play.',
          'As partidas com que os seus números são comparados. "Atualizar partidas de pros" baixa replays recentes de torneios do warcraft3.info (jogadores com perfil selecionado, jogando a sua raça, no seu patch atual) até cada raça que você joga ter a sua meta, simula elas aqui e recalcula a comparação. Partidas de um patch mais antigo são descartadas. Leva alguns minutos e usa o processador; melhor não fazer enquanto você joga.',
        )}
      </p>
      {warcraft && !running && <p className="sub">{tr("Warcraft III is running: the update would slow the game down.", "O Warcraft III está aberto: a atualização deixaria o jogo mais lento.")}</p>}
      <table>
        <tbody>
          {refs.map((r) => (
            <tr key={r.group.id}>
              <td>{groupLabel(r.group)}</td>
              <td className="small">
                {r.profile ? tr(`${r.profile.games} games`, `${r.profile.games} partidas`) : tr("no games yet", "nenhuma partida ainda")} {tr("of", "de")} {r.group.target}
                {r.profile && ` (${Object.entries(r.profile.matchups).filter(([k]) => k !== "all").map(([k, v]) => `${k} ${v.n}`).join(", ")})`}
                {r.state?.lastRefreshAt && ` · ${tr("updated", "atualizado em")} ${new Date(r.state.lastRefreshAt).toLocaleString(locale())}`}
                {r.group.onlyIfPlayed && !r.profile && ` · ${tr("downloaded once you play this race", "baixado quando você jogar com esta raça")}`}
              </td>
              <td><button className="btn" onClick={() => api.openPath(r.root)}>{tr("Open", "Abrir")}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {log.length > 0 && <pre className="fact-sheet">{log.join("\n")}</pre>}
    </div>
  );
}

export function Settings({ refs, onRefsChanged }: { refs: RefGroupInfo[]; onRefsChanged: () => void }) {
  const [state, setState] = useState<{ config: Config; configPath: string; paths: Paths } | null>(null);
  const [accounts, setAccounts] = useState("");
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState("…");
  const [scale, setScale] = useState(textScale);
  useEffect(() => {
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

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="card">
        <h2>{tr("You", "Você")}</h2>
        <p className="sub">
          {tr('Your battletags, comma separated. Games where none of them played are archived as "observed". Run ', 'Suas battletags, separadas por vírgula. Partidas em que nenhuma delas jogou são arquivadas como "assistidas". Rode ')}
          <code>replay-altar reingest</code>
          {tr(" after changing this to reclassify old games.", " depois de mudar isto para reclassificar as partidas antigas.")}
        </p>
        <div className="filters">
          <input type="text" style={{ flex: 1 }} value={accounts} onChange={(e) => setAccounts(e.target.value)} />
          <button className="btn" onClick={() => save({ accounts: accounts.split(",").map((a) => a.trim()).filter(Boolean) })}>{tr("Save", "Salvar")}</button>
          {saved && <span className="muted small">{tr("Saved", "Salvo")}</span>}
        </div>
      </div>
      <div className="card">
        <h2>{tr("Display", "Exibição")}</h2>
        <div className="filters">
          <label>
            {tr("Language", "Idioma")}
            <select value={language()} onChange={(e) => setLanguage(e.target.value as Language)}>
              {LANGUAGES.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </label>
          <label>
            {tr("Text size", "Tamanho do texto")}
            <select value={scale} onChange={(e) => { const v = Number(e.target.value); setTextScale(v); setScale(v); }}>
              {TEXT_SCALES.map((v) => (
                <option key={v} value={v}>{Math.round(v * 100)}%</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <ReplayFolders />
      <div className="card">
        <h2>{tr("Behaviour", "Comportamento")}</h2>
        <p className="sub">{tr("Collector", "Coletor")}: <b>{collectorStatus(status)}</b>. {tr("Changes restart it.", "Mudanças reiniciam o coletor.")}</p>
        <div className="filters" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          <label><input type="checkbox" checked={config.openWindowOnGameStart} onChange={(e) => save({ openWindowOnGameStart: e.target.checked })} />{tr("Open this window (without taking focus) when Warcraft III starts", "Abrir esta janela (sem tirar o foco) quando o Warcraft III abrir")}</label>
          <label><input type="checkbox" checked={config.notifyAfterGame} onChange={(e) => save({ notifyAfterGame: e.target.checked })} />{tr("Notify me after each analyzed game", "Me avisar depois de cada partida analisada")}</label>
        </div>
      </div>
      <ProGames refs={refs} onChanged={onRefsChanged} />
      <div className="card">
        <h2>{tr("Where things live", "Onde ficam as coisas")}</h2>
        <table>
          <tbody>
            <tr><td>{tr("Archived replays", "Replays arquivados")}</td><td><code>{paths.archive}</code></td><td><button className="btn" onClick={() => api.openPath(paths.archive)}>{tr("Open", "Abrir")}</button></td></tr>
            <tr><td>{tr("Game records (JSON)", "Registros das partidas (JSON)")}</td><td><code>{paths.games}</code></td><td><button className="btn" onClick={() => api.openPath(paths.games)}>{tr("Open", "Abrir")}</button></td></tr>
            <tr><td>{tr("Database", "Banco de dados")}</td><td><code>{paths.db}</code></td><td /></tr>
            <tr><td>{tr("Settings file", "Arquivo de configurações")}</td><td><code>{state.configPath}</code></td><td /></tr>
          </tbody>
        </table>
        <p className="sub" style={{ marginTop: 12 }}>
          {tr("Pause", "Pausar")}: <code>replay-altar suspend</code> · {tr("resume", "retomar")}: <code>replay-altar resume</code> · {tr("remove", "remover")}: <code>replay-altar uninstall</code> ({tr("add", "adicione")} <code>--purge</code> {tr("to also delete your archive and stats", "para apagar também o seu arquivo e estatísticas")}).
        </p>
      </div>
    </div>
  );
}

/** The collector's state in words ("active" and the like come from systemd or service.ts). */
const collectorStatus = (s: string) =>
  ({ active: tr("active", "rodando"), inactive: tr("inactive", "parado"), "not installed": tr("not installed", "não instalado") })[s] ?? s;
