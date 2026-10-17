import names from "./data/names.json" with { type: "json" };

export type NameKind = "units" | "buildings" | "upgrades" | "items" | "heroAbilities" | "heroes";

const tables = names as unknown as Record<NameKind, Record<string, string>>;

/** Human-readable name for a replay object ID; unknown IDs fall back to the raw code. */
export function nameOf(id: string, kind?: NameKind): string {
  if (kind) return tables[kind][id] ?? id;
  for (const k of ["units", "buildings", "upgrades", "items", "heroes"] as const) {
    if (tables[k][id]) return tables[k][id];
  }
  return id;
}

/** "Archmage:Blizzard" -> "Blizzard" */
export const abilityName = (id: string) => nameOf(id, "heroAbilities").split(":").pop()!;

export const NAMES_SOURCE: string = names.source;
