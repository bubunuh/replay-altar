import type { MetricDef, ReferenceGroup } from "@replay-altar/core/ui";
import { mmss } from "@replay-altar/core/time";
import { decimal, locale, tr } from "@replay-altar/core/i18n";

export { mmss };
export { problemName } from "@replay-altar/rules/problems";

export const RACE: Record<string, string> = { H: "Human", O: "Orc", U: "Undead", N: "Night Elf", R: tr("Random", "Aleatório") };

// The window reloads when the language changes, so these tables can be built at load time.
export const SOURCE: Record<string, string> = {
  bnet_ladder: tr("Battle.net ladder", "Ladder do Battle.net"),
  w3champions: "W3Champions",
  custom: tr("Custom game", "Partida customizada"),
};

/** "Human pros" (the settings file's label) in the window's language. */
export const groupLabel = (g: Pick<ReferenceGroup, "label" | "race">) => tr(g.label, `Pros de ${RACE[g.race] ?? g.race}`);

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(locale(), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

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
      return Math.abs(v) >= 100 ? Math.round(v).toLocaleString(locale()) : Number.isInteger(v) ? String(v) : decimal(v);
  }
}

export const mean = (xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export const shortName = (battletag: string | null) => (battletag ?? "?").replace(/#\d+$/, "");

export const GROUP_LABEL: Record<string, string> = {
  speed: tr("Speed", "Velocidade"),
  control: tr("Control", "Controle"),
  heroes: tr("Heroes", "Heróis"),
  macro: "Macro",
  economy: tr("Economy (simulated)", "Economia (simulada)"),
  supply: tr("Supply (simulated)", "Food (simulado)"),
  army: tr("Army", "Exército"),
  fights: tr("Fights (simulated)", "Lutas (simuladas)"),
  scouting: tr("Scouting (simulated)", "Scout (simulado)"),
  items: tr("Items", "Itens"),
};
