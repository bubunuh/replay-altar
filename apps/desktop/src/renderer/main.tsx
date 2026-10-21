import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GameRow, MetricDef, PerfGame } from "@replay-altar/core/ui";
import { api, type RefGroupInfo, type UpdateState } from "./api.ts";
import { Match } from "./pages/Match.tsx";
import { Matches } from "./pages/Matches.tsx";
import { Settings } from "./pages/Other.tsx";
import { Performance } from "./pages/Performance.tsx";
import { TipLayer } from "./Tip.tsx";
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

type Page = "matches" | "performance" | "settings";
const TABS: [Page, string][] = [
  ["matches", tr("Matches", "Partidas")],
  ["performance", tr("Performance", "Desempenho")],
  ["settings", tr("Settings", "Configurações")],
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
                <span className="tab-alert" title={tr(`Replay Altar ${update.latest.version} is available`, `O Replay Altar ${update.latest.version} está disponível`)}>!</span>
              )}
            </button>
          ))}
        </nav>
        <span className="status">
          {tr(`${analyzed} games analyzed`, `${analyzed} partidas analisadas`)}
          {simulating ? tr(` · ${simulating} waiting for simulation`, ` · ${simulating} aguardando simulação`) : ""}
        </span>
      </header>
      <main>
        {game ? (
          <Match key={`${game}:${version}`} gameKey={game} metrics={perf.metrics} refs={refs} onBack={() => setGame(null)} />
        ) : page === "matches" ? (
          <Matches games={games} onOpen={open} />
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
