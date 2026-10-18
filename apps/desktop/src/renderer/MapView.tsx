// The map of a match: the terrain image with what the game's minimap marks on top (gold mines,
// shops, start locations, creep camps coloured by strength). Click to enlarge.
import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { Tip } from "./Tip.tsx";
import type { MapMarker } from "../mapOverlay.ts";

/** In-game camp colours by total creep level. */
const campClass = (level = 0) => (level < 10 ? "camp-easy" : level < 20 ? "camp-mid" : "camp-hard");

export function MapView({ mapFile }: { mapFile: string }) {
  const [image, setImage] = useState<string | null>(null);
  const [markers, setMarkers] = useState<MapMarker[] | null>(null);
  const [large, setLarge] = useState(false);
  useEffect(() => {
    setImage(null);
    setMarkers(null);
    api.mapImage(mapFile).then(setImage);
    api.mapMarkers(mapFile).then(setMarkers);
  }, [mapFile]);
  if (!image) return null;
  const name = mapFile.replace(/^\d*_?w3c_\d+_\d+_/, "").replace(/\.w3[xm]$/, "").replace(/_/g, " ");
  return (
    <figure className={large ? "map-view large" : "map-view"}>
      <div className="map-frame" onClick={() => setLarge((x) => !x)} title={large ? "Click to shrink" : "Click to enlarge"}>
      <img src={image} alt={`Map: ${name}`} />
      {markers && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {markers.map((m, i) => {
            const x = m.x * 100;
            const y = m.y * 100;
            if (m.kind === "gold") return <circle key={i} cx={x} cy={y} r={2.2} className="mk-gold"><title>{m.label}</title></circle>;
            if (m.kind === "start") return <circle key={i} cx={x} cy={y} r={3.2} className="mk-start"><title>{m.label}</title></circle>;
            if (m.kind === "shop") return <rect key={i} x={x - 1.4} y={y - 1.4} width={2.8} height={2.8} className="mk-shop"><title>{m.label}</title></rect>;
            return <circle key={i} cx={x} cy={y} r={1.5} className={`mk-camp ${campClass(m.level)}`}><title>{`Creep camp, level ${m.level}: ${m.label}`}</title></circle>;
          })}
        </svg>
      )}
      </div>
      <figcaption>
        {name} <Tip text="Yellow: gold mines. White squares: shops, taverns and other neutral buildings. Blue rings: start locations. Dots: creep camps, green, orange or red from weak to strong (hover one for its creeps). Click the map to enlarge it." />
      </figcaption>
    </figure>
  );
}
