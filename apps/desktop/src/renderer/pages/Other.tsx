import { useEffect, useState } from "react";
import type { Config, GameRow, Paths } from "@w3stats/core/ui";
import { api, type RefGroupInfo } from "../api.ts";
import { dateTime, mmss, SKIP, SOURCE } from "../format.ts";

export function Skipped({ games, onOpen }: { games: GameRow[]; onOpen: (key: string) => void }) {
  const rows = games.filter((g) => g.analyzed === 0);
  return (
    <div className="page">
      <p className="muted" style={{ margin: 0 }}>
        Archived but not counted in your stats: custom maps, games against computers, team games, and games you only observed.
      </p>
      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty">Nothing skipped.</div>
        ) : (
          <table>
            <thead><tr><th>Played</th><th>Why skipped</th><th>Kind</th><th>Map</th><th className="num">Length</th><th>Source</th></tr></thead>
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

export function Settings({ refs }: { refs: RefGroupInfo[] }) {
  const [state, setState] = useState<{ config: Config; configPath: string; paths: Paths } | null>(null);
  const [accounts, setAccounts] = useState("");
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState("…");
  useEffect(() => {
    api.getConfig().then((s) => {
      setState(s);
      setAccounts(s.config.accounts.join(", "));
    });
    api.collectorStatus().then(setStatus);
  }, []);
  if (!state) return null;
  const { config, paths } = state;
  const save = async (next: Config) => {
    await api.setConfig(next);
    setState({ ...state, config: next });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="card">
        <h2>You</h2>
        <p className="sub">Your battletags, comma separated. Games where none of them played are archived as "observed". Run <code>w3stats reingest</code> after changing this to reclassify old games.</p>
        <div className="filters">
          <input type="text" style={{ flex: 1 }} value={accounts} onChange={(e) => setAccounts(e.target.value)} />
          <button className="btn" onClick={() => save({ ...config, accounts: accounts.split(",").map((a) => a.trim()).filter(Boolean) })}>Save</button>
          {saved && <span className="muted small">Saved</span>}
        </div>
      </div>
      <div className="card">
        <h2>Behaviour</h2>
        <p className="sub">Collector: <b>{status}</b>. Changes restart it.</p>
        <div className="filters" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          <label><input type="checkbox" checked={config.openWindowOnGameStart} onChange={(e) => save({ ...config, openWindowOnGameStart: e.target.checked })} />Open this window (without taking focus) when Warcraft III starts</label>
          <label><input type="checkbox" checked={config.notifyAfterGame} onChange={(e) => save({ ...config, notifyAfterGame: e.target.checked })} />Notify me after each analyzed game</label>
        </div>
      </div>
      <div className="card">
        <h2>Reference games</h2>
        <p className="sub">
          Pro games downloaded from W3Champions (public replays), analyzed and simulated locally. Topped up every 6 hours until full, then
          refreshed every {state.config.reference.refreshDays} days; never while Warcraft III is running. Only games from your current patch are kept.
        </p>
        <table>
          <tbody>
            {refs.map((r) => (
              <tr key={r.group.id}>
                <td>{r.group.label}</td>
                <td className="small">
                  {r.profile ? `${r.profile.games} games` : "no games yet"} of {r.group.target}
                  {r.profile && ` (${Object.entries(r.profile.matchups).filter(([k]) => k !== "all").map(([k, v]) => `${k} ${v.n}`).join(", ")})`}
                  {r.state?.lastRefreshAt && ` · last refresh ${new Date(r.state.lastRefreshAt).toLocaleString()}`}
                  {r.state?.lastResult?.stopReason && ` · ${r.state.lastResult.stopReason}`}
                </td>
                <td><button className="btn" onClick={() => api.openPath(r.root)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sub" style={{ marginTop: 12 }}>Refresh now: <code>w3stats ref refresh</code> · status: <code>w3stats ref</code></p>
      </div>
      <div className="card">
        <h2>Where things live</h2>
        <table>
          <tbody>
            <tr><td>Archived replays</td><td><code>{paths.archive}</code></td><td><button className="btn" onClick={() => api.openPath(paths.archive)}>Open</button></td></tr>
            <tr><td>Game records (JSON)</td><td><code>{paths.games}</code></td><td><button className="btn" onClick={() => api.openPath(paths.games)}>Open</button></td></tr>
            <tr><td>Database</td><td><code>{paths.db}</code></td><td /></tr>
            <tr><td>Settings file</td><td><code>{state.configPath}</code></td><td /></tr>
            {config.warcraftDocuments.map((d) => (
              <tr key={d}><td>Watched game folder</td><td><code>{d}/BattleNet/*/Replays</code></td><td /></tr>
            ))}
          </tbody>
        </table>
        <p className="sub" style={{ marginTop: 12 }}>
          Pause: <code>w3stats suspend</code> · resume: <code>w3stats resume</code> · remove: <code>w3stats uninstall</code> (add <code>--purge</code> to also delete your archive and stats).
        </p>
      </div>
    </div>
  );
}
