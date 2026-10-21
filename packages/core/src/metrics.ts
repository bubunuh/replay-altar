// Per-player numbers derived from the parsed command stream.
// A replay holds commands, not game state: every "time" here is when an order was issued
// (cancelled orders included), and heroes are timed by their first learned skill.
import { CORE_UPGRADES, dropRepeatedBuildOrders, isRaceCode, POTION_ITEMS, RACES, researchLevels, TIER_NAMES, TOWN_PORTAL, type RaceCode } from "./gamedata.ts";
import { heroesXpAt, levelUpTimes } from "./heroxp.ts";
import type { RawReplay } from "./parse.ts";
import { language } from "./i18n.ts";
import { METRIC_PT, tierLabelPt } from "./metrics.pt.ts";
import { METRIC_ES, tierLabelEs } from "./metrics.es.ts";
import { METRIC_FR, tierLabelFr } from "./metrics.fr.ts";

export const METRICS_VERSION = 10;

export type MetricUnit = "ms" | "count" | "apm" | "ratio" | "per_min";

export type MetricDef = {
  key: string;
  label: string;
  unit: MetricUnit;
  group: "speed" | "control" | "heroes" | "macro" | "army" | "items" | "economy" | "supply" | "fights" | "scouting";
  /**
   * replay: counted directly from the replay's commands.
   * simulation: from WC3V's reconstruction of the game (inferred, usually reliable).
   * estimate: from our income model on top of the simulation (approximate; shown with ≈).
   * official: the game's own end-of-game stats (W3Champions games only; empty otherwise).
   */
  source: "replay" | "simulation" | "estimate" | "official";
  /** Which direction is generally better; null when it depends on strategy (e.g. tech timing). */
  better: "higher" | "lower" | null;
  /** A whole-game total that grows with game length; compared with other games per 10 minutes. */
  scalesWithLength: boolean;
  /** Race-specific names, e.g. "Keep started" for Human tier 2. */
  raceLabels?: Partial<Record<RaceCode, string>>;
  /**
   * core: separates winners from losers (tested on pro and own games); gets good/bad labels.
   * mechanics: skill-level habits (APM, hotkeys, avoiding supply blocks); compared with pros.
   * details: everything else.
   */
  section: "core" | "mechanics" | "details";
  description: string;
};

type MetricSpec = Omit<MetricDef, "better" | "scalesWithLength" | "section" | "raceLabels">;

