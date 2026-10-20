// "Findings" on a match: a recap, what the rules found (most important first) with the facts
// that explain each and what to do next time, the fight that turned the game, the one thing to
// work on and the strengths; the opponent's plan and the full fact sheet behind "Show more".
import { useEffect, useState } from "react";
import type { RulesBook } from "@replay-altar/rules/types";
import { api } from "./api.ts";
import { Tip } from "./Tip.tsx";

export function RulesCard({ gameKey }: { gameKey: string }) {
  const [book, setBook] = useState<RulesBook | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    api.rules(gameKey).then(setBook);
  }, [gameKey]);

  if (!book) return null;
  if (book.problem) {
    return (
      <div className="card">
        <h2>Findings</h2>
        <p className="sub">Not available: {book.problem}.</p>
      </div>
    );
  }
  return (
    <div className="card rules-card">
      <h2>
        Findings <Tip text="Computed by Replay Altar's rules from the replay, compared with pro games of your matchup. Most important first." />
      </h2>
      <p className="rules-recap">{book.recap}</p>
      <ol className="rules-findings">
        {book.findings.map((f) => (
          <li key={f.id}>
            <h3>{f.headline}</h3>
            <ul className="small">
              {f.evidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            {!!f.because?.length && (
              <p className="small rules-why">
                <b data-tip="Facts from elsewhere in the game that explain this finding.">Why</b> {f.because.join(" ")}
              </p>
            )}
            {f.advice && (
              <p className="small">
                <b>Next time</b> {f.advice}
              </p>
            )}
          </li>
        ))}
      </ol>
      {book.turningPoint && (
        <p className="small">
          <b data-tip="The fight with the biggest swing against the side that lost; jump to it in the replay.">Turning point</b> {book.turningPoint}
        </p>
      )}
      {book.oneThing && (
        <p className="one-thing">
          <b>One thing for next game</b> {book.oneThing}
        </p>
      )}
      {book.strengths.length > 0 && (
        <div className="rules-strengths">
          <h3>
            Strengths <Tip text="Where this game beat most pro games of your matchup (and nothing a finding above contradicts)." />
          </h3>
          <ul className="small">
            {book.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      <button className="btn" onClick={() => setMore((x) => !x)} data-tip="The opponent's plan from their orders, and every number the rules used.">
        {more ? "Show less" : "Show more"}
      </button>
      {more && (
        <div className="rules-more">
          <h3>Opponent's plan</h3>
          <ul className="small">
            {book.opponentPlan.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h3>Fact sheet</h3>
          <pre className="fact-sheet">{book.facts}</pre>
        </div>
      )}
    </div>
  );
}
