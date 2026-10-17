// Melee game data the metrics need: which object IDs are workers, town halls, tiers, etc.
// IDs are the four-character codes the replay records for train/build/upgrade orders.

export type RaceCode = "H" | "O" | "U" | "N";

export const RACE_NAMES: Record<string, string> = {
  H: "Human",
  O: "Orc",
  U: "Undead",
  N: "Night Elf",
  R: "Random",
};

type RaceData = {
  worker: string;
  /** Worker train time and tier-upgrade time in ms (base melee table, game 3.0.0.24268). */
  workerBuildMs: number;
  tierBuildMs: number;
  townHalls: string[]; // tier 1 hall; building a second one is an expansion
  tier2: string;
  tier3: string;
  supply: string;
  production: string[];
  towers: string[];
};

export const RACES: Record<RaceCode, RaceData> = {
  H: {
    worker: "hpea",
    workerBuildMs: 15_000,
    tierBuildMs: 140_000,
    townHalls: ["htow"],
    tier2: "hkee",
    tier3: "hcas",
    supply: "hhou",
    production: ["hbar", "hars", "harm", "hgra"],
    towers: ["hwtw", "hgtw", "hctw", "hatw"],
  },
  O: {
    worker: "opeo",
    workerBuildMs: 15_000,
    tierBuildMs: 140_000,
    townHalls: ["ogre"],
    tier2: "ostr",
    tier3: "ofrt",
    supply: "otrb",
    production: ["obar", "osld", "obea", "otto"],
    towers: ["owtw"],
  },
  U: {
    worker: "uaco",
    workerBuildMs: 15_000,
    tierBuildMs: 140_000,
    townHalls: ["unpl", "ugol"], // Undead usually expand with just a Haunted Gold Mine
    tier2: "unp1",
    tier3: "unp2",
    supply: "uzig",
    production: ["usep", "utod", "uslh", "ubon"],
    towers: ["uzg1", "uzg2"],
  },
  N: {
    worker: "ewsp",
    workerBuildMs: 14_000,
    tierBuildMs: 140_000,
    townHalls: ["etol"],
    tier2: "etoa",
    tier3: "etoe",
    supply: "emow",
    production: ["eaom", "eaoe", "eaow", "edos"],
    towers: ["etrp"],
  },
};

export const isRaceCode = (r: string | undefined): r is RaceCode =>
  r === "H" || r === "O" || r === "U" || r === "N";

// Replay team id used for observers/referees (w3gjs: 24 from patch 1.29, 12 before).
export const observerTeamFor = (subheaderVersion: number) => (subheaderVersion >= 29 ? 24 : 12);

// Host accounts that sit in the observer slot of ladder games.
export const LADDER_HOSTS = { bnet: "Blizzard", w3c: "FLO" } as const;

/** Consumables counted as potions: healing, mana, clarity, restoration, invulnerability, speed, invisibility, omniscience. */
export const POTION_ITEMS = new Set(["phea", "pman", "pnvl", "plcl", "pghe", "pgma", "pres", "pdiv", "pinv", "pspd", "pomn", "pclr"]);
export const TOWN_PORTAL = "stwp";

export type UpgradeKind = "attack" | "armor";

/**
 * Each race's blacksmith-type upgrades (3 levels each), from the game's upgradedata.slk:
 * class "melee"/"ranged" = attack, class "armor" = unit armor (Masonry, for buildings, left out).
 */
export const CORE_UPGRADES: Record<RaceCode, { code: string; kind: UpgradeKind; name: string; detail: string }[]> = {
  H: [
    { code: "Rhme", kind: "attack", name: "Iron Forged Swords", detail: "melee attack" },
    { code: "Rhra", kind: "attack", name: "Black Gunpowder", detail: "ranged attack" },
    { code: "Rhar", kind: "armor", name: "Iron Plating", detail: "heavy armor" },
    { code: "Rhla", kind: "armor", name: "Studded Leather Armor", detail: "medium armor" },
  ],
  O: [
    { code: "Rome", kind: "attack", name: "Steel Melee Weapons", detail: "melee attack" },
    { code: "Rora", kind: "attack", name: "Steel Ranged Weapons", detail: "ranged attack" },
    { code: "Roar", kind: "armor", name: "Steel Unit Armor", detail: "unit armor" },
  ],
  U: [
    { code: "Rume", kind: "attack", name: "Unholy Strength", detail: "melee attack" },
    { code: "Rura", kind: "attack", name: "Creature Attack", detail: "ranged/air attack" },
    { code: "Ruar", kind: "armor", name: "Unholy Armor", detail: "ground armor" },
    { code: "Rucr", kind: "armor", name: "Creature Carapace", detail: "air armor" },
  ],
  N: [
    { code: "Resm", kind: "attack", name: "Strength of the Moon", detail: "melee attack" },
    { code: "Resw", kind: "attack", name: "Strength of the Wild", detail: "ranged attack" },
    { code: "Rema", kind: "armor", name: "Moon Armor", detail: "unit armor" },
    { code: "Rerh", kind: "armor", name: "Reinforced Hides", detail: "beast armor" },
  ],
};

/** Names of the tier-2 and tier-3 main halls. */
export const TIER_NAMES: Record<RaceCode, [string, string]> = {
  H: ["Keep", "Castle"],
  O: ["Stronghold", "Fortress"],
  U: ["Halls of the Dead", "Black Citadel"],
  N: ["Tree of Ages", "Tree of Eternity"],
};

/** Upgrades with more than one level (upgradedata.slk maxlevel); everything else has one. */
const UPGRADE_MAX_LEVEL: Record<string, number> = {
  // 3 levels: attack, armor, Masonry
  Rhme: 3, Rhra: 3, Rhar: 3, Rhla: 3, Rhac: 3, Rome: 3, Rora: 3, Roar: 3,
  Rume: 3, Rura: 3, Ruar: 3, Rucr: 3, Resm: 3, Resw: 3, Rema: 3, Rerh: 3,
  // 2 levels: caster training, Lumber Harvesting, Spiked Barricades
  Rhpt: 2, Rhst: 2, Rhlh: 2, Rowd: 2, Rost: 2, Rowt: 2, Rosp: 2, Rune: 2, Ruba: 2, Redt: 2, Redc: 2,
};
export const upgradeMaxLevel = (code: string) => UPGRADE_MAX_LEVEL[code] ?? 1;

/** A repeat of the same research this soon is a cancel-and-requeue, not the next level. */
const REQUEUE_MS = 30_000;

/** Research orders with their level: the n-th distinct order of the same upgrade, up to its max. */
export function researchLevels(build: { kind: string; code: string; ms: number }[]): { code: string; level: number; ms: number }[] {
  const last = new Map<string, { level: number; ms: number }>();
  const out: { code: string; level: number; ms: number }[] = [];
  for (const b of build) {
    if (b.kind !== "upgrade") continue;
    const prev = last.get(b.code);
    if (prev && b.ms - prev.ms < REQUEUE_MS) continue;
    const level = (prev?.level ?? 0) + 1;
    if (level > upgradeMaxLevel(b.code)) continue;
    last.set(b.code, { level, ms: b.ms });
    out.push({ code: b.code, level, ms: b.ms });
  }
  return out;
}
