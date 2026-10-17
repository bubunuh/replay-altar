// What things cost, from the game data extracted out of the local install (scripts/extract-gamedata.sh).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSlk } from "./slk.ts";

export type Cost = { gold: number; lumber: number; food: number; foodMade: number; buildMs: number; isHero: boolean };
export type CostTables = {
  version: string;
  manifestSha256: string;
  units: Record<string, Cost>;
  items: Record<string, { gold: number; lumber: number }>;
  /** Research: level n costs base + mod * (n - 1). */
  upgrades: Record<string, { goldBase: number; goldMod: number; lumberBase: number; lumberMod: number }>;
};

export function loadCosts(gamedataDir: string): CostTables {
  const balance = JSON.parse(readFileSync(join(gamedataDir, "UnitBalance.json"), "utf8")).output as Record<
    string,
    { goldCost?: number; lumberCost?: number; foodUsed?: number; foodMade?: number; buildTime?: number; armorType?: string }
  >;
  const units: Record<string, Cost> = {};
  for (const [id, b] of Object.entries(balance)) {
    units[id] = {
      gold: b.goldCost ?? 0,
      lumber: b.lumberCost ?? 0,
      food: b.foodUsed ?? 0,
      foodMade: b.foodMade ?? 0,
      buildMs: (b.buildTime ?? 0) * 1000,
      isHero: b.armorType === "hero",
    };
  }
  const items: CostTables["items"] = {};
  for (const row of parseSlk(readFileSync(join(gamedataDir, "itemdata.slk"), "latin1"))) {
    if (row.itemID) items[row.itemID] = { gold: Number(row.goldcost) || 0, lumber: Number(row.lumbercost) || 0 };
  }
  const upgrades: CostTables["upgrades"] = {};
  for (const row of parseSlk(readFileSync(join(gamedataDir, "upgradedata.slk"), "latin1"))) {
    if (!row.upgradeid) continue;
    upgrades[row.upgradeid] = {
      goldBase: Number(row.goldbase) || 0,
      goldMod: Number(row.goldmod) || 0,
      lumberBase: Number(row.lumberbase) || 0,
      lumberMod: Number(row.lumbermod) || 0,
    };
  }
  const manifest = readFileSync(join(gamedataDir, "manifest.json"), "utf8");
  return {
    version: JSON.parse(manifest).gameVersion,
    manifestSha256: createHash("sha256").update(manifest).digest("hex"),
    units,
    items,
    upgrades,
  };
}

export const ZERO: Cost = { gold: 0, lumber: 0, food: 0, foodMade: 0, buildMs: 0, isHero: false };
export const costOf = (t: CostTables, id: string): Cost => t.units[id] ?? ZERO;
