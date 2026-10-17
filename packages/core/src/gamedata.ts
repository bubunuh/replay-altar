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
    townHalls: ["htow"],
    tier2: "hkee",
    tier3: "hcas",
    supply: "hhou",
    production: ["hbar", "hars", "harm", "hgra"],
    towers: ["hwtw", "hgtw", "hctw", "hatw"],
  },
  O: {
    worker: "opeo",
    townHalls: ["ogre"],
    tier2: "ostr",
    tier3: "ofrt",
    supply: "otrb",
    production: ["obar", "osld", "obea", "otto"],
    towers: ["owtw"],
  },
  U: {
    worker: "uaco",
    townHalls: ["unpl", "ugol"], // Undead usually expand with just a Haunted Gold Mine
    tier2: "unp1",
    tier3: "unp2",
    supply: "uzig",
    production: ["usep", "utod", "uslh", "ubon"],
    towers: ["uzg1", "uzg2"],
  },
  N: {
    worker: "ewsp",
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
