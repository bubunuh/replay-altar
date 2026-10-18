// Names a player's opening from their first orders, after Liquipedia's build-order pages
// (Common build orders: fast altar "standard", tavern hero, fast Riflemen/Headhunters/Huntresses,
// Fiend or Ghoul openings, fast expand, fast tech). Gives the model a plan to describe instead
// of a list of orders. Tower positions are not known, so "tower rush" is not claimed.
import type { PlayerRecord } from "@replay-altar/core/ui";
import { RACES, type RaceCode } from "@replay-altar/core/gamedata";
import { mmss } from "./series.ts";

const ALTAR: Record<RaceCode, string> = { H: "halt", O: "oalt", U: "uaod", N: "eate" };
/** The tier-1.5 unit whose early arrival names an opening. */
const SIGNATURE: Record<RaceCode, Record<string, string>> = {
  H: { hrif: "fast Riflemen" },
  O: { ohun: "Headhunter opening" },
  U: { ucry: "Fiend opening", ugho: "Ghoul opening" },
  N: { esen: "fast Huntresses" },
};
const OPENING_MS = 4 * 60_000;

/** Short labels with the orders that show them, e.g. ["fast altar (standard)", "fast tech: tier 2 at 3:00 on 2 supply buildings"]. */
export function openingOf(p: PlayerRecord): string[] {
  const race = p.race as RaceCode;
  const r = RACES[race];
  if (!r) return [];
  const b = p.build;
  const first = (pred: (x: (typeof b)[number]) => boolean) => b.find(pred)?.ms ?? null;
  const altar = first((x) => x.code === ALTAR[race]);
  const production = b.filter((x) => r.production.includes(x.code));
  const labels: string[] = [];

  const firstHero = [...p.heroes].sort((a, c) => (a.levelUps[0] ?? Infinity) - (c.levelUps[0] ?? Infinity))[0];
  if (firstHero && /^N/.test(firstHero.code)) labels.push(`tavern hero first (${firstHero.name})`);
  else if (altar !== null && (production[0]?.ms ?? Infinity) >= altar) labels.push("fast altar (standard)");
  else if (production[0]) labels.push(`${production[0].name} before the altar`);

  const early = production.filter((x) => x.ms <= 90_000);
  if (early.length >= 2) labels.push(`${early.length}× ${early[0].name} by ${mmss(early.at(-1)!.ms)} (early pressure)`);

  const army = b.filter((x) => x.kind === "unit" && x.code !== r.worker && x.ms <= OPENING_MS);
  const sig = army.find((x) => SIGNATURE[race][x.code]);
  if (sig && army.indexOf(sig) <= 1) labels.push(`${SIGNATURE[race][sig.code]} (first at ${mmss(sig.ms)})`);

  const hall = first((x) => x.kind === "building" && r.townHalls.includes(x.code));
  if (hall !== null && hall <= 270_000) labels.push(`fast expand (${mmss(hall)})`);

  const tier2 = first((x) => x.code === r.tier2);
  if (tier2 !== null && tier2 <= 210_000) {
    const supply = b.filter((x) => x.code === r.supply && x.ms < tier2).length;
    labels.push(`fast tech: tier 2 at ${mmss(tier2)} on ${supply} supply building${supply === 1 ? "" : "s"}`);
  }

  const towers = b.filter((x) => r.towers.includes(x.code) && x.ms <= 210_000);
  if (towers.length >= 2) labels.push(`early towers: ${towers.length} tower orders by ${mmss(towers.at(-1)!.ms)}`);

  const noArmy = !b.some((x) => x.kind === "unit" && x.code !== r.worker && x.ms <= 300_000);
  if (noArmy) labels.push("no army units in the first 5 minutes");
  return labels;
}
