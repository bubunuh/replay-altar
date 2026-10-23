// Race crests from the game (scripts/extract-gamedata.ts copies them out); the race's name as
// text until they are there. Loaded once for the whole app.
import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { RACE } from "./format.ts";

let loaded: Promise<Record<string, string>> | null = null;

export function RaceIcon({ race, size = "large" }: { race?: string | null; size?: "large" | "small" }) {
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    // Kept once there are any: on a first start the game data (and these pictures) arrive while
    // the window is already open, so an empty answer is asked again next time.
    loaded ??= api.raceIcons().then((x) => {
      if (!Object.keys(x).length) loaded = null;
      return x;
    });
    loaded.then(setIcons);
  }, []);
  const name = RACE[race ?? ""] ?? race ?? "?";
  return race && icons[race] ? <img className={`race-icon ${size}`} src={icons[race]} alt={name} data-tip={name} /> : <span className="muted">{name}</span>;
}
