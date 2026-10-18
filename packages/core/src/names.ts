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

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
let reverse: Map<string, { id: string; kind: NameKind }> | null = null;

/** Replay object ID for a display name ("Orc Burrow" -> "otrb"), or null. Case and punctuation are ignored. */
export function codeOf(name: string, kinds: NameKind[] = ["units", "buildings", "heroes", "upgrades", "items"]): string | null {
  if (!reverse) {
    reverse = new Map();
    for (const kind of ["heroes", "units", "buildings", "upgrades", "items"] as const) {
      for (const [id, n] of Object.entries(tables[kind])) if (!reverse.has(norm(n))) reverse.set(norm(n), { id, kind });
    }
  }
  const hit = reverse.get(norm(name));
  return hit && kinds.includes(hit.kind) ? hit.id : null;
}
