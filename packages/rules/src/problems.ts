// Short names of the findings, for lists and filters (the match list's "Main problem", the
// recurring problems). Keyed by every finding id, so a new rule doesn't type-check without one.
import { trTable } from "@replay-altar/core/i18n";
import type { Finding } from "./findings.ts";

export const PROBLEM_NAME: Record<Finding["id"], string> = trTable({
  heroes: ["Heroes behind", "Heróis atrasados"],
  fights: ["Costly fights", "Lutas caras"],
  hero_deaths: ["Hero deaths", "Mortes de heróis"],
  no_heroes: ["Fought without heroes", "Lutou sem heróis"],
  economy: ["Too few workers", "Poucos trabalhadores"],
  workers_lost: ["Workers lost", "Trabalhadores perdidos"],
  supply: ["Supply blocked", "Travado no food"],
  floating: ["Unspent gold", "Ouro parado"],
  upgrades: ["No upgrades", "Sem upgrades"],
  upkeep: ["High upkeep", "Upkeep alto"],
  upkeep_before_upgrades: ["Upkeep before upgrades", "Upkeep antes dos upgrades"],
  just_over_50: ["Just over 50 food", "Logo acima de 50 de food"],
  expansion: ["Never expanded", "Nunca expandiu"],
  out_expanded: ["Out-expanded", "Menos bases"],
  unanswered_expansion: ["Unanswered expansion", "Expansão sem resposta"],
  mine_dry: ["Mine ran dry", "Mina secou"],
  window: ["Missed a window", "Perdeu uma brecha"],
  exposed: ["Left a window open", "Deixou uma brecha"],
  unused_spike: ["Waited at 50 food", "Esperou com 50 de food"],
  unused_lead: ["Unused lead", "Vantagem desperdiçada"],
  goal_3360: ["Late 3-3-60", "3-3-60 atrasado"],
  one_hero: ["One hero", "Um herói só"],
  first_creep: ["Late first creep", "Primeiro creep atrasado"],
  no_items: ["No items", "Sem itens"],
  no_sustain: ["No healing items", "Sem itens de cura"],
  no_scout: ["No scouting", "Sem scout"],
  army_mismatch: ["Army mismatch", "Exército inadequado"],
  no_anti_air: ["No anti-air", "Sem anti-aéreo"],
  towers: ["Too many towers", "Torres demais"],
  build_drift: ["Build steps late", "Passos da build atrasados"],
  mechanics: ["Speed and hotkeys", "Velocidade e atalhos"],
});

export const problemName = (id: string) => PROBLEM_NAME[id as Finding["id"]] ?? id.replace(/_/g, " ");
