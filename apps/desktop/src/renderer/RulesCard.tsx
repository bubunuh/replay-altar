// "Findings" on a match: a recap, what the rules found (most important first) with the facts
// that explain each and what to do next time, the fight that turned the game, the one thing to
// work on and the strengths; the opponent's plan and the full fact sheet behind "Show more".
import { useEffect, useState } from "react";
import type { RulesBook } from "@replay-altar/rules/types";
import { api } from "./api.ts";
import { Tip } from "./Tip.tsx";
import { tr } from "@replay-altar/core/i18n";

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
        <h2>{tr("Findings", "Análise")}</h2>
        <p className="sub">{tr("Not available", "Indisponível")}: {book.problem}.</p>
      </div>
    );
  }
  return (
    <div className="card rules-card">
      <h2>
        {tr("Findings", "Análise")} <Tip text={tr("Computed by Replay Altar's rules from the replay, compared with pro games of your matchup. Most important first.", "Calculada pelas regras do Replay Altar a partir do replay, comparando com partidas de pros do seu confronto. O mais importante primeiro.")} />
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
                <b data-tip={tr("Facts from elsewhere in the game that explain this finding.", "Fatos de outros momentos da partida que explicam este problema.")}>{tr("Why", "Por quê")}</b> {f.because.join(" ")}
              </p>
            )}
            {f.advice && (
              <p className="small">
                <b>{tr("Next time", "Na próxima")}</b> {f.advice}
              </p>
            )}
          </li>
        ))}
      </ol>
      {book.turningPoint && (
        <p className="small">
          <b data-tip={tr("The fight with the biggest swing against the side that lost; jump to it in the replay.", "A luta com a maior virada contra quem perdeu; vá até ela no replay.")}>{tr("Turning point", "Ponto de virada")}</b> {book.turningPoint}
        </p>
      )}
      {book.oneThing && (
        <p className="one-thing">
          <b>{tr("One thing for next game", "Uma coisa para a próxima partida")}</b> {book.oneThing}
        </p>
      )}
      {book.strengths.length > 0 && (
        <div className="rules-strengths">
          <h3>
            {tr("Strengths", "Pontos fortes")} <Tip text={tr("Where this game beat most pro games of your matchup (and nothing a finding above contradicts).", "Onde esta partida superou a maioria das partidas de pros do seu confronto (e nada na análise acima contradiz).")} />
          </h3>
          <ul className="small">
            {book.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      <button className="btn" onClick={() => setMore((x) => !x)} data-tip={tr("The opponent's plan from their orders, and every number the rules used.", "O plano do oponente pelas ordens dele, e todos os números que as regras usaram.")}>
        {more ? tr("Show less", "Mostrar menos") : tr("Show more", "Mostrar mais")}
      </button>
      {more && (
        <div className="rules-more">
          <h3>{tr("Opponent's plan", "Plano do oponente")}</h3>
          <ul className="small">
            {book.opponentPlan.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h3>{tr("Fact sheet", "Ficha técnica (em inglês)")}</h3>
          <pre className="fact-sheet">{book.facts}</pre>
        </div>
      )}
    </div>
  );
}
