// "Findings" on a match: a recap, what the rules found (most important first) with the facts
// that explain each and what to do next time, the fight that turned the game and the one thing
// to work on; strengths, the opponent's plan and the full fact sheet behind "Show more".
import { useEffect, useState } from "react";
import type { RulesBook } from "@replay-altar/ai/types";
import { api } from "./api.ts";

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
      <h2>Findings</h2>
      <p className="sub">Computed by Replay Altar's rules from the replay and the pro games, most important first.</p>
      <p className="rules-recap">{book.recap}</p>
      {book.findings.length === 0 && <p className="muted">No clear problem stood out in this game.</p>}
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
                <b>Why:</b> {f.because.join(" ")}
              </p>
            )}
            {f.advice && (
              <p className="small">
                <b>Next time:</b> {f.advice}
              </p>
            )}
          </li>
        ))}
      </ol>
      {book.turningPoint && (
        <p className="small">
          <b>Turning point.</b> {book.turningPoint}
        </p>
      )}
      {book.oneThing && (
        <p className="ai-one">
          <b>One thing for next game:</b> {book.oneThing}
        </p>
      )}
      <button className="btn" onClick={() => setMore((x) => !x)}>
        {more ? "Show less" : "Show more"}
      </button>
      {more && (
        <div className="rules-more">
          <h3>Strengths</h3>
          {book.strengths.length ? (
            <ul className="small">
              {book.strengths.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">None stood out.</p>
          )}
          <h3>Opponent's plan (from their orders)</h3>
          <ul className="small">
            {book.opponentPlan.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h3>Fact sheet</h3>
          <pre className="ai-facts">{book.facts}</pre>
        </div>
      )}
    </div>
  );
}
