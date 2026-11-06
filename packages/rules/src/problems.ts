// Short names of the findings, for lists and filters (the match list's "Main problem", the
// recurring problems). Keyed by every finding id, so a new rule doesn't type-check without one.
import { trTable } from "@replay-altar/core/i18n";
import type { Finding } from "./findings.ts";

export const PROBLEM_NAME: Record<Finding["id"], string> = trTable({
  heroes: ["Heroes behind", "Heróis atrasados", "Héroes atrasados", "Héros en retard"],
  fights: ["Costly fights", "Lutas caras", "Combates caros", "Combats coûteux"],
  hero_deaths: ["Hero deaths", "Mortes de heróis", "Muertes de héroes", "Morts de héros"],
  no_heroes: ["Fought without heroes", "Lutou sem heróis", "Peleó sin héroes", "Combat sans héros"],
  economy: ["Too few workers", "Poucos trabalhadores", "Pocos trabajadores", "Trop peu d'ouvriers"],
  workers_lost: ["Workers lost", "Trabalhadores perdidos", "Trabajadores perdidos", "Ouvriers perdus"],
  supply: ["Supply blocked", "Travado no food", "Bloqueado por food", "Bloqué par la food"],
  floating: ["Unspent gold", "Ouro parado", "Oro sin gastar", "Or non dépensé"],
  upgrades: ["No upgrades", "Sem upgrades", "Sin mejoras", "Pas d'améliorations"],
  upkeep: ["High upkeep", "Upkeep alto", "Upkeep alto", "Upkeep élevé"],
  upkeep_before_upgrades: ["Upkeep before upgrades", "Upkeep antes dos upgrades", "Upkeep antes de las mejoras", "Upkeep avant les améliorations"],
  just_over_50: ["Just over 50 food", "Logo acima de 50 de food", "Justo por encima de 50 de food", "Juste au-dessus de 50 de food"],
  expansion: ["Never expanded", "Nunca expandiu", "Nunca se expandió", "Jamais étendu"],
  out_expanded: ["Out-expanded", "Menos bases", "Menos bases", "Moins de bases"],
  unanswered_expansion: ["Unanswered expansion", "Expansão sem resposta", "Expansión sin respuesta", "Expansion sans réponse"],
  mine_dry: ["Mine ran dry", "Mina secou", "Mina agotada", "Mine épuisée"],
  window: ["Missed a window", "Perdeu uma brecha", "Ventana desaprovechada", "Fenêtre manquée"],
  exposed: ["Left a window open", "Deixou uma brecha", "Dejó una ventana abierta", "Fenêtre laissée ouverte"],
  unused_spike: ["Waited at 50 food", "Esperou com 50 de food", "Esperó con 50 de food", "Attente à 50 de food"],
  unused_lead: ["Unused lead", "Vantagem desperdiçada", "Ventaja desaprovechada", "Avance inexploitée"],
  goal_3360: ["Late 3-3-60", "3-3-60 atrasado", "3-3-60 tardío", "3-3-60 en retard"],
  one_hero: ["One hero", "Um herói só", "Un solo héroe", "Un seul héros"],
  first_creep: ["Late first creep", "Primeiro creep atrasado", "Primer creep tardío", "Premier creep tardif"],
  no_items: ["No items", "Sem itens", "Sin objetos", "Pas d'objets"],
  no_sustain: ["No healing items", "Sem itens de cura", "Sin objetos de curación", "Pas d'objets de soin"],
  no_scout: ["No scouting", "Sem scout", "Sin exploración", "Pas d'éclairage"],
  army_mismatch: ["Army mismatch", "Exército inadequado", "Ejército inadecuado", "Armée inadaptée"],
  no_anti_air: ["No anti-air", "Sem anti-aéreo", "Sin antiaéreo", "Pas d'anti-aérien"],
  towers: ["Too many towers", "Torres demais", "Demasiadas torres", "Trop de tours"],
  build_drift: ["Build steps late", "Passos da build atrasados", "Pasos de la build tarde", "Étapes de build en retard"],
  mechanics: ["Control groups and hotkeys", "Grupos de controle e atalhos", "Grupos de control y atajos", "Groupes de contrôle et raccourcis"],
});

export const problemName = (id: string) => PROBLEM_NAME[id as Finding["id"]] ?? id.replace(/_/g, " ");

/** Short names of the strengths, for the match list and its filter. Keyed by the core metrics that can be one. */
export const STRENGTH_NAME: Record<string, string> = trTable({
  hero_xp_6m: ["Hero experience by 6:00", "Experiência dos heróis aos 6:00", "Experiencia de héroes a los 6:00", "Expérience des héros à 6:00"],
  hero_xp_10m: ["Hero experience by 10:00", "Experiência dos heróis aos 10:00", "Experiencia de héroes a los 10:00", "Expérience des héros à 10:00"],
  hero_xp_share: ["Hero experience lead", "Vantagem de experiência dos heróis", "Ventaja de experiencia de héroes", "Avance d'expérience des héros"],
  hero_level3_ms: ["Early hero level 3", "Herói nível 3 cedo", "Héroe nivel 3 temprano", "Héros niveau 3 tôt"],
  creep_camps_6m: ["Early creeping", "Creep cedo", "Creep temprano", "Creep précoce"],
  units_killed: ["Units killed", "Unidades abatidas", "Unidades eliminadas", "Unités tuées"],
  trade_efficiency: ["Efficient trades", "Trocas eficientes", "Intercambios eficientes", "Échanges efficaces"],
  unused_supply_avg: ["Food well used", "Food bem usado", "Food bien aprovechado", "Food bien utilisée"],
  hero_deaths: ["Heroes kept alive", "Heróis mantidos vivos", "Héroes mantenidos con vida", "Héros gardés en vie"],
});

export const strengthName = (key: string) => STRENGTH_NAME[key] ?? key.replace(/_/g, " ");
