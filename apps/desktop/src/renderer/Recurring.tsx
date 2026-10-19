// Recurring problems: how often each finding came up in your games (in view on Performance),
// whether it is getting better (your last 5 games against the 5 before), and the one habit to
// work on now: the problem in most of your last 10 games.
import { useEffect, useMemo, useState } from "react";
import type { PerfGame } from "@replay-altar/core/ui";
import { api, type GameFindings } from "./api.ts";
import { problemName } from "./format.ts";
import { Tip } from "./Tip.tsx";

/** Only the findings a report shows count (the top three). */
const SHOWN = 3;

export function Recurring({ games, onOpen }: { games: PerfGame[]; onOpen: (key: string) => void }) {
  const [all, setAll] = useState<GameFindings[] | null>(null);
  useEffect(() => {
    api.findingsSummary().then(setAll);
  }, [games.length]);

  const view = useMemo(() => {
    if (!all) return null;
    const byKey = new Map(all.map((g) => [g.key, g]));
    // Oldest first, decided games only, as on the rest of the page.
    const list = games.filter((g) => g.result === "win" || g.result === "loss").map((g) => ({ g, f: byKey.get(g.game_key)?.findings.slice(0, SHOWN) ?? [] }));
    const has = (x: (typeof list)[number], id: string) => x.f.some((f) => f.id === id);
    const ids = [...new Set(list.flatMap((x) => x.f.map((f) => f.id)))];
    const losses = list.filter((x) => x.g.result === "loss");
    const wins = list.filter((x) => x.g.result === "win");
    const last5 = list.slice(-5);
    const prev5 = list.slice(-10, -5);
    const rows = ids
      .map((id) => {
        const latest = [...list].reverse().find((x) => has(x, id))!;
        const f = latest.f.find((x) => x.id === id)!;
        return {
          id,
          inLosses: losses.filter((x) => has(x, id)).length,
          inWins: wins.filter((x) => has(x, id)).length,
          recent: last5.filter((x) => has(x, id)).length,
          before: prev5.filter((x) => has(x, id)).length,
          latest: latest.g.game_key,
          headline: f.headline,
          advice: f.advice,
        };
      })
      .sort((a, b) => b.inLosses + b.inWins - (a.inLosses + a.inWins) || b.inLosses - a.inLosses)
      .slice(0, 8);
    const last10 = list.slice(-10);
    const focus = ids
      .map((id) => ({ id, n: last10.filter((x) => has(x, id)).length, losses: last10.filter((x) => x.g.result === "loss" && has(x, id)).length }))
      .filter((x) => x.id !== "mechanics" && x.n >= 2)
      .sort((a, b) => b.n - a.n || b.losses - a.losses)[0];
    const focusRow = focus && rows.find((r) => r.id === focus.id);
    return { rows, losses: losses.length, wins: wins.length, focus, focusRow, last10: last10.length, enough: prev5.length === 5 };
  }, [all, games]);

  if (!view || !view.rows.length) return null;
  const trend = (r: (typeof view.rows)[number]) => {
    if (!view.enough) return <span className="muted">—</span>;
    if (r.recent < r.before) return <span className="trend better" data-tip={`In ${r.recent} of your last 5 games, ${r.before} of the 5 before.`}>▼ better</span>;
    if (r.recent > r.before) return <span className="trend worse" data-tip={`In ${r.recent} of your last 5 games, ${r.before} of the 5 before.`}>▲ worse</span>;
    return <span className="trend muted" data-tip={`In ${r.recent} of your last 5 games and of the 5 before.`}>= same</span>;
  };
  return (
    <div className="card">
      <h2>
        Recurring problems{" "}
        <Tip text="The rules' findings across the games in view (the three a report shows). Trend: your last 5 games against the 5 before. Click a row to open the latest game with it." />
      </h2>
      {view.focus && (
        <p className="ai-one">
          <b>Work on this now</b> {problemName(view.focus.id)}: in {view.focus.n} of your last {view.last10} games. {view.focusRow?.advice}
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Problem</th>
            <th className="num">In losses</th>
            <th className="num">In wins</th>
            <th>Trend</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.id} className="click" onClick={() => onOpen(r.latest)} data-tip={`Latest: ${r.headline}.${r.advice ? ` ${r.advice}` : ""}`}>
              <td>{problemName(r.id)}</td>
              <td className="num">{r.inLosses} of {view.losses}</td>
              <td className="num">{r.inWins} of {view.wins}</td>
              <td>{trend(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
