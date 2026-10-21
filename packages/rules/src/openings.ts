// Names a player's opening from their first orders, after Liquipedia's build-order pages
// (Common build orders: fast altar "standard", tavern hero, fast Riflemen/Headhunters/Huntresses,
// Fiend or Ghoul openings, fast expand, fast tech). Gives the model a plan to describe instead
// of a list of orders. Tower positions are not known, so "tower rush" is not claimed.
import type { PlayerRecord } from "@replay-altar/core/ui";
import { RACES, type RaceCode } from "@replay-altar/core/gamedata";
import { tr, trTable } from "@replay-altar/core/i18n";
import { mmss } from "./series.ts";

const ALTAR: Record<RaceCode, string> = { H: "halt", O: "oalt", U: "uaod", N: "eate" };
/** The tier-1.5 unit whose early arrival names an opening. */
const SIGNATURE: Record<RaceCode, Record<string, string>> = {
  H: trTable({ hrif: ["fast Riflemen", "Riflemen rápidos", "Riflemen rápidos", "Riflemen rapides"] }),
  O: trTable({ ohun: ["Headhunter opening", "abertura de Headhunters", "apertura de Headhunters", "ouverture Headhunters"] }),
  U: trTable({ ucry: ["Fiend opening", "abertura de Fiends", "apertura de Fiends", "ouverture Fiends"], ugho: ["Ghoul opening", "abertura de Ghouls", "apertura de Ghouls", "ouverture Ghouls"] }),
  N: trTable({ esen: ["fast Huntresses", "Huntresses rápidas", "Huntresses rápidas", "Huntresses rapides"] }),
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
  if (firstHero && /^N/.test(firstHero.code)) labels.push(tr(`tavern hero first (${firstHero.name})`, `herói da taverna primeiro (${firstHero.name})`, `héroe de taberna primero (${firstHero.name})`, `héros de taverne en premier (${firstHero.name})`));
  else if (altar !== null && (production[0]?.ms ?? Infinity) >= altar) labels.push(tr("fast altar (standard)", "altar rápido (padrão)", "altar rápido (estándar)", "autel rapide (standard)"));
  else if (production[0]) labels.push(tr(`${production[0].name} before the altar`, `${production[0].name} antes do altar`, `${production[0].name} antes del altar`, `${production[0].name} avant l'autel`));

  const early = production.filter((x) => x.ms <= 90_000);
  if (early.length >= 2) labels.push(tr(`${early.length}× ${early[0].name} by ${mmss(early.at(-1)!.ms)} (early pressure)`, `${early.length}× ${early[0].name} até ${mmss(early.at(-1)!.ms)} (pressão cedo)`, `${early.length}× ${early[0].name} antes de ${mmss(early.at(-1)!.ms)} (presión temprana)`, `${early.length}× ${early[0].name} avant ${mmss(early.at(-1)!.ms)} (pression précoce)`));

  const army = b.filter((x) => x.kind === "unit" && x.code !== r.worker && x.ms <= OPENING_MS);
  const sig = army.find((x) => SIGNATURE[race][x.code]);
  if (sig && army.indexOf(sig) <= 1) labels.push(tr(`${SIGNATURE[race][sig.code]} (first at ${mmss(sig.ms)})`, `${SIGNATURE[race][sig.code]} (primeiro às ${mmss(sig.ms)})`, `${SIGNATURE[race][sig.code]} (el primero a ${mmss(sig.ms)})`, `${SIGNATURE[race][sig.code]} (le premier à ${mmss(sig.ms)})`));

  const hall = first((x) => x.kind === "building" && r.townHalls.includes(x.code));
  if (hall !== null && hall <= 270_000) labels.push(tr(`fast expand (${mmss(hall)})`, `expansão rápida (${mmss(hall)})`, `expansión rápida (${mmss(hall)})`, `expansion rapide (${mmss(hall)})`));

  const tier2 = first((x) => x.code === r.tier2);
  if (tier2 !== null && tier2 <= 210_000) {
    const supply = b.filter((x) => x.code === r.supply && x.ms < tier2).length;
    labels.push(tr(`fast tech: tier 2 at ${mmss(tier2)} on ${supply} supply building${supply === 1 ? "" : "s"}`, `fast tech: tier 2 às ${mmss(tier2)} com ${supply} ${supply === 1 ? "prédio" : "prédios"} de food`, `tecnología rápida: tier 2 a ${mmss(tier2)} con ${supply} edificio${supply === 1 ? "" : "s"} de food`, `tech rapide : tier 2 à ${mmss(tier2)} avec ${supply} bâtiment${supply === 1 ? "" : "s"} de food`));
  }

  const towers = b.filter((x) => r.towers.includes(x.code) && x.ms <= 210_000);
  if (towers.length >= 2) labels.push(tr(`early towers: ${towers.length} tower orders by ${mmss(towers.at(-1)!.ms)}`, `torres cedo: ${towers.length} ordens de torre até ${mmss(towers.at(-1)!.ms)}`, `torres tempranas: ${towers.length} órdenes de torre antes de ${mmss(towers.at(-1)!.ms)}`, `tours précoces : ${towers.length} ordres de tour avant ${mmss(towers.at(-1)!.ms)}`));

  const noArmy = !b.some((x) => x.kind === "unit" && x.code !== r.worker && x.ms <= 300_000);
  if (noArmy) labels.push(tr("no army units in the first 5 minutes", "nenhuma unidade de exército nos primeiros 5 minutos", "sin unidades de ejército en los primeros 5 minutos", "aucune unité d'armée dans les 5 premières minutes"));
  return labels;
}