// Filled in by packages/sim once a game has been simulated; null until then.
const SIM_SPECS: MetricSpec[] = [
  { key: "gold_spent_6m", label: "Gold spent by 6:00", unit: "count", group: "economy", source: "simulation", description: "Gold committed to units, buildings, upgrades, research and items in the first 6 minutes (starting buildings and workers excluded, first hero free)." },
  { key: "gold_spent_10m", label: "Gold spent by 10:00", unit: "count", group: "economy", source: "simulation", description: "Gold committed in the first 10 minutes (same rules as Gold spent by 6:00)." },
  { key: "lumber_spent_10m", label: "Lumber spent by 10:00", unit: "count", group: "economy", source: "simulation", description: "Lumber committed in the first 10 minutes." },
  { key: "resources_spent_total", label: "Resources spent", unit: "count", group: "economy", source: "simulation", description: "Gold + lumber committed over the whole game." },
  { key: "resources_lost_total", label: "Resources lost", unit: "count", group: "economy", source: "estimate", description: "Gold + lumber value of your units and buildings the simulation marks as lost or possibly lost (heroes excluded). Deaths are inferred, not recorded." },
  { key: "resources_killed_total", label: "Resources killed", unit: "count", group: "economy", source: "estimate", description: "Gold + lumber value of the opponent's losses." },
  { key: "trade_efficiency", label: "Trade efficiency", unit: "ratio", group: "economy", source: "estimate", description: "Resources killed / (killed + lost). Above 50% means you traded better than your opponent." },
  { key: "goal_3360_ms", label: "3-3-60 reached", unit: "ms", group: "heroes", source: "simulation", description: "When you first had your first hero at level 3, your second hero at level 3 and 60 food: Grubby's beginner goal (\"3360 rule\"), after which you look for a fight. Empty if never reached (or one-hero play)." },
  { key: "workers_lost_12m", label: "Workers lost by 12:00", unit: "count", group: "economy", source: "estimate", description: "Workers the simulation saw die in the first 12 minutes (inferred deaths). Losing about five while expanding usually puts you far behind." },
  { key: "workers_alive_6m", label: "Workers alive at 6:00", unit: "count", group: "economy", source: "simulation", description: "Workers alive at 6:00 (starting workers included, deaths subtracted)." },
  { key: "workers_alive_10m", label: "Workers alive at 10:00", unit: "count", group: "economy", source: "simulation", description: "Workers alive at 10:00." },
  { key: "tier2_done_ms", label: "Tier 2 finished", unit: "ms", group: "economy", source: "simulation", description: "Tier 2 upgrade started plus its build time." },
  { key: "tier3_done_ms", label: "Tier 3 finished", unit: "ms", group: "economy", source: "simulation", description: "Tier 3 upgrade started plus its build time." },
  { key: "expansions", label: "Expansions", unit: "count", group: "economy", source: "simulation", description: "Additional gold mines taken (new halls, or Haunted Gold Mines for Undead) that finished building." },
  { key: "creep_camps_6m", label: "Creep camps by 6:00", unit: "count", group: "economy", source: "simulation", description: "Neutral camps your side cleared in the first 6 minutes." },
  { key: "creep_camps_10m", label: "Creep camps by 10:00", unit: "count", group: "economy", source: "simulation", description: "Neutral camps your side cleared in the first 10 minutes." },
  { key: "supply_blocked_s", label: "Supply blocked", unit: "count", group: "supply", source: "simulation", description: "Seconds at the food cap (below 100), when you could not train anything." },
  { key: "unused_supply_avg", label: "Unused supply", unit: "count", group: "supply", source: "simulation", description: "Average food cap minus food used. High values mean idle production or floating resources." },
  { key: "upkeep_low_s", label: "Time in low upkeep", unit: "count", group: "supply", source: "simulation", description: "Seconds at 51–80 food (30% gold tax)." },
  { key: "upkeep_high_s", label: "Time in high upkeep", unit: "count", group: "supply", source: "simulation", description: "Seconds above 80 food (60% gold tax)." },
  { key: "est_gold_mined_10m", label: "Gold mined by 10:00", unit: "count", group: "economy", source: "estimate", description: "Income model: workers alive × mine rules (5 per mine, 12,500 gold per mine, upkeep) × a rate fitted to the game's official gold totals (typical error ~11%)." },
  { key: "est_bank_avg", label: "Unspent gold (avg, first 10 min)", unit: "count", group: "economy", source: "estimate", description: "Average over the first 10 minutes of 500 starting gold + estimated gold income − gold spent. Lower is better macro. Lumber is left out: its estimate proved unreliable." },
  { key: "est_bank_10m", label: "Unspent gold at 10:00", unit: "count", group: "economy", source: "estimate", description: "Estimated gold banked at 10:00 (start + estimated income − spent)." },
  { key: "eapm", label: "Effective APM", unit: "apm", group: "speed", source: "simulation", description: "WC3V's effective actions per minute: repeated and redundant commands (spam clicks, reselecting the same units) removed. WC3V counts actions differently from the APM row above, so compare it with other EAPM values, not with APM." },
  { key: "useful_action_share", label: "Useful actions", unit: "ratio", group: "speed", source: "simulation", description: "WC3V effective actions / all WC3V-counted actions: the share of your actions that were not spam or redundant." },
  { key: "army_food_6m", label: "Army food at 6:00", unit: "count", group: "economy", source: "simulation", description: "Food used minus workers at 6:00 (army size, heroes included)." },
  { key: "army_food_8m", label: "Army food at 8:00", unit: "count", group: "economy", source: "simulation", description: "Food used minus workers at 8:00." },
  { key: "army_food_10m", label: "Army food at 10:00", unit: "count", group: "economy", source: "simulation", description: "Food used minus workers at 10:00." },
  { key: "fights_pitched", label: "Pitched battles", unit: "count", group: "fights", source: "simulation", description: "Army-vs-army fights you took part in." },
  { key: "fights_defending", label: "Base defenses", unit: "count", group: "fights", source: "simulation", description: "Fights at a base that you did not start (defending against attacks or harassment)." },
  { key: "fights_creep", label: "Creep fights", unit: "count", group: "fights", source: "simulation", description: "Fights against neutral creeps." },
  { key: "hero_deaths", label: "Hero deaths", unit: "count", group: "heroes", source: "simulation", description: "Hero revives plus heroes dead at the end of the game." },
  { key: "spells_per_min", label: "Spells per minute", unit: "per_min", group: "heroes", source: "simulation", description: "Spell casts per minute of game time (heroes and casters)." },
  { key: "first_creep_ms", label: "First creep camp", unit: "ms", group: "heroes", source: "simulation", description: "When your side first cleared a neutral camp." },
  { key: "gold_collected", label: "Gold collected", unit: "count", group: "economy", source: "simulation", description: "Gold your workers brought in over the game. W3Champions games: the game's own number. Otherwise estimated as gold spent minus the 500 starting gold (within ~3% of the official number on pro games)." },
  { key: "lumber_collected", label: "Lumber collected", unit: "count", group: "economy", source: "official", description: "Lumber harvested over the game (W3Champions games only)." },
  { key: "upkeep_gold_lost", label: "Gold lost to upkeep", unit: "count", group: "economy", source: "official", description: "Gold the upkeep tax took (W3Champions games only)." },
  { key: "units_killed", label: "Units killed", unit: "count", group: "fights", source: "estimate", description: "Units you killed, creeps included, as the game's score screen counts them. W3Champions games: the official number. Otherwise ≈ (enemy units the simulation saw die + creeps in camps you cleared) × 1.49, which matched the official count with correlation 0.90 on pro games." },
  { key: "units_produced", label: "Units produced", unit: "count", group: "army", source: "official", description: "Units you produced, as the game counts them (W3Champions games only)." },
  { key: "largest_army", label: "Largest army", unit: "count", group: "army", source: "simulation", description: "Your largest army in food (heroes included), as the game counts it. W3Champions games: the official number; otherwise the simulated supply (0.95x official on median, correlation 0.90)." },
  { key: "heroes_killed", label: "Heroes killed", unit: "count", group: "fights", source: "official", description: "Enemy heroes you killed (W3Champions games only)." },
  { key: "items_obtained", label: "Items obtained", unit: "count", group: "items", source: "official", description: "Items your heroes obtained, bought or dropped (W3Champions games only)." },
  { key: "first_scout_ms", label: "First scout", unit: "ms", group: "scouting", source: "simulation", description: "When a unit of yours first reached the opponent's side of the map." },
];

