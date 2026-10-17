import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GameRow, MetricDef, PerfGame } from "@w3stats/core/ui";
import { api, type RefGroupInfo } from "./api.ts";
import { Match } from "./pages/Match.tsx";
import { Matches } from "./pages/Matches.tsx";
import { Settings, Skipped } from "./pages/Other.tsx";
import { Performance } from "./pages/Performance.tsx";
import "./styles.css";

type Page = "matches" | "performance" | "skipped" | "settings";
const TABS: [Page, string][] = [
  ["matches", "Matches"],
  ["performance", "Performance"],
  ["skipped", "Skipped"],
  ["settings", "Settings"],
];

function App() {
  const [page, setPage] = useState<Page>("matches");
  const [game, setGame] = useState<string | null>(null);
  const [games, setGames] = useState<GameRow[]>([]);
  const [perf, setPerf] = useState<{ games: PerfGame[]; metrics: MetricDef[] }>({ games: [], metrics: [] });
  const [version, setVersion] = useState(0); // bumps when the collector adds a game
  const [refs, setRefs] = useState<RefGroupInfo[]>([]);

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
    api.onNavPage((p) => {
      setGame(null);
      setPage(p as Page);
    });
  }, [load]);

  const open = (key: string) => setGame(key);
  const pros = refs.find((r) => r.group.id === "pros") ?? refs[0];
  const analyzed = games.filter((g) => g.analyzed === 1).length;
  const simulating = games.filter((g) => g.analyzed === 1 && g.sim_status === null).length;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">W3Stats</span>
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
            </button>
          ))}
        </nav>
        <span className="status">
          {analyzed} analyzed · {games.length - analyzed} skipped{simulating ? ` · ${simulating} waiting for simulation` : ""}
        </span>
      </header>
      <main>
        {game ? (
          <Match key={`${game}:${version}`} gameKey={game} metrics={perf.metrics} pros={pros} onBack={() => setGame(null)} />
        ) : page === "matches" ? (
          <Matches games={games} onOpen={open} />
        ) : page === "performance" ? (
          <Performance games={perf.games} metrics={perf.metrics} pros={pros} onOpen={open} />
        ) : page === "skipped" ? (
          <Skipped games={games} onOpen={open} />
        ) : (
          <Settings refs={refs} />
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
