// The Upgrades section: your race's attack/armor upgrades level by level, then other research,
// with timings compared to the pros (who research it, and when).
import { CORE_UPGRADES, researchLevels, upgradeMaxLevel, type RaceCode, type UpgradeKind } from "@replay-altar/core/gamedata";
import { nameOf } from "@replay-altar/core/names";
import { percentileOf } from "@replay-altar/reference/quantiles";
import type { MatchupProfile, UpgradeStat } from "@replay-altar/reference/types";
import { mmss } from "./format.ts";

export type UpgradeRow = { key: string; code: string; level: number; label: string; detail: string | null; kind: UpgradeKind | null; pro: UpgradeStat | null };

/** Show a pro-only upgrade when at least this share of pro games research it. */
const PRO_SHARE_CORE_LEVELS = 0.15;
const PRO_SHARE_OTHER = 0.25;

const label = (name: string, code: string, level: number) => (upgradeMaxLevel(code) > 1 ? `${name} L${level}` : name);

export function upgradeRows(race: RaceCode, yourKeys: Set<string>, mp: MatchupProfile | null): { core: UpgradeRow[]; other: UpgradeRow[] } {
  const pro = (key: string) => mp?.upgrades?.[key] ?? null;
  const core: UpgradeRow[] = [];
  const coreCodes = new Set(CORE_UPGRADES[race].map((u) => u.code));
  for (const u of CORE_UPGRADES[race]) {
    for (let level = 1; level <= 3; level++) {
      const key = `${u.code}:${level}`;
      const p = pro(key);
      // Level 1 always; higher levels when you or enough pros get there.
      if (level > 1 && !yourKeys.has(key) && !(p && p.share >= PRO_SHARE_CORE_LEVELS)) continue;
      core.push({ key, code: u.code, level, label: label(u.name, u.code, level), detail: u.detail, kind: u.kind, pro: p });
    }
  }
  const otherKeys = new Set([...yourKeys].filter((k) => !coreCodes.has(k.split(":")[0])));
  for (const [k, p] of Object.entries(mp?.upgrades ?? {})) if (!coreCodes.has(k.split(":")[0]) && p.share >= PRO_SHARE_OTHER) otherKeys.add(k);
  const other = [...otherKeys]
    .map((key) => {
      const [code, lvl] = key.split(":");
      const p = pro(key);
      return { key, code, level: Number(lvl), label: label(p?.name ?? nameOf(code, "upgrades"), code, Number(lvl)), detail: null, kind: null, pro: p };
    })
    .sort((a, b) => (a.pro?.p50 ?? Infinity) - (b.pro?.p50 ?? Infinity) || a.label.localeCompare(b.label));
  return { core, other };
}

/** "R:L" keys and times of one game's research. */
export function researchTimes(build: { kind: string; code: string; ms: number }[]): Map<string, number> {
  return new Map(researchLevels(build).map((r) => [`${r.code}:${r.level}`, r.ms]));
}

/** "9:31 · 29%": median time among the pro games that research it, and the share of pro games that do. */
export function proText(p: UpgradeStat | null): string {
  if (!p) return "· 0%";
  return `${mmss(p.p50)} · ${Math.round(p.share * 100)}%`;
}

/** Your timing among the pro games that researched it, or a note when you skipped it. */
export function upgradeStanding(p: UpgradeStat | null, yourTime: number | null): string {
  if (yourTime === null) return p && p.share >= 0.5 ? `skipped; most pro games research it` : "skipped";
  if (!p || p.values.length < 3) return "few pro games research it";
  const below = percentileOf(p.values, yourTime);
  if (below <= 0.005) return "earlier than every pro who researches it";
  if (below >= 0.995) return "later than every pro who researches it";
  return below < 0.5 ? `earlier than ${Math.round((1 - below) * 100)}% of pros who research it` : `later than ${Math.round(below * 100)}% of pros who research it`;
}
