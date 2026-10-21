// Army composition against the opponent's: attack type vs armor type (the game's damage table,
// data/gamedata/combat.json from scripts/extract-combat.ts) and who can hit air. Compositions
// come from train orders in a time window, weighted by cost; deaths are not subtracted, so a
// window of the last few minutes stands for the army on the field.
import type { PlayerRecord } from "@replay-altar/core/ui";
import { RACES, type RaceCode } from "@replay-altar/core/gamedata";
import { nameOf } from "@replay-altar/core/names";
import { tr, trTable } from "@replay-altar/core/i18n";
import combat from "../../../data/gamedata/combat.json" with { type: "json" };

type Attack = { type: string; air: boolean; ground: boolean };
type UnitData = { race: string; cost: number; armor: string; air: boolean; hero: boolean; attacks: Attack[] };
const UNITS = combat.units as Record<string, UnitData>;
const DAMAGE = combat.damage as Record<string, Record<string, number>>;

/** Fighting units each race trains in melee games, without spellcasters (their damage is in spells). */
export const ROSTER: Record<RaceCode, string[]> = {
  H: ["hfoo", "hrif", "hkni", "hmtm", "hgyr", "hgry", "hdhw", "hspt"],
  O: ["ogru", "ohun", "orai", "ocat", "owyv", "otbr", "otau", "okod"],
  U: ["ugho", "ucry", "ugar", "uabo", "umtw", "uobs", "ubsp", "ufro"],
  N: ["earc", "esen", "ebal", "edry", "edoc", "emtg", "ehip", "ehpr", "efdr", "echm"],
};

export const ARMOR_NAME: Record<string, string> = trTable({
  small: ["light", "leve", "ligera", "légère"], medium: ["medium", "média", "media", "moyenne"], large: ["heavy", "pesada", "pesada", "lourde"], fort: ["fortified", "fortificada", "fortificada", "fortifiée"], hero: ["hero", "de herói", "de héroe", "de héros"], none: ["unarmored", "sem armadura", "sin armadura", "sans armure"], divine: ["divine", "divina", "divina", "divine"], normal: ["normal", "normal", "normal", "normale"],
});
export const ATTACK_NAME: Record<string, string> = trTable({
  normal: ["normal", "normal", "normal", "normale"], pierce: ["piercing", "perfurante", "perforante", "perforante"], siege: ["siege", "de cerco", "de asedio", "de siège"], magic: ["magic", "mágico", "mágico", "magique"], chaos: ["chaos", "caos", "caos", "chaos"], hero: ["hero", "de herói", "de héroe", "de héros"], spells: ["spell", "mágico (feitiço)", "mágico (hechizo)", "magique (sort)"],
});

/** Research that brings air units down for a ground unit to hit: Web (Crypt Fiend), Ensnare (Raider). */
const GROUNDS_AIR: Record<string, string> = { ucry: "Ruwb", orai: "Roen" };

export type MixEntry = { code: string; name: string; count: number; value: number; unit: UnitData };

/** Army units (not workers or heroes; building-only attackers on request) ordered in [from, to], by cost. */
export function armyMix(p: PlayerRecord, from: number, to: number, withBuildingAttackers = false): MixEntry[] {
  const worker = RACES[p.race as RaceCode]?.worker;
  const out = new Map<string, MixEntry>();
  const researched = new Set(p.build.filter((b) => b.kind === "upgrade" && b.ms <= to).map((b) => b.code));
  for (const b of p.build) {
    if (b.kind !== "unit" || b.ms < from || b.ms > to || b.code === worker) continue;
    const unit = UNITS[b.code];
    // Units that only hit buildings (Siege Engine) don't fight armies.
    if (!unit || unit.hero || !unit.cost || (!unit.attacks.length && !withBuildingAttackers)) continue;
    const grounds = GROUNDS_AIR[b.code] && researched.has(GROUNDS_AIR[b.code]);
    const e = out.get(b.code) ?? { code: b.code, name: b.name, count: 0, value: 0, unit: grounds ? { ...unit, attacks: unit.attacks.map((a) => ({ ...a, air: true })) } : unit };
    e.count++;
    e.value += unit.cost;
    out.set(b.code, e);
  }
  return [...out.values()].sort((a, b) => b.value - a.value);
}

export const mixValue = (mix: MixEntry[]) => mix.reduce((n, e) => n + e.value, 0);
export const canHitAir = (u: UnitData) => u.attacks.some((a) => a.air);
const share = (mix: MixEntry[], pred: (u: UnitData) => boolean) => {
  const total = mixValue(mix);
  return total ? mix.filter((e) => pred(e.unit)).reduce((n, e) => n + e.value, 0) / total : 0;
};
export const airShare = (mix: MixEntry[]) => share(mix, (u) => u.air);
export const antiAirShare = (mix: MixEntry[]) => share(mix, canHitAir);

/** Best damage multiplier one unit gets against another (0 when it can't hit it). */
function multiplier(u: UnitData, target: UnitData) {
  const hits = u.attacks.filter((a) => (target.air ? a.air : a.ground));
  return Math.max(0, ...hits.map((a) => DAMAGE[a.type]?.[target.armor] ?? 1));
}

/** Damage multiplier of a unit against a whole army, weighted by the army's cost. */
export function unitVsMix(u: UnitData, against: MixEntry[]) {
  const total = mixValue(against);
  return total ? against.reduce((n, e) => n + multiplier(u, e.unit) * e.value, 0) / total : 1;
}

/** Cost-weighted damage multiplier of one army against another (1 = full damage on average). */
export function mixVsMix(mine: MixEntry[], theirs: MixEntry[]) {
  const total = mixValue(mine);
  return total ? mine.reduce((n, e) => n + unitVsMix(e.unit, theirs) * e.value, 0) / total : 1;
}

/** Roster units of a race that do best against an army, best first. */
export function bestAgainst(race: RaceCode, against: MixEntry[], pred: (u: UnitData) => boolean = () => true) {
  return ROSTER[race]
    .filter((c) => UNITS[c] && pred(UNITS[c]))
    .map((code) => ({ code, name: nameOf(code), unit: UNITS[code], vs: unitVsMix(UNITS[code], against) }))
    .sort((a, b) => b.vs - a.vs)
    .filter((x, i, all) => all.findIndex((y) => y.name === x.name) === i);
}

export const describeMix = (mix: MixEntry[], what: "attack" | "armor", n = 3) =>
  mix
    .slice(0, n)
    .map((e) => {
      const attacks = e.unit.attacks.map((a) => ATTACK_NAME[a.type] ?? a.type).filter((x, i, all) => all.indexOf(x) === i).join("/");
      const armor = e.unit.armor === "none" ? ARMOR_NAME.none : tr(`${ARMOR_NAME[e.unit.armor] ?? e.unit.armor} armor`, `armadura ${ARMOR_NAME[e.unit.armor] ?? e.unit.armor}`, `armadura ${ARMOR_NAME[e.unit.armor] ?? e.unit.armor}`, `armure ${ARMOR_NAME[e.unit.armor] ?? e.unit.armor}`);
      return `${e.name} ×${e.count} (${what === "armor" ? `${armor}${e.unit.air ? tr(", air", ", aérea", ", aéreo", ", aérien") : ""}` : tr(`${attacks} attack`, `ataque ${attacks}`, `ataque ${attacks}`, `attaque ${attacks}`)})`;
    })
    .join(", ");
