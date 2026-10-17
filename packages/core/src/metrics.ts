// Per-player numbers derived from the parsed command stream.
// A replay holds commands, not game state: every "time" here is when an order was issued
// (cancelled orders included), and heroes are timed by their first learned skill.
import { isRaceCode, RACES } from "./gamedata.ts";
import type { RawReplay } from "./parse.ts";

export const METRICS_VERSION = 2;

export type MetricUnit = "ms" | "count" | "apm" | "ratio" | "per_min";

export type MetricDef = {
  key: string;
  label: string;
  unit: MetricUnit;
  group: "speed" | "control" | "heroes" | "macro" | "army" | "items" | "economy" | "supply";
  /**
   * replay: counted directly from the replay's commands.
   * simulation: from WC3V's reconstruction of the game (inferred, usually reliable).
   * estimate: from our income model on top of the simulation (approximate; shown with ≈).
   */
  source: "replay" | "simulation" | "estimate";
  description: string;
};

// Filled in by packages/sim once a game has been simulated; null until then.
export const SIM_METRICS: MetricDef[] = [
  { key: "gold_spent_6m", label: "Gold spent by 6:00", unit: "count", group: "economy", source: "simulation", description: "Gold committed to units, buildings, upgrades, research and items in the first 6 minutes (starting buildings and workers excluded, first hero free)." },
  { key: "gold_spent_10m", label: "Gold spent by 10:00", unit: "count", group: "economy", source: "simulation", description: "Same as above, first 10 minutes." },
  { key: "lumber_spent_10m", label: "Lumber spent by 10:00", unit: "count", group: "economy", source: "simulation", description: "Lumber committed in the first 10 minutes." },
  { key: "resources_spent_total", label: "Resources spent", unit: "count", group: "economy", source: "simulation", description: "Gold + lumber committed over the whole game." },
  { key: "resources_lost_total", label: "Resources lost", unit: "count", group: "economy", source: "estimate", description: "Gold + lumber value of your units and buildings the simulation marks as lost or possibly lost (heroes excluded). Deaths are inferred, not recorded." },
  { key: "resources_killed_total", label: "Resources killed", unit: "count", group: "economy", source: "estimate", description: "Gold + lumber value of the opponent's losses." },
  { key: "trade_efficiency", label: "Trade efficiency", unit: "ratio", group: "economy", source: "estimate", description: "Resources killed / (killed + lost). Above 50% means you traded better than your opponent." },
  { key: "workers_alive_6m", label: "Workers alive at 6:00", unit: "count", group: "economy", source: "simulation", description: "Workers alive at 6:00 (starting workers included, deaths subtracted)." },
  { key: "workers_alive_10m", label: "Workers alive at 10:00", unit: "count", group: "economy", source: "simulation", description: "Workers alive at 10:00." },
  { key: "tier2_done_ms", label: "Tier 2 finished", unit: "ms", group: "economy", source: "simulation", description: "Tier 2 upgrade started plus its build time." },
  { key: "tier3_done_ms", label: "Tier 3 finished", unit: "ms", group: "economy", source: "simulation", description: "Tier 3 upgrade started plus its build time." },
  { key: "expansions", label: "Expansions", unit: "count", group: "economy", source: "simulation", description: "Additional gold mines taken (new halls, or Haunted Gold Mines for Undead) that finished building." },
  { key: "creep_camps_6m", label: "Creep camps by 6:00", unit: "count", group: "economy", source: "simulation", description: "Neutral camps your side cleared in the first 6 minutes." },
  { key: "creep_camps_10m", label: "Creep camps by 10:00", unit: "count", group: "economy", source: "simulation", description: "Neutral camps your side cleared in the first 10 minutes." },
  { key: "hero_level_6m", label: "Top hero level at 6:00", unit: "count", group: "heroes", source: "simulation", description: "Level of your highest hero at 6:00." },
  { key: "hero_level_10m", label: "Top hero level at 10:00", unit: "count", group: "heroes", source: "simulation", description: "Level of your highest hero at 10:00." },
  { key: "supply_blocked_s", label: "Supply blocked", unit: "count", group: "supply", source: "simulation", description: "Seconds at the food cap (below 100), when you could not train anything." },
  { key: "unused_supply_avg", label: "Unused supply", unit: "count", group: "supply", source: "simulation", description: "Average food cap minus food used. High values mean idle production or floating resources." },
  { key: "upkeep_low_s", label: "Time in low upkeep", unit: "count", group: "supply", source: "simulation", description: "Seconds at 51–80 food (30% gold tax)." },
  { key: "upkeep_high_s", label: "Time in high upkeep", unit: "count", group: "supply", source: "simulation", description: "Seconds above 80 food (60% gold tax)." },
  { key: "est_gold_mined_10m", label: "Gold mined by 10:00", unit: "count", group: "economy", source: "estimate", description: "Income model: workers alive × mine rules (5 per mine, 12,500 gold per mine, upkeep) × calibrated rate." },
  { key: "est_lumber_mined_10m", label: "Lumber harvested by 10:00", unit: "count", group: "economy", source: "estimate", description: "Income model: workers not on gold (ghouls for Undead) × calibrated per-race rate." },
  { key: "est_bank_avg", label: "Unspent resources (avg)", unit: "count", group: "economy", source: "estimate", description: "Average of starting resources + estimated income − spent (gold + lumber). Lower is better macro." },
  { key: "est_bank_10m", label: "Unspent resources at 10:00", unit: "count", group: "economy", source: "estimate", description: "Estimated gold + lumber banked at 10:00." },
];

