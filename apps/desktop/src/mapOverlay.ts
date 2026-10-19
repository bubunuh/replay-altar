// What the game's minimap shows on top of the terrain: gold mines, shops and taverns, start
// locations and creep camps (coloured by total creep level, as in game). Read from WC3V's map
// library (vendor/wc3v/client/maps/<map>/: unit.json, neutralBuildings.json, wpm.json for the
// extent) and its unit table for creep levels; positions are scaled to 0-1 over map.jpg.
// Checked by eye on a few maps (markers on land, mines at bases); not an exact projection.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { nameOf } from "@replay-altar/core/names";

export type MapMarker = { x: number; y: number; kind: "gold" | "shop" | "start" | "camp"; label: string; level?: number };

const NEUTRAL_HOSTILE = 24;
/** Neutral buildings worth a marker (gold mines get their own). */
const SHOPS: Record<string, string> = {
  ngme: "Goblin Merchant",
  nmrk: "Marketplace",
  ntav: "Tavern",
  nmer: "Mercenary Camp",
  ngad: "Goblin Laboratory",
  nfoh: "Fountain of Health",
  nmoo: "Fountain of Mana",
  ndrk: "Dragon Roost",
};
/** Creeps closer than this (world units) to one already in a camp join it. */
const CAMP_LINK = 700;

const cache = new Map<string, MapMarker[] | null>();
const projections = new Map<string, ((x: number, y: number) => { x: number; y: number }) | null>();
let levels: Record<string, { level?: number }> | null = null;

const readGz = (file: string) => JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));

export function mapMarkers(wc3vRoot: string, folder: string): MapMarker[] | null {
  if (cache.has(folder)) return cache.get(folder)!;
  const dir = join(wc3vRoot, "client/maps", folder);
  let out: MapMarker[] | null = null;
  try {
    if (existsSync(join(dir, "unit.json.gz")) && existsSync(join(dir, "wpm.json.gz"))) out = build(wc3vRoot, dir);
  } catch {
    out = null;
  }
  cache.set(folder, out);
  return out;
}

/** World coordinates to 0-1 over the map's map.jpg; null when the map isn't in the library. */
export function projectionFor(wc3vRoot: string, folder: string) {
  if (projections.has(folder)) return projections.get(folder)!;
  const file = join(wc3vRoot, "client/maps", folder, "wpm.json.gz");
  let at: ((x: number, y: number) => { x: number; y: number }) | null = null;
  try {
    if (existsSync(file)) at = projection(readGz(file).grid);
  } catch {
    at = null;
  }
  projections.set(folder, at);
  return at;
}

function projection(grid: { x: number; y: number }[][]) {
  // The pathing grid covers map.jpg: 32-unit cells from the top-left corner.
  const first = grid[0][0];
  const last = grid.at(-1)!.at(-1)!;
  const [xMin, yMax, xMax, yMin] = [first.x, first.y, last.x + 32, last.y - 32];
  // map.jpg is square: a map wider than tall (or taller than wide) sits centred in it, with bands.
  const size = Math.max(xMax - xMin, yMax - yMin);
  const padX = (size - (xMax - xMin)) / 2;
  const padY = (size - (yMax - yMin)) / 2;
  return (x: number, y: number) => ({ x: (x - xMin + padX) / size, y: (yMax - y + padY) / size });
}

function build(wc3vRoot: string, dir: string): MapMarker[] {
  if (!levels) {
    const table = JSON.parse(readFileSync(join(wc3vRoot, "helpers/UnitBalance.json"), "utf8"));
    levels = (Object.values(table)[0] ?? {}) as Record<string, { level?: number }>;
  }
  const at = projection(readGz(join(dir, "wpm.json.gz")).grid);

  const units = readGz(join(dir, "unit.json.gz")).units as { type: string; player: number; position: number[]; gold?: number }[];
  const markers: MapMarker[] = [];
  for (const u of units) {
    const [x, y] = u.position;
    if (u.type === "ngol") markers.push({ ...at(x, y), kind: "gold", label: `Gold mine${u.gold ? ` (${u.gold} gold)` : ""}` });
    else if (u.type === "sloc") markers.push({ ...at(x, y), kind: "start", label: "Start location" });
    else if (SHOPS[u.type]) markers.push({ ...at(x, y), kind: "shop", label: SHOPS[u.type] });
  }

  // Creep camps: hostile neutrals grouped by distance.
  const creeps = units.filter((u) => u.player === NEUTRAL_HOSTILE).map((u) => ({ x: u.position[0], y: u.position[1], type: u.type }));
  const camp = creeps.map((_, i) => i);
  const root = (i: number): number => (camp[i] === i ? i : (camp[i] = root(camp[i])));
  for (let i = 0; i < creeps.length; i++)
    for (let j = i + 1; j < creeps.length; j++)
      if (Math.hypot(creeps[i].x - creeps[j].x, creeps[i].y - creeps[j].y) <= CAMP_LINK) camp[root(i)] = root(j);
  const groups = new Map<number, typeof creeps>();
  creeps.forEach((c, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), c]));
  for (const g of groups.values()) {
    const level = g.reduce((n, c) => n + (levels?.[c.type]?.level ?? 0), 0);
    const names = new Map<string, number>();
    for (const c of g) {
      const name = nameOf(c.type);
      names.set(name, (names.get(name) ?? 0) + 1);
    }
    const cx = g.reduce((n, c) => n + c.x, 0) / g.length;
    const cy = g.reduce((n, c) => n + c.y, 0) / g.length;
    markers.push({ ...at(cx, cy), kind: "camp", level, label: [...names].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(", ") });
  }
  return markers;
}
