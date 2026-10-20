// Short names of the findings, for lists and filters (the match list's "Main problem", the
// recurring problems). Keyed by every finding id, so a new rule doesn't type-check without one.
import type { Finding } from "./findings.ts";

export const PROBLEM_NAME: Record<Finding["id"], string> = {
  heroes: "Heroes behind",
  fights: "Costly fights",
  hero_deaths: "Hero deaths",
  no_heroes: "Fought without heroes",
  economy: "Too few workers",
  workers_lost: "Workers lost",
  supply: "Supply blocked",
  floating: "Unspent gold",
  upgrades: "No upgrades",
  upkeep: "High upkeep",
  upkeep_before_upgrades: "Upkeep before upgrades",
  just_over_50: "Just over 50 food",
  expansion: "Never expanded",
  out_expanded: "Out-expanded",
  unanswered_expansion: "Unanswered expansion",
  mine_dry: "Mine ran dry",
  window: "Missed a window",
  exposed: "Left a window open",
  unused_spike: "Waited at 50 food",
  unused_lead: "Unused lead",
  goal_3360: "Late 3-3-60",
  one_hero: "One hero",
  first_creep: "Late first creep",
  no_items: "No items",
  no_sustain: "No healing items",
  no_scout: "No scouting",
  army_mismatch: "Army mismatch",
  no_anti_air: "No anti-air",
  towers: "Too many towers",
  build_drift: "Build steps late",
  mechanics: "Speed and hotkeys",
};

export const problemName = (id: string) => PROBLEM_NAME[id as Finding["id"]] ?? id.replace(/_/g, " ");