// The registry is the single definition of each metric: the UI, docs/DATA.md and exports read it.
export const METRICS: MetricDef[] = [
  { key: "apm", label: "APM", unit: "apm", group: "speed", source: "replay", description: "Actions per minute over the time the player was in the game (w3gjs definition: selections, orders, hotkeys; excludes some non-APM actions)." },
  { key: "apm_early", label: "APM 0–5 min", unit: "apm", group: "speed", source: "replay", description: "Mean actions per minute over complete minutes 0–4." },
  { key: "apm_mid", label: "APM 5–15 min", unit: "apm", group: "speed", source: "replay", description: "Mean actions per minute over complete minutes 5–14." },
  { key: "apm_late", label: "APM 15+ min", unit: "apm", group: "speed", source: "replay", description: "Mean actions per minute over complete minutes from 15 on." },
  { key: "hotkey_select_share", label: "Selections via hotkey", unit: "ratio", group: "control", source: "replay", description: "Control-group recalls / (recalls + mouse selections)." },
  { key: "rightclick_share", label: "Right-click share", unit: "ratio", group: "control", source: "replay", description: "Right-click orders / all counted actions." },
  { key: "control_groups_used", label: "Control groups used", unit: "count", group: "control", source: "replay", description: "Number of distinct control groups (0–9) recalled at least once." },
  { key: "control_group_recalls_per_min", label: "Group recalls / min", unit: "per_min", group: "control", source: "replay", description: "Control-group recalls per minute of game time." },
  { key: "hero1_ms", label: "1st hero", unit: "ms", group: "heroes", source: "replay", description: "First skill learned by the first hero (proxy for when the hero arrived)." },
  { key: "hero2_ms", label: "2nd hero", unit: "ms", group: "heroes", source: "replay", description: "First skill learned by the second hero." },
  { key: "hero3_ms", label: "3rd hero", unit: "ms", group: "heroes", source: "replay", description: "First skill learned by the third hero." },
  { key: "heroes_count", label: "Heroes", unit: "count", group: "heroes", source: "replay", description: "Heroes that learned at least one skill." },
  { key: "hero_levels_total", label: "Total hero levels", unit: "count", group: "heroes", source: "replay", description: "Sum of final hero levels (from skill points spent)." },
  { key: "tier2_ms", label: "Tier 2 started", unit: "ms", group: "macro", source: "replay", description: "First upgrade order to Keep / Stronghold / Halls of the Dead / Tree of Ages." },
  { key: "tier3_ms", label: "Tier 3 started", unit: "ms", group: "macro", source: "replay", description: "First upgrade order to Castle / Fortress / Black Citadel / Tree of Eternity." },
  { key: "expansion_ms", label: "1st expansion", unit: "ms", group: "macro", source: "replay", description: "First order to build a new main hall (the starting hall is pre-placed)." },
  { key: "workers_by_3m", label: "Workers by 3:00", unit: "count", group: "macro", source: "replay", description: "Worker train orders issued in the first 3 minutes (excludes the 5 starting workers)." },
  { key: "workers_by_6m", label: "Workers by 6:00", unit: "count", group: "macro", source: "replay", description: "Worker train orders issued in the first 6 minutes." },
  { key: "workers_by_10m", label: "Workers by 10:00", unit: "count", group: "macro", source: "replay", description: "Worker train orders issued in the first 10 minutes." },
  { key: "production_by_5m", label: "Production bldgs by 5:00", unit: "count", group: "macro", source: "replay", description: "Build orders for unit-producing buildings in the first 5 minutes." },
  { key: "production_by_10m", label: "Production bldgs by 10:00", unit: "count", group: "macro", source: "replay", description: "Build orders for unit-producing buildings in the first 10 minutes." },
  { key: "supply_buildings_by_10m", label: "Supply bldgs by 10:00", unit: "count", group: "macro", source: "replay", description: "Farm / Burrow / Ziggurat / Moon Well build orders in the first 10 minutes." },
  { key: "towers_total", label: "Towers", unit: "count", group: "macro", source: "replay", description: "Defensive tower build or upgrade orders over the whole game." },
  { key: "units_ordered", label: "Army units ordered", unit: "count", group: "army", source: "replay", description: "Non-worker unit train orders over the whole game." },
  { key: "upgrades_ordered", label: "Upgrades ordered", unit: "count", group: "army", source: "replay", description: "Research orders over the whole game." },
  { key: "items_bought", label: "Items bought", unit: "count", group: "items", source: "replay", description: "Shop purchase orders over the whole game." },
  { key: "first_item_ms", label: "First item", unit: "ms", group: "items", source: "replay", description: "First shop purchase order." },
  ...SIM_METRICS,
];

export const SIM_METRIC_KEYS = new Set(SIM_METRICS.map((m) => m.key));

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
