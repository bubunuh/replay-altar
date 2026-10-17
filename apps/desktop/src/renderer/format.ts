import type { MetricDef } from "@w3stats/core/ui";

export const RACE: Record<string, string> = { H: "Human", O: "Orc", U: "Undead", N: "Night Elf", R: "Random" };

export const SOURCE: Record<string, string> = {
  bnet_ladder: "Battle.net ladder",
  w3champions: "W3Champions",
  custom: "Custom game",
};

export const SKIP: Record<string, string> = {
  not_1v1: "Not a 1v1",
  vs_ai: "Against computer",
  observed: "You observed",
  not_me: "You didn't play",
  custom_map: "Custom map",
};

export function mmss(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

/** Formats a metric; estimates (income model, inferred deaths) get a leading ≈. */
export function metricValue(def: Pick<MetricDef, "unit"> & { source?: MetricDef["source"] }, v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (def.source === "estimate") return `≈${metricValue({ unit: def.unit }, v)}`;
  switch (def.unit) {
    case "ms":
      return mmss(v);
    case "ratio":
      return pct(v);
    case "apm":
    case "per_min":
      return String(Math.round(v));
    default:
      return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
}

export const mean = (xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export const shortName = (battletag: string | null) => (battletag ?? "?").replace(/#\d+$/, "");

export const GROUP_LABEL: Record<string, string> = {
  speed: "Speed",
  control: "Control",
  heroes: "Heroes",
  macro: "Macro (orders)",
  economy: "Economy (simulated)",
  supply: "Supply (simulated)",
  army: "Army",
  items: "Items",
};
