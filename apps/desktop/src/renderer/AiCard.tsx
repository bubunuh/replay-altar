// "AI analysis" on a match: run on demand (too heavy to run after every game), stored with
// everything the model was given. The findings come from Replay Altar's rules; the model only writes.
import { useEffect, useState } from "react";
import type { AiAnalysis } from "@replay-altar/ai/types";
import { api, type AiStatus } from "./api.ts";
import { dateTime } from "./format.ts";
import { Tip } from "./Tip.tsx";

/** Hidden or shown, remembered across matches (a per-viewer convenience). */
const HIDDEN_KEY = "ai-card-hidden";
const readHidden = () => {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
};

export function AiCard({ gameKey }: { gameKey: string }) {
  const [analysis, setAnalysis] = useState<AiAnalysis | null | undefined>(undefined);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [hidden, setHidden] = useState(readHidden);
  const toggle = () =>
    setHidden((h) => {
      try {
        localStorage.setItem(HIDDEN_KEY, h ? "0" : "1");
      } catch {
        // storage unavailable: the choice lasts for this page only
      }
      return !h;
    });

  const load = () => {
    api.aiGet(gameKey).then(setAnalysis);
    api.aiStatus().then((s) => {
      setStatus(s);
      if (s.running.includes(gameKey)) setStage((x) => x ?? "Running");
    });
  };
  useEffect(load, [gameKey]);
  useEffect(
    () =>
      api.onAi((event, key, st) => {
        if (key !== gameKey) return;
        if (event === "progress") setStage(st ?? null);
        else {
          setStage(null);
          setStartedAt(null);
          load();
        }
      }),
    [gameKey],
  );
  useEffect(() => {
    if (!stage) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stage]);

  const run = () => {
    setStage("Starting");
    setStartedAt(Date.now());
    api.aiRun(gameKey).catch((e) => {
      setStage(null);
      setAnalysis((a) => a ?? null);
      alert(String(e));
    });
  };

  if (analysis === undefined || !status) return null;
  const busy = stage !== null;
  const review = analysis?.review ?? null;
  return (
    <div className="card ai-card">
      <div className="ai-head">
        <h2>
          AI analysis{" "}
          <Tip text="A local model (Gemma, on your graphics card) writes up the findings above. About 30 seconds, a minute the first time while it loads. Nothing leaves your computer." />
        </h2>
        <div className="ai-actions">
          {!hidden && !busy && !status.problem && (
            <button
              className="btn"
              onClick={run}
              data-tip={status.warcraftRunning ? "Warcraft III is running: the model takes most of the graphics card's memory and would slow the game down." : undefined}
            >
              {analysis ? "Run again" : status.warcraftRunning ? "Analyze anyway" : "Analyze with AI"}
            </button>
          )}
          <button className="btn" onClick={toggle}>{hidden ? "Show" : "Hide"}</button>
        </div>
      </div>
      {hidden ? null : (
      <>
      {status.problem && <p className="sub">Not available: {status.problem}. The model is set in the "ai" section of the settings file.</p>}
      {busy && (
        <p className="sub ai-busy">
          {stage}…{startedAt ? ` ${Math.round((now - startedAt) / 1000)} s` : ""}
        </p>
      )}
      {analysis?.error && !busy && <p className="sub">The last run failed: {analysis.error}</p>}
      {review && analysis && (
        <div className={busy ? "ai-body stale" : "ai-body"}>
          <p>{review.recap}</p>
          <p>
            <b>Opponent's plan.</b> {review.opponent_strategy}
          </p>
          {analysis.findings.map((f) => {
            const w = review.findings[f.id];
            return (
              <div key={f.id} className="ai-finding">
                <h3>{w?.title || f.headline}</h3>
                {w?.explanation && <p>{w.explanation}</p>}
                {w?.next_time && (
                  <p>
                    <b>Next time:</b> {w.next_time}
                  </p>
                )}
                <details>
                  <summary>Evidence</summary>
                  <ul className="small">
                    {f.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </details>
              </div>
            );
          })}
                    {review.strengths && (
            <p>
              <b>Went well.</b> {review.strengths}
            </p>
          )}
          <p className="ai-one">
            <b>One thing for next game:</b> {review.one_thing}
          </p>
          <p className="sub small" data-tip={`${analysis.model.file.replace(/\.gguf$/, "")}, ${Math.round(analysis.timings.totalMs / 1000)} s`}>
            {dateTime(analysis.createdAt)} ·{" "}
            {analysis.unverified.length === 0 ? "every number checked against the game data" : `not found in the game data, double-check: ${analysis.unverified.join(", ")}`}
          </p>
          <details>
            <summary className="small">What the model was given</summary>
            <pre className="ai-facts">{analysis.facts}</pre>
          </details>
        </div>
      )}
      </>
      )}
    </div>
  );
}
