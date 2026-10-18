// Writes data/gamedata/combat.json: each melee unit's cost (gold + lumber), armor type, attack
// types (and whether they hit air or ground) and whether it flies, plus the game's
// attack-vs-armor damage table. Read from the tables scripts/extract-gamedata.sh copies out of
// your install (unitbalance.slk, unitweapons.slk, unitdata.slk, miscgame.txt). Re-run after a
// game patch:
//
//   node scripts/extract-combat.ts
import { readFileSync, writeFileSync, mkdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@replay-altar/core";
import { parseSlk } from "../packages/sim/src/slk.ts";

const dir = join(dataDir(), "sim/gamedata/current");
const read = (f: string) => parseSlk(readFileSync(join(dir, f), "latin1"));
const RACES: Record<string, string> = { human: "H", orc: "O", undead: "U", nightelf: "N" };

// miscgame.txt: DamageBonus<Attack>=small,medium,large,fort,normal,hero,divine,none
const ARMOR_ORDER = ["small", "medium", "large", "fort", "normal", "hero", "divine", "none"];
const misc = readFileSync(join(dir, "miscgame.txt"), "latin1");
const damage: Record<string, Record<string, number>> = {};
for (const m of misc.matchAll(/^DamageBonus(Normal|Pierce|Siege|Magic|Chaos|Spells|Hero)=([\d.,]+)/gm)) {
  const values = m[2].split(",").map(Number);
  damage[m[1].toLowerCase()] = Object.fromEntries(ARMOR_ORDER.map((a, i) => [a, values[i]]));
}

const balance = new Map(read("unitbalance.slk").map((r) => [r.unitBalanceID, r]));
const weapons = new Map(read("unitweapons.slk").map((r) => [r.unitWeaponID, r]));
const units: Record<string, unknown> = {};
for (const d of read("unitdata.slk")) {
  const race = RACES[d.race];
  const b = balance.get(d.unitID);
  const w = weapons.get(d.unitID);
  if (!race || !b || !w || !d.targType || /structure/.test(d.targType) || /ward/.test(d.targType)) continue;
  if (!/^[hoeuHOEU]/.test(d.unitID)) continue;
  const on = Number(w.weapsOn ?? 0);
  const attacks = [1, 2]
    .filter((i) => on & i)
    .map((i) => ({ type: w[`atkType${i}`], air: /air/.test(w[`targs${i}`] ?? ""), ground: /ground/.test(w[`targs${i}`] ?? "") }))
    .filter((a) => a.type && a.type !== "_" && (a.air || a.ground));
  units[d.unitID] = { race, cost: Number(b.goldcost ?? 0) + Number(b.lumbercost ?? 0), armor: b.defType, air: d.movetp === "fly", hero: /^[A-Z]/.test(d.unitID), attacks };
}

const out = join(import.meta.dirname, "../data/gamedata/combat.json");
mkdirSync(join(out, ".."), { recursive: true });
writeFileSync(out, JSON.stringify({ gameVersion: readlinkSync(dir), damage, units }, null, 1) + "\n");
console.log(`wrote ${out}: ${Object.keys(units).length} units`);
