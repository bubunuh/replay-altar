// The map of a match: the terrain image with what the game's minimap marks on top (gold mines,
// shops, start locations, creep camps coloured by strength). Clicked, it opens wide with what
// happened where: the players' fights (size by resources lost, colour by who came out ahead)
// and the creep camps each player cleared, in order; each layer can be switched on and off.
import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { mmss } from "./format.ts";
import { tr } from "@replay-altar/core/i18n";
import { Tip } from "./Tip.tsx";
import type { MapMarker } from "../mapOverlay.ts";
import type { MapActivity, MapFight } from "../mapActivity.ts";

/** In-game camp colours by total creep level. */
const campClass = (level = 0) => (level < 10 ? "camp-easy" : level < 20 ? "camp-mid" : "camp-hard");

/** Share of the fight's losses that were theirs: above 0.6 you likely won it, below 0.4 likely lost. */
const outcome = (f: MapFight) => {
  const share = f.them / Math.max(1, f.you + f.them);
  return share >= 0.6 ? "won" : share <= 0.4 ? "lost" : "even";
};
const OUTCOME_TEXT = { won: tr("likely won", "provavelmente ganhou", "probablemente ganado", "probablement gagné"), lost: tr("likely lost", "provavelmente perdeu", "probablemente perdido", "probablement perdu"), even: tr("about even", "equilibrada", "parejo", "équilibré") } as const;

type Layer = "map" | "fights" | "mine" | "theirs";
const LAYERS: [Layer, string, string][] = [
  ["map", tr("Map", "Mapa", "Mapa", "Carte"), tr("Gold mines, shops, start locations and creep camps.", "Minas de ouro, lojas, posições iniciais e acampamentos de creeps.", "Minas de oro, tiendas, posiciones iniciales y campamentos de creeps.", "Mines d'or, boutiques, positions de départ et camps de creeps.")],
  ["fights", tr("Fights", "Lutas", "Combates", "Combats"), tr("Fights between you: bigger circle = more resources lost in it; green: you likely won it, red: likely lost, grey: about even.", "Lutas entre vocês: círculo maior = mais recursos perdidos nela; verde: você provavelmente ganhou, vermelho: provavelmente perdeu, cinza: equilibrada.", "Combates entre tú y tu rival: círculo más grande = más recursos perdidos en él; verde: probablemente lo ganaste, rojo: probablemente lo perdiste, gris: parejo.", "Combats entre vous et l'adversaire : plus le cercle est grand, plus il y a eu de ressources perdues ; vert : probablement gagné, rouge : probablement perdu, gris : équilibré.")],
  ["mine", tr("Your creeping", "Seu creep", "Tu creepeo", "Votre creep"), tr("The creep camps you cleared, numbered in order and joined in that order.", "Os acampamentos que você limpou, numerados e ligados na ordem.", "Los campamentos de creeps que limpiaste, numerados en orden y unidos en ese orden.", "Les camps de creeps que vous avez nettoyés, numérotés et reliés dans l'ordre.")],
  ["theirs", tr("Their creeping", "Creep deles", "Su creepeo", "Son creep"), tr("The creep camps your opponent cleared, numbered in order and joined in that order.", "Os acampamentos que o oponente limpou, numerados e ligados na ordem.", "Los campamentos de creeps que limpió tu rival, numerados en orden y unidos en ese orden.", "Les camps de creeps que votre adversaire a nettoyés, numérotés et reliés dans l'ordre.")],
];

