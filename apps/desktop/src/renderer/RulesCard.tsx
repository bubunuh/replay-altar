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
        <h2>{tr("Findings", "Análise", "Análisis", "Analyse")}</h2>
        <p className="sub">{tr("Not available", "Indisponível", "No disponible", "Non disponible")}: {book.problem}.</p>
      </div>
    );
  }
  return (
    <div className="card rules-card">
      <h2>
        {tr("Findings", "Análise", "Análisis", "Analyse")} <Tip text={tr("Computed by Replay Altar's rules from the replay, compared with pro games of your matchup. Most important first.", "Calculada pelas regras do Replay Altar a partir do replay, comparando com partidas de pros do seu confronto. O mais importante primeiro.", "Calculado por las reglas de Replay Altar a partir del replay, comparado con partidas de pros de tu enfrentamiento. Lo más importante primero.", "Calculé par les règles de Replay Altar à partir du replay, comparé aux parties de pros de votre matchup. Le plus important en premier.")} />
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
                <b data-tip={tr("Facts from elsewhere in the game that explain this finding.", "Fatos de outros momentos da partida que explicam este problema.", "Hechos de otros momentos de la partida que explican este problema.", "Des faits ailleurs dans la partie qui expliquent ce problème.")}>{tr("Why", "Por quê", "Por qué", "Pourquoi")}</b> {f.because.join(" ")}
              </p>
            )}
            {f.advice && (
              <p className="small">
                <b>{tr("Next time", "Na próxima", "La próxima vez", "La prochaine fois")}</b> {f.advice}
              </p>
            )}
          </li>
        ))}
      </ol>
      {book.turningPoint && (
        <p className="small">
          <b data-tip={tr("The fight with the biggest swing against the side that lost; jump to it in the replay.", "A luta com a maior virada contra quem perdeu; vá até ela no replay.", "El combate con la mayor diferencia en contra del lado que perdió; ve a él en el replay.", "Le combat avec le plus gros basculement contre le camp qui a perdu ; retrouvez-le dans le replay.")}>{tr("Turning point", "Ponto de virada", "Momento decisivo", "Tournant")}</b> {book.turningPoint}
        </p>
      )}
      {book.oneThing && (
        <p className="one-thing">
          <b>{tr("One thing for next game", "Uma coisa para a próxima partida", "Una cosa para la próxima partida", "Une chose pour la prochaine partie")}</b> {book.oneThing}
        </p>
      )}
      {book.strengths.length > 0 && (
        <div className="rules-strengths">
          <h3>
            {tr("Strengths", "Pontos fortes", "Puntos fuertes", "Points forts")} <Tip text={tr("Where this game beat most pro games of your matchup (and nothing a finding above contradicts).", "Onde esta partida superou a maioria das partidas de pros do seu confronto (e nada na análise acima contradiz).", "Donde esta partida superó a la mayoría de las partidas de pros de tu enfrentamiento (y nada de lo de arriba lo contradice).", "Là où cette partie a fait mieux que la plupart des parties de pros de votre matchup (sans contredire ce qui est relevé plus haut).")} />
          </h3>
          <ul className="small">
            {book.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      <button className="btn" onClick={() => setMore((x) => !x)} data-tip={tr("The opponent's plan from their orders, and every number the rules used.", "O plano do oponente pelas ordens dele, e todos os números que as regras usaram.", "El plan del rival a partir de sus órdenes, y cada número que usaron las reglas.", "Le plan de l'adversaire d'après ses ordres, et chaque nombre utilisé par les règles.")}>
        {more ? tr("Show less", "Mostrar menos", "Mostrar menos", "Afficher moins") : tr("Show more", "Mostrar mais", "Mostrar más", "Afficher plus")}
      </button>
      {more && (
        <div className="rules-more">
          <h3>{tr("Opponent's plan", "Plano do oponente", "Plan del rival", "Plan de l'adversaire")}</h3>
          <ul className="small">
            {book.opponentPlan.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h3>{tr("Fact sheet", "Ficha técnica (em inglês)", "Ficha técnica (en inglés)", "Fiche technique (en anglais)")}</h3>
          <pre className="fact-sheet">{book.facts}</pre>
        </div>
      )}
    </div>
  );
}