// Directions for wording comparisons ("better than 70% of pros"); unlisted metrics are neutral.
const BETTER: Record<string, "higher" | "lower"> = {
  apm: "higher", apm_early: "higher", apm_mid: "higher", apm_late: "higher", eapm: "higher", useful_action_share: "higher",
  hotkey_select_share: "higher", control_groups_used: "higher", control_group_recalls_per_min: "higher",
  workers_by_3m: "higher", workers_by_6m: "higher", workers_by_10m: "higher", workers_alive_6m: "higher", workers_alive_10m: "higher",
  hall_idle_6m_s: "lower", hall_idle_10m_s: "lower",
  gold_spent_6m: "higher", gold_spent_10m: "higher", lumber_spent_10m: "higher", resources_spent_total: "higher",
  resources_lost_total: "lower", resources_killed_total: "higher", trade_efficiency: "higher",
  creep_camps_6m: "higher", creep_camps_10m: "higher", first_creep_ms: "lower",
  hero_level_6m: "higher", hero_level_10m: "higher", hero_levels_total: "higher", hero_level3_ms: "lower", goal_3360_ms: "lower", workers_lost_12m: "lower", hero_level5_ms: "lower", hero_deaths: "lower",
  hero_xp_4m: "higher", hero_xp_6m: "higher", hero_xp_8m: "higher", hero_xp_10m: "higher", hero_xp_total: "higher", hero_xp_per_min: "higher", hero_xp_share: "higher",
  fights_defending: "lower",
  gold_collected: "higher", units_killed: "higher", heroes_killed: "higher", largest_army: "higher", lumber_collected: "higher",
  supply_blocked_s: "lower", unused_supply_avg: "lower", est_bank_avg: "lower", est_bank_10m: "lower",
  est_gold_mined_10m: "higher",
  army_food_6m: "higher", army_food_8m: "higher", army_food_10m: "higher",
  spells_per_min: "higher",
};
// Whole-game totals: a 25-minute game simply has more of them than a 12-minute one.
const SCALES_WITH_LENGTH = new Set([
  "resources_spent_total", "resources_lost_total", "resources_killed_total",
  "units_ordered", "upgrades_ordered", "items_bought", "towers_total", "tp_bought", "potions_bought",
  "hero_deaths", "hero_levels_total", "hero_xp_total", "fights_pitched", "fights_defending", "fights_creep",
  "gold_collected", "lumber_collected", "upkeep_gold_lost", "units_killed", "units_produced", "heroes_killed", "items_obtained",
  "supply_blocked_s", "upkeep_low_s", "upkeep_high_s",
]);

