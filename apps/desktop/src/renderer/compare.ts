// Comparing your numbers with a reference group (pros) from profile.json.
import type { MetricDef } from "@w3stats/core/ui";
import { percentileOf } from "@w3stats/reference/quantiles";
import type { MatchupProfile, RefProfile } from "@w3stats/reference/types";

const MIN_MATCHUP_GAMES = 10;

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
 * "better than 68%" (of the pros' games), "behind every pro game", or neutral wording
 * ("later than 52%") when neither direction is better.
 */
export function standing(def: MetricDef, mp: MatchupProfile, x: number | null | undefined): string {
  const stat = mp.metrics[def.key];
  if (x === null || x === undefined || !stat || stat.values.length < 5) return "—";
  const below = percentileOf(stat.values, x);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  // v = share of pro games you are above (in the "good" direction when there is one).
  const word = (v: number, top: string, bottom: string, middle: string) => (v >= 0.995 ? top : v <= 0.005 ? bottom : `${middle} ${pct(v)}`);
  if (def.better === "higher") return word(below, "ahead of every pro game", "behind every pro game", "better than");
  if (def.better === "lower") return word(1 - below, "ahead of every pro game", "behind every pro game", "better than");
  if (def.unit === "ms") return word(below, "later than every pro game", "earlier than every pro game", "later than");
  return word(below, "higher than every pro game", "lower than every pro game", "higher than");
}
