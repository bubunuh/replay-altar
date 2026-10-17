// Comparing your numbers with a reference group (pros) from profile.json.
import type { MetricDef } from "@w3stats/core/ui";
import { percentileOf } from "@w3stats/reference/quantiles";
import type { MatchupProfile, RefProfile } from "@w3stats/reference/types";

const MIN_MATCHUP_GAMES = 10;
const MIN_REFERENCE_VALUES = 5;
/** At or above the pro median: as good as at least half of the pro games (ties count half). */
const PRO_LEVEL_SHARE = 0.5;

/** The reference group whose players play this race (pros compared with you play your race). */
export function groupForRace<T extends { group: { race: string } }>(refs: T[], race: string | null | undefined): T | undefined {
  return race ? refs.find((r) => r.group.race === race) : undefined;
}

/** The matchup's profile when it has enough games, else all of the group's games. */
export function pickProfile(profile: RefProfile | null | undefined, matchup: string | null): { key: string; mp: MatchupProfile } | null {
  if (!profile) return null;
  const specific = matchup ? profile.matchups[matchup] : undefined;
  if (specific && specific.n >= MIN_MATCHUP_GAMES) return { key: matchup!, mp: specific };
  const all = profile.matchups.all;
  return all && all.n > 0 ? { key: "all", mp: all } : null;
}

export function describeRef(p: { key: string; mp: MatchupProfile }) {
  return p.key === "all" ? `all matchups, ${p.mp.n} games` : `${p.key}, ${p.mp.n} games`;
}

/**
 * pro: at or above the pro median (as good as at least half of their games).
 * above: not there yet, but at least as good as your opponents.
 * below: worse than the pros' normal range and than your opponents.
 * null: no better direction for this metric, or too little data.
 */
export type Tier = "pro" | "above" | "below" | null;

export type Assessment = {
  /** Pro median in the compared unit (per 10 minutes for whole-game totals). */
  proMedian: number | null;
  per10: boolean;
  text: string;
  tier: Tier;
  /** The tier says how typical the value is for pros (metrics with no better direction). */
  typicality?: boolean;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Where you stand against the pros on one metric.
 * you.value is in the metric's own unit; you.per10 is the same normalized per 10 minutes
 * (used for whole-game totals, since pros' games have other lengths). The opponent is compared
 * on the raw value: same games, same length.
 */
export function assess(
  def: MetricDef,
  mp: MatchupProfile | null,
  you: { value: number | null | undefined; per10?: number | null },
  opponent: number | null | undefined,
): Assessment {
  const entry = mp?.metrics[def.key];
  const per10 = def.scalesWithLength && !!entry?.per10;
  const stat = per10 ? entry!.per10! : entry;
  const x = per10 ? you.per10 : you.value;
  const none: Assessment = { proMedian: stat?.p50 ?? null, per10, text: "—", tier: null };
  if (x === null || x === undefined || !stat || stat.values.length < MIN_REFERENCE_VALUES) return none;

  const below = percentileOf(stat.values, x); // share of pro games with a lower value
  if (def.better === null) {
    const [more, less] = def.unit === "ms" ? ["later", "earlier"] : ["higher", "lower"];
    const text =
      below >= 0.995 ? `${more} than every pro game`
      : below <= 0.005 ? `${less} than every pro game`
      : below >= 0.5 ? `${more} than ${pct(below)} of pro games`
      : `${less} than ${pct(1 - below)} of pro games`;
    // No better direction (e.g. tech timing): judge how typical it is for pros instead.
    const tier: Tier = below >= 0.25 && below <= 0.75 ? "pro" : below >= 0.1 && below <= 0.9 ? "above" : "below";
    return { ...none, text, tier, typicality: true };
  }
  const good = def.better === "higher" ? below : 1 - below; // share of pro games you beat
  // The words follow the label: at pro level, say how many pro games you beat; below it, how many beat you.
  const proLevel = good >= PRO_LEVEL_SHARE;
  const text =
    good >= 0.995 ? "better than every pro game"
    : good <= 0.005 ? "worse than every pro game"
    : proLevel ? `better than ${pct(good)} of pro games`
    : `worse than ${pct(1 - good)} of pro games`;

  let tier: Tier;
  if (proLevel) tier = "pro";
  else if (you.value !== null && you.value !== undefined && opponent !== null && opponent !== undefined && (def.better === "higher" ? you.value >= opponent : you.value <= opponent)) tier = "above";
  else tier = "below";
  return { proMedian: stat.p50, per10, text, tier };
}

/** Labels when the tier is about typicality (no better direction). */
export const TYPICAL_LABEL: Record<Exclude<Tier, null>, string> = {
  pro: "Like pros",
  above: "Unusual",
  below: "Far from pros",
};

export const TIER_LABEL: Record<Exclude<Tier, null>, string> = {
  pro: "Pro level",
  above: "Above opponents",
  below: "Below opponents",
};