/**
 * Core metrics, in display order. Chosen from a winner-vs-loser test on 28 pro games and 10 of the
 * user's (2026-10-17): each was better for the winner in roughly 70% or more of games, or is a
 * direct measure of a resource the game counts (hero XP, units killed, gold collected).
 */
export const CORE_METRICS = [
  "workers_by_6m", "workers_alive_6m", "workers_alive_10m",
  "hero_xp_6m", "hero_xp_10m", "hero_xp_share", "hero_level3_ms", "goal_3360_ms", "hero2_ms", "hero3_ms", "creep_camps_6m",
  "tier2_ms", "tier3_ms",
  "gold_collected", "units_killed", "trade_efficiency",
  "unused_supply_avg", "fights_defending", "hero_deaths", "expansions",
];
export const MECHANICS_METRICS = ["apm", "eapm", "useful_action_share", "hotkey_select_share", "control_groups_used", "control_group_recalls_per_min", "supply_blocked_s"];

const TIER_LABELS: Record<string, Partial<Record<RaceCode, string>>> = Object.fromEntries(
  (["tier2_ms", "tier3_ms", "tier2_done_ms", "tier3_done_ms"] as const).map((key) => {
    const tier = key.startsWith("tier2") ? 0 : 1;
    const verb = key.endsWith("done_ms") ? "finished" : "started";
    return [key, Object.fromEntries((Object.keys(TIER_NAMES) as RaceCode[]).map((r) => [r, `${TIER_NAMES[r][tier]} ${verb}`]))];
  }),
);

const withBetter = (m: MetricSpec): MetricDef => ({
  ...m,
  better: BETTER[m.key] ?? null,
  scalesWithLength: SCALES_WITH_LENGTH.has(m.key),
  raceLabels: TIER_LABELS[m.key],
  section: CORE_METRICS.includes(m.key) ? "core" : MECHANICS_METRICS.includes(m.key) ? "mechanics" : "details",
});

/** Value per 10 minutes of game time, for comparing whole-game totals across games of any length. */
export const per10Minutes = (value: number, durationMs: number) => (durationMs > 0 ? value / (durationMs / 600_000) : value);

export const SIM_METRICS: MetricDef[] = SIM_SPECS.map(withBetter);

