// The note that army value, losses and fight results are estimates, with a link to how they were measured.
import { tr } from "@replay-altar/core/i18n";
import { api } from "./api.ts";

const MEASURED_URL = "https://github.com/bubunuh/replay-altar/blob/main/docs/DATA.md#how-accurate-the-estimates-are";

export function EstimatesNote() {
  return (
    <p className="sub estimates-note">
      {tr(
        "≈ Army value, losses and fight results are estimates: a replay records the players' orders but no deaths, so they are reconstructed by simulating the game. Against the game's own counts, army value is typically off by about 25%. ",
        "≈ Valor do exército, perdas e resultados das lutas são estimativas: o replay registra as ordens dos jogadores, mas nenhuma morte, então eles são reconstruídos simulando a partida. Comparado com as contagens do próprio jogo, o valor do exército costuma errar em cerca de 25%. ",
        "≈ El valor del ejército, las pérdidas y los resultados de los combates son estimaciones: el replay registra las órdenes de los jugadores pero ninguna muerte, así que se reconstruyen simulando la partida. Frente a los recuentos del propio juego, el valor del ejército suele desviarse en torno a un 25%. ",
        "≈ La valeur de l'armée, les pertes et les résultats des combats sont des estimations : le replay enregistre les ordres des joueurs mais aucune mort, ils sont donc reconstitués en simulant la partie. Comparée aux décomptes du jeu lui-même, la valeur de l'armée s'écarte en général d'environ 25 %. ",
      )}
      <button className="linklike" onClick={() => api.openUrl(MEASURED_URL)}>
        {tr("How it was measured", "Como foi medido", "Cómo se midió", "Comment c'est mesuré")}
      </button>
    </p>
  );
}
