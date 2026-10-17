// Per-player numbers derived from the parsed command stream.
// A replay holds commands, not game state: every "time" here is when an order was issued
// (cancelled orders included), and heroes are timed by their first learned skill.
import { isRaceCode, RACES } from "./gamedata.ts";
import type { RawReplay } from "./parse.ts";

export const METRICS_VERSION = 1;

export type MetricUnit = "ms" | "count" | "apm" | "ratio" | "per_min";

export type MetricDef = {
  key: string;
  label: string;
  unit: MetricUnit;
  group: "speed" | "control" | "heroes" | "macro" | "army" | "items";
  description: string;
};

// The registry is the single definition of each metric: the UI, docs/DATA.md and exports read it.
export const METRICS: MetricDef[] = [
  { key: "apm", label: "APM", unit: "apm", group: "speed", description: "Actions per minute over the time the player was in the game (w3gjs definition: selections, orders, hotkeys; excludes some non-APM actions)." },
  { key: "apm_early", label: "APM 0–5 min", unit: "apm", group: "speed", description: "Mean actions per minute over complete minutes 0–4." },
  { key: "apm_mid", label: "APM 5–15 min", unit: "apm", group: "speed", description: "Mean actions per minute over complete minutes 5–14." },
  { key: "apm_late", label: "APM 15+ min", unit: "apm", group: "speed", description: "Mean actions per minute over complete minutes from 15 on." },
  { key: "hotkey_select_share", label: "Selections via hotkey", unit: "ratio", group: "control", description: "Control-group recalls / (recalls + mouse selections)." },
  { key: "rightclick_share", label: "Right-click share", unit: "ratio", group: "control", description: "Right-click orders / all counted actions." },
  { key: "control_groups_used", label: "Control groups used", unit: "count", group: "control", description: "Number of distinct control groups (0–9) recalled at least once." },
  { key: "control_group_recalls_per_min", label: "Group recalls / min", unit: "per_min", group: "control", description: "Control-group recalls per minute of game time." },
  { key: "hero1_ms", label: "1st hero", unit: "ms", group: "heroes", description: "First skill learned by the first hero (proxy for when the hero arrived)." },
  { key: "hero2_ms", label: "2nd hero", unit: "ms", group: "heroes", description: "First skill learned by the second hero." },
  { key: "hero3_ms", label: "3rd hero", unit: "ms", group: "heroes", description: "First skill learned by the third hero." },
  { key: "heroes_count", label: "Heroes", unit: "count", group: "heroes", description: "Heroes that learned at least one skill." },
  { key: "hero_levels_total", label: "Total hero levels", unit: "count", group: "heroes", description: "Sum of final hero levels (from skill points spent)." },
  { key: "tier2_ms", label: "Tier 2 started", unit: "ms", group: "macro", description: "First upgrade order to Keep / Stronghold / Halls of the Dead / Tree of Ages." },
  { key: "tier3_ms", label: "Tier 3 started", unit: "ms", group: "macro", description: "First upgrade order to Castle / Fortress / Black Citadel / Tree of Eternity." },
  { key: "expansion_ms", label: "1st expansion", unit: "ms", group: "macro", description: "First order to build a new main hall (the starting hall is pre-placed)." },
  { key: "workers_by_3m", label: "Workers by 3:00", unit: "count", group: "macro", description: "Worker train orders issued in the first 3 minutes (excludes the 5 starting workers)." },
  { key: "workers_by_6m", label: "Workers by 6:00", unit: "count", group: "macro", description: "Worker train orders issued in the first 6 minutes." },
  { key: "workers_by_10m", label: "Workers by 10:00", unit: "count", group: "macro", description: "Worker train orders issued in the first 10 minutes." },
  { key: "production_by_5m", label: "Production bldgs by 5:00", unit: "count", group: "macro", description: "Build orders for unit-producing buildings in the first 5 minutes." },
  { key: "production_by_10m", label: "Production bldgs by 10:00", unit: "count", group: "macro", description: "Build orders for unit-producing buildings in the first 10 minutes." },
  { key: "supply_buildings_by_10m", label: "Supply bldgs by 10:00", unit: "count", group: "macro", description: "Farm / Burrow / Ziggurat / Moon Well build orders in the first 10 minutes." },
  { key: "towers_total", label: "Towers", unit: "count", group: "macro", description: "Defensive tower build or upgrade orders over the whole game." },
  { key: "units_ordered", label: "Army units ordered", unit: "count", group: "army", description: "Non-worker unit train orders over the whole game." },
  { key: "upgrades_ordered", label: "Upgrades ordered", unit: "count", group: "army", description: "Research orders over the whole game." },
  { key: "items_bought", label: "Items bought", unit: "count", group: "items", description: "Shop purchase orders over the whole game." },
  { key: "first_item_ms", label: "First item", unit: "ms", group: "items", description: "First shop purchase order." },
];

