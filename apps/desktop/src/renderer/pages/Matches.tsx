import { useMemo, useState } from "react";
import type { GameRow } from "@replay-altar/core/ui";
import { dateTime, mmss, RACE, shortName, SOURCE } from "../format.ts";

export function Result({ result }: { result: string }) {
  return <span className={`result ${result}`}>{result === "win" ? "Win" : result === "loss" ? "Loss" : "Unknown"}</span>;
}

export function Matches({ games, onOpen }: { games: GameRow[]; onOpen: (key: string) => void }) {
  const [source, setSource] = useState("all");
  const [result, setResult] = useState("all");
  const [oppRace, setOppRace] = useState("all");
  const [q, setQ] = useState("");

  const rows = useMemo(
    () =>
      games.filter(
        (g) =>
          g.analyzed === 1 &&
          (source === "all" || g.source === source) &&
          (result === "all" || g.result === result) &&
          (oppRace === "all" || g.opp_race === oppRace) &&
          (!q || `${g.opp_name} ${g.map_name} ${g.user_label ?? ""}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [games, source, result, oppRace, q],
  );

  return (
    <div className="page">
      <div className="filters">
        <label>
          Source
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">All</option>
            {Object.entries(SOURCE).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Result
          <select value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="all">All</option>
            <option value="win">Wins</option>
            <option value="loss">Losses</option>
          </select>
        </label>
        <label>
          Opponent race
          <select value={oppRace} onChange={(e) => setOppRace(e.target.value)}>
            <option value="all">All</option>
            {["H", "O", "U", "N"].map((r) => (
              <option key={r} value={r}>{RACE[r]}</option>
            ))}
          </select>
        </label>
        <input type="text" placeholder="Search opponent, map, label" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{rows.length} games</span>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty">No analyzed games yet. Play a 1v1 — it shows up here when the game ends.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Played</th>
                <th>Result</th>
                <th>Matchup</th>
                <th>Opponent</th>
                <th>Map</th>
                <th className="num">Length</th>
                <th className="num">APM</th>
                <th>Source</th>
                <th>Your label</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.game_key} className="click" onClick={() => onOpen(g.game_key)}>
                  <td>{dateTime(g.played_at)}</td>
                  <td><Result result={g.result} /></td>
                  <td>{g.matchup}</td>
                  <td title={g.opp_name ?? ""}>{shortName(g.opp_name)} <span className="muted small">{RACE[g.opp_race ?? ""]}</span></td>
                  <td>{g.map_name}</td>
                  <td className="num">{mmss(g.duration_ms)}</td>
                  <td className="num">{g.apm === null ? "—" : Math.round(g.apm)}</td>
                  <td className="muted">{SOURCE[g.source]}</td>
                  <td className="muted">{g.user_label ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
