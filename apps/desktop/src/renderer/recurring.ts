// Recurring problems over a list of your games (Recurring.tsx shows them on Performance): how
// often each finding came up in losses and wins, the trend (your last 5 games against the 5
// before) and the one habit to work on now: the problem in most of your last 10 games.
import type { PerfGame } from "@replay-altar/core/ui";
import type { GameFindings } from "./api.ts";

/** Only the findings a report shows count (the top three). */
const SHOWN = 3;

/** `games` oldest first, as on Performance; `all` the findings of every analyzed game. */
export function recurringView(games: Pick<PerfGame, "game_key" | "result">[], all: GameFindings[]) {
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
}

export type RecurringView = ReturnType<typeof recurringView>;