export type Metrics = Record<string, number | null>;

type ParsedPlayer = RawReplay["output"]["players"][number];

const firstOf = (orders: { id: string; ms: number }[], ids: string[]) =>
  orders.find((o) => ids.includes(o.id))?.ms ?? null;
const countBy = (orders: { id: string; ms: number }[], ids: string[], ms = Infinity) =>
  orders.filter((o) => ids.includes(o.id) && o.ms <= ms).length;

function meanOf(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function computeMetrics(raw: RawReplay, playerId: number): Metrics {
  const p = raw.output.players.find((x) => x.id === playerId) as ParsedPlayer;
  const durationMs = raw.output.duration;
  const minutes = durationMs / 60000;
  const a = p.actions!;

  // actions.timed holds one count per 60 s segment; the last one is usually partial.
  const fullMinutes = Math.floor(minutes);
  const timed = a.timed.slice(0, fullMinutes);
  const apmRange = (from: number, to: number) => meanOf(timed.slice(from, to));

  const counted = a.assigngroup + a.rightclick + a.basic + a.buildtrain + a.ability + a.item + a.select + a.removeunit + a.subgroup + a.selecthotkey + a.esc;
  const groups = Object.values(p.groupHotkeys ?? {});
  const recalls = groups.reduce((sum, g) => sum + g.used, 0);

  const heroStarts = (p.heroes ?? [])
    .map((h) => h.abilityOrder.find((x) => x.type === "ability")?.time)
    .filter((t): t is number => t !== undefined)
    .sort((x, y) => x - y);

  const race = p.raceDetected || p.race;
  const rd = isRaceCode(race) ? RACES[race] : null;
  const buildings = p.buildings!.order;
  const units = p.units!.order;
  const workerIds = Object.values(RACES).map((r) => r.worker);

  return {
    apm: p.apm ?? null,
    apm_early: apmRange(0, 5),
    apm_mid: apmRange(5, 15),
    apm_late: apmRange(15, Infinity),
    hotkey_select_share: a.selecthotkey + a.select ? a.selecthotkey / (a.selecthotkey + a.select) : null,
    rightclick_share: counted ? a.rightclick / counted : null,
    control_groups_used: groups.filter((g) => g.used > 0).length,
    control_group_recalls_per_min: minutes ? recalls / minutes : null,
    hero1_ms: heroStarts[0] ?? null,
    hero2_ms: heroStarts[1] ?? null,
    hero3_ms: heroStarts[2] ?? null,
    heroes_count: heroStarts.length,
    hero_levels_total: (p.heroes ?? []).reduce((sum, h) => sum + h.level, 0),
    tier2_ms: rd ? firstOf(buildings, [rd.tier2]) : null,
    tier3_ms: rd ? firstOf(buildings, [rd.tier3]) : null,
    expansion_ms: rd ? firstOf(buildings, rd.townHalls) : null,
    workers_by_3m: countBy(units, workerIds, 180_000),
    workers_by_6m: countBy(units, workerIds, 360_000),
    workers_by_10m: countBy(units, workerIds, 600_000),
    production_by_5m: rd ? countBy(buildings, rd.production, 300_000) : null,
    production_by_10m: rd ? countBy(buildings, rd.production, 600_000) : null,
    supply_buildings_by_10m: rd ? countBy(buildings, [rd.supply], 600_000) : null,
    towers_total: rd ? countBy(buildings, rd.towers) : null,
    units_ordered: units.filter((u) => !workerIds.includes(u.id)).length,
    upgrades_ordered: p.upgrades!.order.length,
    items_bought: p.items!.order.length,
    first_item_ms: p.items!.order[0]?.ms ?? null,
  };
}
