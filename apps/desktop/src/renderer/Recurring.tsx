// Recurring problems on Performance: the table and the habit to work on now (recurring.ts).
import { useEffect, useMemo, useState } from "react";
import type { PerfGame } from "@replay-altar/core/ui";
import { api, type GameFindings } from "./api.ts";
import { problemName } from "./format.ts";
import { recurringView } from "./recurring.ts";
import { Tip } from "./Tip.tsx";

export function Recurring({ games, onOpen }: { games: PerfGame[]; onOpen: (key: string) => void }) {
  const [all, setAll] = useState<GameFindings[] | null>(null);
  useEffect(() => {
    api.findingsSummary().then(setAll);
  }, [games.length]);

  const view = useMemo(() => (all ? recurringView(games, all) : null), [all, games]);

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
        <p className="one-thing">
          <b>Work on this now</b>
          <br />
          {problemName(view.focus.id)}: in {view.focus.n} of your last {view.last10} games. {view.focusRow?.advice}
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
