// Race crests from the game (scripts/extract-gamedata.sh copies them out); the race's name as
// text until they are there. Loaded once for the whole app.
import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { RACE } from "./format.ts";

let loaded: Promise<Record<string, string>> | null = null;

export function RaceIcon({ race, size = "large" }: { race?: string | null; size?: "large" | "small" }) {
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    loaded ??= api.raceIcons();
    loaded.then(setIcons);
  }, []);
  const name = RACE[race ?? ""] ?? race ?? "?";
  return race && icons[race] ? <img className={`race-icon ${size}`} src={icons[race]} alt={name} data-tip={name} /> : <span className="muted">{name}</span>;
}
