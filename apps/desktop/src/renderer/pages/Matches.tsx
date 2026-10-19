import { useEffect, useMemo, useState } from "react";
import { api, type GameFindings } from "../api.ts";
import type { GameRow } from "@replay-altar/core/ui";
import { dateTime, mmss, problemName, RACE, shortName, SOURCE } from "../format.ts";
import { RaceIcon } from "../RaceIcon.tsx";

export function Result({ result }: { result: string }) {
  return <span className={`result ${result}`}>{result === "win" ? "Win" : result === "loss" ? "Loss" : "Unknown"}</span>;
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
        <label>
          Problem
          <select value={problem} onChange={(e) => setProblem(e.target.value)}>
            <option value="all">All</option>
            {problems.map((id) => (
              <option key={id} value={id}>{problemName(id)}</option>
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
                <th data-tip="The report's most important finding; hover for the full sentence.">Main problem</th>
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