// The registry is the single definition of each metric: the UI, docs/DATA.md and exports read it.
const REPLAY_SPECS: MetricSpec[] = [
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
  { key: "hero_level_6m", label: "Top hero level at 6:00", unit: "count", group: "heroes", source: "replay", description: "Level of your highest hero at 6:00 (from skill points learned)." },
  { key: "hero_level_10m", label: "Top hero level at 10:00", unit: "count", group: "heroes", source: "replay", description: "Level of your highest hero at 10:00." },
  { key: "hero_level3_ms", label: "Hero level 3", unit: "ms", group: "heroes", source: "replay", description: "When your first hero reached level 3 (its third skill point)." },
  { key: "hero_level5_ms", label: "Hero level 5", unit: "ms", group: "heroes", source: "replay", description: "When your first hero reached level 5. From level 5 heroes get no more experience from creeps." },
  { key: "hero_xp_4m", label: "Hero XP by 4:00", unit: "count", group: "heroes", source: "replay", description: "Experience of all your heroes at 4:00, from their level-up times (exact at each level-up, interpolated between)." },
  { key: "hero_xp_6m", label: "Hero XP by 6:00", unit: "count", group: "heroes", source: "replay", description: "Experience of all your heroes at 6:00." },
  { key: "hero_xp_8m", label: "Hero XP by 8:00", unit: "count", group: "heroes", source: "replay", description: "Experience of all your heroes at 8:00." },
  { key: "hero_xp_10m", label: "Hero XP by 10:00", unit: "count", group: "heroes", source: "replay", description: "Experience of all your heroes at 10:00." },
  { key: "hero_xp_total", label: "Hero XP total", unit: "count", group: "heroes", source: "replay", description: "Experience gained by all your heroes over the game: levels reached plus half of the next level (matched W3Champions' official XP within about 230 XP on pro games)." },
  { key: "hero_xp_per_min", label: "Hero XP per minute", unit: "per_min", group: "heroes", source: "replay", description: "Hero XP total divided by game minutes." },
  { key: "hero_xp_share", label: "Hero XP share", unit: "ratio", group: "heroes", source: "replay", description: "Your heroes' XP as a share of both players' hero XP. Above 50% means you out-levelled your opponent." },
  { key: "first_attack_upgrade_ms", label: "1st attack upgrade", unit: "ms", group: "army", source: "replay", description: "When your first melee or ranged attack upgrade was ordered (blacksmith-type research)." },
  { key: "first_armor_upgrade_ms", label: "1st armor upgrade", unit: "ms", group: "army", source: "replay", description: "When your first unit armor upgrade was ordered." },
  { key: "hall_idle_6m_s", label: "Main hall idle by 6:00", unit: "count", group: "macro", source: "replay", description: "Seconds in the first 6 minutes your main hall was not training a worker or upgrading (worker orders queued back to back at their build time). All worker orders are treated as one queue, so after an expansion this can understate idle time." },
  { key: "hall_idle_10m_s", label: "Main hall idle by 10:00", unit: "count", group: "macro", source: "replay", description: "Seconds in the first 10 minutes your main hall was not training a worker or upgrading (same queue model as by 6:00)." },
  { key: "tp_bought", label: "Town Portals bought", unit: "count", group: "items", source: "replay", description: "Scroll of Town Portal purchase orders." },
  { key: "potions_bought", label: "Potions bought", unit: "count", group: "items", source: "replay", description: "Healing, mana, clarity, restoration and similar potion purchase orders." },
];

export const METRICS: MetricDef[] = [...REPLAY_SPECS.map(withBetter), ...SIM_METRICS];

/** The metric with its name and description in the current language. */
const METRIC_TR = {
  pt: { names: METRIC_PT, tier: tierLabelPt },
  es: { names: METRIC_ES, tier: tierLabelEs },
  fr: { names: METRIC_FR, tier: tierLabelFr },
};

export function localizeMetric(m: MetricDef): MetricDef {
  const l = language();
  if (l === "en") return m;
  const t = METRIC_TR[l];
  const names = t.names[m.key];
  if (!names) return m;
  const raceLabels = m.raceLabels && Object.fromEntries(Object.entries(m.raceLabels).map(([r, label]) => [r, t.tier(label)]));
  return { ...m, label: names[0], description: names[1], raceLabels };
}

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

