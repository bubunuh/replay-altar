// A player's heroes as portraits with the level they reached, like the game's score screen.
import { useEffect, useState } from "react";
import type { PlayerRecord } from "@replay-altar/core/ui";
import { api } from "./api.ts";

let loaded: Promise<Record<string, string>> | null = null;

export function HeroIcons({ p }: { p: PlayerRecord }) {
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    loaded ??= api.heroIcons();
    loaded.then(setIcons);
  }, []);
  const heroes = [...p.heroes].sort((a, b) => a.order - b.order);
  if (!heroes.length) return null;
  return (
    <div className="hero-icons">
      {heroes.map((h) => (
        <span key={h.order} className="hero-icon" data-tip={`${h.name}, level ${h.level}`}>
          {icons[h.code] ? <img src={icons[h.code]} alt={h.name} /> : <span className="hero-name">{h.name}</span>}
          <span className="hero-level">{h.level}</span>
        </span>
      ))}
    </div>
  );
}
