import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GameRow, MetricDef, PerfGame } from "@replay-altar/core/ui";
import { api, type RefGroupInfo, type UpdateState } from "./api.ts";
import { Match } from "./pages/Match.tsx";
import { Matches } from "./pages/Matches.tsx";
import { Settings } from "./pages/Other.tsx";
import { Analyzer } from "./pages/Analyzer.tsx";
import { Performance } from "./pages/Performance.tsx";
import { TipLayer } from "./Tip.tsx";
import { CollectorProgress } from "./CollectorProgress.tsx";
import { openIssue } from "./feedback.ts";
import { applyTextScale } from "./textSize.ts";
import { tr } from "@replay-altar/core/i18n";
import "./styles.css";
import icon from "../../assets/icons/64.png";

applyTextScale();

// The game's own font when it has been extracted (scripts/extract-gamedata.ts); system font otherwise.
api.uiFont().then((url) => {
  if (!url) return;
  const face = new FontFace("Warcraft", `url(${url})`);
  face.load().then((f) => document.fonts.add(f)).catch(() => {});
});

type Page = "matches" | "performance" | "analyzer" | "settings";
const TABS: [Page, string][] = [
  ["matches", tr("Matches", "Partidas", "Partidas", "Parties")],
  ["performance", tr("Performance", "Desempenho", "Rendimiento", "Performances")],
  ["analyzer", tr("Analyzer", "Analisador", "Analizador", "Analyseur")],
  ["settings", tr("Settings", "Configurações", "Configuración", "Paramètres")],
];

function App() {
  const [page, setPage] = useState<Page>("matches");
  const [game, setGame] = useState<string | null>(null);
  const [games, setGames] = useState<GameRow[]>([]);
  const [perf, setPerf] = useState<{ games: PerfGame[]; metrics: MetricDef[] }>({ games: [], metrics: [] });
  const [version, setVersion] = useState(0); // bumps when the collector adds a game
  const [refs, setRefs] = useState<RefGroupInfo[]>([]);
  const [update, setUpdate] = useState<UpdateState | null>(null);

  const load = useCallback(() => {
    api.listGames().then(setGames);
    api.performance().then(setPerf);
    api.referenceProfiles().then(setRefs);
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    load();
    api.onDataChanged(load);
    api.onNavGame((key) => {
      load();
      setGame(key);
    });
    api.updateState().then(setUpdate);
    api.onUpdateState(setUpdate);
    api.onNavPage((p) => {
      setGame(null);
      setPage(p as Page);
    });
    api.pendingNav().then((nav) => {
      if (nav?.page) setPage(nav.page as Page);
      if (nav?.game) setGame(nav.game);
    });
  }, [load]);

  const open = (key: string) => setGame(key);
  const analyzed = games.filter((g) => g.analyzed === 1).length;
  const simulating = games.filter((g) => g.analyzed === 1 && g.sim_status === null).length;

  return (
    <div className="app">
      <TipLayer />
      <header className="topbar">
        <span className="brand">
          <img src={icon} alt="" width={24} height={24} />
          Replay Altar
        </span>
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              className="tab"
              aria-current={page === id && !game ? "page" : undefined}
              onClick={() => {
                setGame(null);
                setPage(id);
              }}
            >
              {label}
              {id === "settings" && update?.latest && (
                <span className="tab-alert" title={tr(`Replay Altar ${update.latest.version} is available`, `O Replay Altar ${update.latest.version} está disponível`, `Replay Altar ${update.latest.version} está disponible`, `Replay Altar ${update.latest.version} est disponible`)}>!</span>
              )}
            </button>
          ))}
        </nav>
        <button className="btn topbar-bug" onClick={() => openIssue("bug.yml")} title={tr("Something doesn't work? Opens the project's GitHub page with the version and system filled in.", "Algo não funciona? Abre a página do projeto no GitHub com a versão e o sistema preenchidos.", "¿Algo no funciona? Abre la página del proyecto en GitHub con la versión y el sistema ya rellenados.", "Quelque chose ne marche pas ? Ouvre la page GitHub du projet avec la version et le système remplis.")}>
          {tr("Report a bug", "Relatar um problema", "Informar de un problema", "Signaler un bug")}
        </button>
        <span className="status">
          {tr(`${analyzed} games analyzed`, `${analyzed} partidas analisadas`, `${analyzed} partidas analizadas`, `${analyzed} parties analysées`)}
          {simulating ? tr(` · ${simulating} waiting for simulation`, ` · ${simulating} aguardando simulação`, ` · ${simulating} esperando la simulación`, ` · ${simulating} en attente de simulation`) : ""}
        </span>
      </header>
      <main>
        <CollectorProgress onDone={load} />
        {game ? (
          <Match key={`${game}:${version}`} gameKey={game} metrics={perf.metrics} refs={refs} onBack={() => setGame(null)} />
        ) : page === "matches" ? (
          <Matches games={games} onOpen={open} />
        ) : page === "analyzer" ? (
          <Analyzer onOpen={open} />
        ) : page === "performance" ? (
          <Performance games={perf.games} metrics={perf.metrics} refs={refs} onOpen={open} />
        ) : (
          <Settings refs={refs} update={update} />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