/**
 * Seconds the main hall had nothing to do before `untilMs`: worker orders queue back to back
 * (each takes the race's worker build time) and a tier upgrade occupies the hall while it runs.
 */
export function hallIdleMs(race: RaceCode, orders: { id: string; ms: number }[], untilMs: number): number {
  const r = RACES[race];
  const jobs = orders
    .filter((o) => o.id === r.worker || o.id === r.tier2 || o.id === r.tier3)
    .map((o) => ({ at: o.ms, takes: o.id === r.worker ? r.workerBuildMs : r.tierBuildMs }))
    .sort((a, b) => a.at - b.at);
  let busyUntil = 0;
  let idle = 0;
  for (const job of jobs) {
    if (job.at >= untilMs) break;
    if (job.at > busyUntil) idle += job.at - busyUntil;
    busyUntil = Math.max(busyUntil, job.at) + job.takes;
  }
  if (busyUntil < untilMs) idle += untilMs - busyUntil;
  return idle;
}

function heroMetrics(heroes: { abilityOrder: { type: "ability" | "retraining"; time: number; value?: string }[] }[], durationMs: number): Metrics {
  const levels = heroes.map((h) => levelUpTimes(h.abilityOrder));
  const levelAt = (t: number) => Math.max(0, ...levels.map((l) => l.filter((x) => x <= t).length));
  const firstReaching = (lvl: number) => {
    const times = levels.map((l) => l[lvl - 1]).filter((x): x is number => x !== undefined);
    return times.length ? Math.min(...times) : null;
  };
  const xpBy = (t: number) => (durationMs >= t ? Math.round(heroesXpAt(levels, t, durationMs)) : null);
  const total = Math.round(heroesXpAt(levels, durationMs, durationMs));
  return {
    hero_level_6m: durationMs >= 360_000 ? levelAt(360_000) : null,
    hero_level_10m: durationMs >= 600_000 ? levelAt(600_000) : null,
    hero_level3_ms: firstReaching(3),
    hero_level5_ms: firstReaching(5),
    hero_xp_4m: xpBy(240_000),
    hero_xp_6m: xpBy(360_000),
    hero_xp_8m: xpBy(480_000),
    hero_xp_10m: xpBy(600_000),
    hero_xp_total: total,
    hero_xp_per_min: durationMs > 0 ? total / (durationMs / 60_000) : null,
    hero_xp_share: null, // needs both players: filled in by buildRecord
  };
}

function firstUpgrade(orders: { id: string; ms: number }[], race: RaceCode, kind: "attack" | "armor"): number | null {
  const codes = new Set(CORE_UPGRADES[race].filter((u) => u.kind === kind).map((u) => u.code));
  const hit = researchLevels(orders.map((o) => ({ kind: "upgrade", code: o.id, ms: o.ms }))).find((r) => codes.has(r.code));
  return hit?.ms ?? null;
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
  const buildings = dropRepeatedBuildOrders(p.buildings!.order);
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
    ...heroMetrics(p.heroes ?? [], durationMs),
    hall_idle_6m_s: rd && durationMs >= 360_000 ? Math.round(hallIdleMs(race as RaceCode, [...units, ...buildings], 360_000) / 1000) : null,
    hall_idle_10m_s: rd && durationMs >= 600_000 ? Math.round(hallIdleMs(race as RaceCode, [...units, ...buildings], 600_000) / 1000) : null,
    first_attack_upgrade_ms: rd ? firstUpgrade(p.upgrades!.order, race as RaceCode, "attack") : null,
    first_armor_upgrade_ms: rd ? firstUpgrade(p.upgrades!.order, race as RaceCode, "armor") : null,
    tp_bought: p.items!.order.filter((i) => i.id === TOWN_PORTAL).length,
    potions_bought: p.items!.order.filter((i) => POTION_ITEMS.has(i.id)).length,
  };
}
