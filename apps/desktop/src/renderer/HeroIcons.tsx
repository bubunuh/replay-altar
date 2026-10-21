// A player's heroes as portraits with the level they reached, like the game's score screen.
import { useEffect, useState } from "react";
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import { api } from "./api.ts";
import { mmss } from "./format.ts";
import { tr } from "@replay-altar/core/i18n";

let loaded: Promise<Record<string, string>> | null = null;

/** Name and level, skill order with times, and deaths (from the simulation) for a portrait's tooltip. */
function heroTip(h: PlayerRecord["heroes"][number], deaths: { diedAt: number; revivedAt: number | null }[]) {
  const lines = [tr(`${h.name}, level ${h.level}`, `${h.name}, nível ${h.level}`, `${h.name}, nivel ${h.level}`, `${h.name}, niveau ${h.level}`)];
  if (h.skills.length) lines.push(`${tr("Skills", "Habilidades", "Habilidades", "Compétences")}: ${h.skills.map((s) => `${s.name} ${mmss(s.ms)}`).join(" · ")}`);
  lines.push(
    deaths.length
      ? `${tr("Died", "Morreu", "Murió", "Mort")}: ${deaths.map((d) => `≈${mmss(d.diedAt)}${d.revivedAt !== null ? tr(` (back ${mmss(d.revivedAt)})`, ` (voltou ${mmss(d.revivedAt)})`, ` (volvió a ${mmss(d.revivedAt)})`, ` (revenu à ${mmss(d.revivedAt)})`) : ""}`).join(", ")}`
      : tr("Never died", "Nunca morreu", "Nunca murió", "Jamais mort"),
  );
  return lines.join("\n");
}

export function HeroIcons({ p, record }: { p: PlayerRecord; record: GameRecord }) {
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    loaded ??= api.heroIcons();
    loaded.then(setIcons);
  }, []);
  const heroes = [...p.heroes].sort((a, b) => a.order - b.order);
  const sim = record.sim?.status === "ok" ? record.sim.players.find((x) => x.playerId === p.playerId)?.heroes ?? [] : [];
  if (!heroes.length) return null;
  return (
    <div className="hero-icons">
      {heroes.map((h) => (
        <span key={h.order} className="hero-icon" data-tip={heroTip(h, sim.find((x) => x.code === h.code)?.deaths ?? [])}>
          {icons[h.code] ? <img src={icons[h.code]} alt={h.name} /> : <span className="hero-name">{h.name}</span>}
          <span className="hero-level">{h.level}</span>
        </span>
      ))}
    </div>
  );
}