export function MapView({ mapFile, gameKey }: { mapFile: string; gameKey: string }) {
  // undefined while loading; null when this map has no extracted data (yet).
  const [image, setImage] = useState<string | null | undefined>(undefined);
  const [markers, setMarkers] = useState<MapMarker[] | null>(null);
  const [activity, setActivity] = useState<MapActivity | null | undefined>(undefined);
  const [large, setLarge] = useState(false);
  const [shown, setShown] = useState<Set<Layer>>(new Set(["map", "fights", "mine", "theirs"]));
  useEffect(() => {
    setImage(undefined);
    setMarkers(null);
    setActivity(undefined);
    api.mapImage(mapFile).then(setImage);
    api.mapMarkers(mapFile).then(setMarkers);
  }, [mapFile, gameKey]);
  useEffect(() => {
    if (large && activity === undefined) api.mapActivity(gameKey).then(setActivity);
  }, [large, gameKey, activity]);
  if (image === undefined) return null;
  if (image === null)
    return (
      <figure className="map-view">
        <div className="map-missing">
          {tr(
            "No map picture: this game's map isn't prepared on this computer. Press \"Simulate again\" to prepare it.",
            "Sem imagem do mapa: o mapa desta partida não está preparado neste computador. Clique em \"Simular de novo\" para prepará-lo.",
            "Sin imagen del mapa: el mapa de esta partida no está preparado en este equipo. Pulsa \"Simular otra vez\" para prepararlo.",
            "Pas d'image de la carte : la carte de cette partie n'est pas préparée sur cet ordinateur. Cliquez sur « Simuler à nouveau » pour la préparer.",
          )}
        </div>
      </figure>
    );
  const name = mapFile.replace(/^\d*_?w3c_\d+_\d+_/, "").replace(/\.w3[xm]$/, "").replace(/_/g, " ");
  const on = (l: Layer) => shown.has(l) && (l === "map" || large);
  const toggle = (l: Layer) =>
    setShown((s) => {
      const next = new Set(s);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });

  const route = (side: "me" | "opp") => {
    const camps = (activity?.camps ?? []).filter((c) => c.by === side);
    if (!camps.length) return null;
    return (
      <g className={`route ${side}`}>
        <polyline points={camps.map((c) => `${c.x * 100},${c.y * 100}`).join(" ")} />
        {camps.map((c) => (
          <g key={c.order}>
            <circle cx={c.x * 100} cy={c.y * 100} r={1.9}>
              <title>{side === "me" ? tr(`Your camp #${c.order}, cleared ≈${mmss(c.at)} (creep level ${c.level})`, `Seu acampamento nº ${c.order}, limpo ≈${mmss(c.at)} (nível dos creeps ${c.level})`, `Tu campamento n.º ${c.order}, limpiado ≈${mmss(c.at)} (nivel de creeps ${c.level})`, `Votre camp n° ${c.order}, nettoyé ≈${mmss(c.at)} (niveau des creeps ${c.level})`) : tr(`Their camp #${c.order}, cleared ≈${mmss(c.at)} (creep level ${c.level})`, `Acampamento deles nº ${c.order}, limpo ≈${mmss(c.at)} (nível dos creeps ${c.level})`, `Su campamento n.º ${c.order}, limpiado ≈${mmss(c.at)} (nivel de creeps ${c.level})`, `Son camp n° ${c.order}, nettoyé ≈${mmss(c.at)} (niveau des creeps ${c.level})`)}</title>
            </circle>
            <text x={c.x * 100} y={c.y * 100 + 0.75}>{c.order}</text>
          </g>
        ))}
      </g>
    );
  };

  return (
    <figure className={large ? "map-view large" : "map-view"}>
      {large && (
        <div className="map-layers">
          {LAYERS.map(([l, label, tip]) => (
            <label key={l} data-tip={tip}>
              <input type="checkbox" checked={shown.has(l)} onChange={() => toggle(l)} />
              <span className={`layer-key ${l}`} />
              {label}
            </label>
          ))}
          {activity === null && <span className="muted small">{tr("No fight or creeping data for this game (it needs the simulation).", "Sem dados de lutas ou creep nesta partida (precisa da simulação).", "No hay datos de combates ni de creepeo para esta partida (necesita la simulación).", "Pas de données de combats ni de creep pour cette partie (il faut la simulation).")}</span>}
        </div>
      )}
      <div className="map-frame" onClick={() => setLarge((x) => !x)} title={large ? tr("Click to shrink", "Clique para diminuir", "Haz clic para reducir", "Cliquez pour réduire") : tr("Click to enlarge and see fights and creeping", "Clique para ampliar e ver as lutas e o creep", "Haz clic para ampliar y ver los combates y el creepeo", "Cliquez pour agrandir et voir les combats et le creep")}>
        <img src={image} alt={`Map: ${name}`} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {on("map") &&
            markers?.map((m, i) => {
              const x = m.x * 100;
              const y = m.y * 100;
              if (m.kind === "gold") return <circle key={i} cx={x} cy={y} r={2.2} className="mk-gold"><title>{m.label}</title></circle>;
              if (m.kind === "start") return <circle key={i} cx={x} cy={y} r={3.2} className="mk-start"><title>{m.label}</title></circle>;
              if (m.kind === "shop") return <rect key={i} x={x - 1.4} y={y - 1.4} width={2.8} height={2.8} className="mk-shop"><title>{m.label}</title></rect>;
              return <circle key={i} cx={x} cy={y} r={1.5} className={`mk-camp ${campClass(m.level)}`}><title>{tr(`Creep camp, level ${m.level}: ${m.label}`, `Acampamento de creeps, nível ${m.level}: ${m.label}`, `Campamento de creeps, nivel ${m.level}: ${m.label}`, `Camp de creeps, niveau ${m.level} : ${m.label}`)}</title></circle>;
            })}
          {on("theirs") && route("opp")}
          {on("mine") && route("me")}
          {on("fights") &&
            activity?.fights.map((f, i) => {
              const r = Math.min(7, Math.max(1.4, Math.sqrt(f.you + f.them) / 9));
              return (
                <circle key={i} cx={f.x * 100} cy={f.y * 100} r={r} className={`mk-fight ${outcome(f)}`}>
                  <title>{tr(`${mmss(f.start)} ${f.label}: you lost ≈${f.you}, they lost ≈${f.them} (${OUTCOME_TEXT[outcome(f)]})`, `${mmss(f.start)} ${f.label}: você perdeu ≈${f.you}, eles perderam ≈${f.them} (${OUTCOME_TEXT[outcome(f)]})`, `${mmss(f.start)} ${f.label}: perdiste ≈${f.you}, perdieron ≈${f.them} (${OUTCOME_TEXT[outcome(f)]})`, `${mmss(f.start)} ${f.label} : vous avez perdu ≈${f.you}, lui ≈${f.them} (${OUTCOME_TEXT[outcome(f)]})`)}</title>
                </circle>
              );
            })}
        </svg>
      </div>
      <figcaption>
        {name}{" "}
        <Tip
          text={
            large
              ? tr("Switch layers on and off above the map. Hover a marker for details. Click the map to shrink it.", "Ligue e desligue as camadas acima do mapa. Passe o mouse num marcador para ver detalhes. Clique no mapa para diminuí-lo.", "Activa y desactiva las capas encima del mapa. Pasa el cursor por un marcador para ver los detalles. Haz clic en el mapa para reducirlo.", "Activez et désactivez les calques au-dessus de la carte. Survolez un repère pour les détails. Cliquez sur la carte pour la réduire.")
              : tr("Yellow: gold mines. White squares: shops, taverns and other neutral buildings. Blue rings: start locations. Dots: creep camps, green, orange or red from weak to strong (hover one for its creeps). Click the map to open it with the fights and each player's creeping.", "Amarelo: minas de ouro. Quadrados brancos: lojas, tavernas e outras construções neutras. Anéis azuis: posições iniciais. Pontos: acampamentos de creeps, verde, laranja ou vermelho do mais fraco ao mais forte (passe o mouse para ver os creeps). Clique no mapa para abri-lo com as lutas e o creep de cada jogador.", "Amarillo: minas de oro. Cuadrados blancos: tiendas, tabernas y otros edificios neutrales. Anillos azules: posiciones iniciales. Puntos: campamentos de creeps, verdes, naranjas o rojos de débiles a fuertes (pasa el cursor por uno para ver sus creeps). Haz clic en el mapa para abrirlo con los combates y el creepeo de cada jugador.", "Jaune : mines d'or. Carrés blancs : boutiques, tavernes et autres bâtiments neutres. Anneaux bleus : positions de départ. Points : camps de creeps, verts, orange ou rouges du plus faible au plus fort (survolez-en un pour voir ses creeps). Cliquez sur la carte pour l'ouvrir avec les combats et le creep de chaque joueur.")
          }
        />
      </figcaption>
    </figure>
  );
}
