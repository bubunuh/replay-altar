// Basics: clear beginner mistakes. Thresholds sit outside what the pro games show, so these stay
// quiet for good players and speak up for new ones (they rank below the main findings, core.ts).
import type { PlayerRecord } from "@replay-altar/core/ui";
import { RACES, type RaceCode } from "@replay-altar/core/gamedata";
import { tr } from "@replay-altar/core/i18n";
import { deviationsFromPros, matchBuilds } from "../builds.ts";
import { proBuildOf } from "../principles.ts";
import { at, mmss, seriesOf } from "../series.ts";
import { type Ctx, type Finding, expansionTimes, num, proGap, proQ, simHeroes, BASIC, fightsNear } from "./shared.ts";


/** Every race's standard opening (Liquipedia): creep as soon as the hero leaves the altar. Pros: median 9 s, 90% within 67 s. */
export function firstCreepFinding(c: Ctx): Finding | null {
  const hero = Math.min(...simHeroes(c, c.me).map((h) => h.appearAt ?? Infinity));
  const creep = c.me.metrics.first_creep_ms;
  // Beyond what 9 in 10 pros of your race do (at least 90 s).
  const limit = Math.max(90_000, proQ(c, "creepDelay", "p90") ?? 0);
  if (!Number.isFinite(hero) || creep === null || creep === undefined || creep - hero <= limit) return null;
  // A hero that harassed instead of creeping and still kept pace isn't idle (fast-tech openings).
  const xp = proGap(c, "hero_xp_6m");
  if (xp && xp.worseThan < 0.5) return null;
  return {
    id: "first_creep",
    severity: BASIC,
    headline: tr("Your hero waited before creeping", "Seu herói demorou para creepar"),
    evidence: [tr(`Your first hero appeared at ${mmss(hero)} and first fought creeps at ${mmss(creep)}: ${Math.round((creep - hero) / 1000)} s later (pros: within about 10 s, almost always within 70 s).`, `Seu primeiro herói apareceu às ${mmss(hero)} e lutou contra creeps pela primeira vez às ${mmss(creep)}: ${Math.round((creep - hero) / 1000)} s depois (pros: em uns 10 s, quase sempre em menos de 70 s).`)],
  };
}

/** Caster trainings: caster builds invest in these instead of attack and armor upgrades. */
const CASTER_TRAINING = new Set(["Rhpt", "Rhst", "Redt", "Redc", "Rowd", "Rost", "Rowt", "Rune", "Ruba"]);
const firstCasterTraining = (p: PlayerRecord) => Math.min(...p.build.filter((b) => b.kind === "upgrade" && CASTER_TRAINING.has(b.code)).map((b) => b.ms));

/** Pros order their first attack upgrade by about 9:00 (90% by 12:00). None by 15:00 in a longer game is a gap. */
export function upgradesFinding(c: Ctx): Finding | null {
  const m = c.me.metrics;
  // Caster training doesn't excuse it: counting it kept the lift (1.7) and dropped the rule from
  // 24% to 9% of pro losses.
  const first = Math.min(m.first_attack_upgrade_ms ?? Infinity, m.first_armor_upgrade_ms ?? Infinity);
  if (c.r.game.durationMs < 15 * 60_000 || first <= 15 * 60_000) return null;
  return {
    id: "upgrades",
    severity: BASIC + 0.05,
    headline: tr("No attack or armor upgrades for 15 minutes", "Nenhum upgrade de ataque ou armadura em 15 minutos"),
    evidence: [
      tr(`Your first attack upgrade: ${mmss(m.first_attack_upgrade_ms)}; first armor upgrade: ${mmss(m.first_armor_upgrade_ms)} ${c.ref?.mp.metrics.first_attack_upgrade_ms ? ` (pros in this matchup: first attack upgrade by ${mmss(c.ref.mp.metrics.first_attack_upgrade_ms.p50)}, median of those who got one)` : ""}.`, `Seu primeiro upgrade de ataque: ${mmss(m.first_attack_upgrade_ms)}; primeiro upgrade de armadura: ${mmss(m.first_armor_upgrade_ms)} ${c.ref?.mp.metrics.first_attack_upgrade_ms ? ` (pros neste confronto: primeiro upgrade de ataque até ${mmss(c.ref.mp.metrics.first_attack_upgrade_ms.p50)}, mediana dos que fizeram)` : ""}.`),
      tr(`Opp's: attack ${mmss(c.opp.metrics.first_attack_upgrade_ms)}, armor ${mmss(c.opp.metrics.first_armor_upgrade_ms)}.`, `Os do oponente: ataque ${mmss(c.opp.metrics.first_attack_upgrade_ms)}, armadura ${mmss(c.opp.metrics.first_armor_upgrade_ms)}.`),
    ],
  };
}

/** A long game on one hero while the opponent had more (one-hero builds exist, so only then). */
export function oneHeroFinding(c: Ctx): Finding | null {
  if (c.r.game.durationMs < 15 * 60_000 || c.me.heroes.length !== 1 || c.opp.heroes.length < 2) return null;
  return {
    id: "one_hero",
    severity: BASIC,
    headline: tr("One hero against several", "Um herói contra vários"),
    evidence: [tr(`You played ${mmss(c.r.game.durationMs)} with one hero (${c.me.heroes[0].name}); opp had ${c.opp.heroes.length} (${c.opp.heroes.map((h) => h.name).join(", ")}). Pros get their second hero around 7:00.`, `Você jogou ${mmss(c.r.game.durationMs)} com um herói (${c.me.heroes[0].name}); o oponente teve ${c.opp.heroes.length} (${c.opp.heroes.map((h) => h.name).join(", ")}). Os pros pegam o segundo herói por volta de 7:00.`)],
  };
}

/** Items (potions, scrolls, Town Portal) keep heroes alive; most pros buy a few. */
export function noItemsFinding(c: Ctx): Finding | null {
  if (c.r.game.durationMs < 12 * 60_000 || (c.me.metrics.items_bought ?? 0) > 0) return null;
  return {
    id: "no_items",
    severity: BASIC,
    headline: tr("You never used the shop", "Você nunca usou a loja"),
    evidence: [tr(`Items bought: you 0, opp ${num(c.opp.metrics.items_bought)} (pros: about 5 a game). Potions, healing scrolls and a Town Portal save heroes and units.`, `Itens comprados: você 0, oponente ${num(c.opp.metrics.items_bought)} (pros: uns 5 por partida). Poções, pergaminhos de cura e um Town Portal salvam heróis e unidades.`)],
  };
}

/** Unspent gold in the first 10 minutes (estimate): money in the bank is army or tech you don't have. */
export function floatingFinding(c: Ctx): Finding | null {
  const avg = c.me.metrics.est_bank_avg;
  const pro = c.ref?.mp.metrics.est_bank_avg;
  if (avg === null || avg === undefined || !pro || pro.values.length < 10) return null;
  const p90 = [...pro.values].sort((a, b) => a - b)[Math.floor(pro.values.length * 0.9)];
  if (avg <= Math.max(p90, 400)) return null;
  return {
    id: "floating",
    severity: BASIC,
    headline: tr("Gold sat unspent", "Ouro ficou parado"),
    evidence: [tr(`Average unspent gold over the first 10 minutes: ≈${Math.round(avg)} (pros median ≈${Math.round(pro.p50)}; 9 in 10 below ≈${Math.round(p90)}). Estimated from your workers and spending.`, `Média de ouro parado nos primeiros 10 minutos: ≈${Math.round(avg)} (mediana dos pros ≈${Math.round(pro.p50)}; 9 em cada 10 abaixo de ≈${Math.round(p90)}). Estimado pelos seus trabalhadores e gastos.`)],
  };
}

/** The opponent started an expansion while your army was bigger, and you left it alone for 4 minutes. */
export function unansweredExpansionFinding(c: Ctx): Finding | null {
  const t = expansionTimes(c.r, c.opp).find((x) => x > 60_000);
  if (t === undefined || c.r.sim?.status !== "ok") return null;
  const mine = at(seriesOf(c.r, c.me), t)?.armyValue ?? 0;
  const theirs = at(seriesOf(c.r, c.opp), t)?.armyValue ?? 0;
  if (mine <= theirs || mine === 0) return null;
  const fought = (c.r.sim.fights ?? []).some((f) => f.start >= t && f.start <= t + 240_000 && f.playerIds.includes(c.me.playerId) && f.playerIds.includes(c.opp.playerId));
  if (fought) return null;
  return {
    id: "unanswered_expansion",
    severity: BASIC,
    headline: tr("Their expansion went unchallenged", "A expansão deles ficou sem resposta"),
    evidence: [tr(`Opp started an expansion at ${mmss(t)} while your army was bigger (≈${mine} vs ≈${theirs}); no fight between you in the next 4 minutes.`, `O oponente começou uma expansão às ${mmss(t)} com o seu exército maior (≈${mine} contra ≈${theirs}); nenhuma luta entre vocês nos 4 minutos seguintes.`)],
  };
}

/** Grubby: 51 food is "almost no benefit for maximum disadvantage": low upkeep for one extra unit. */
export function justOver50Finding(c: Ctx): Finding | null {
  const series = seriesOf(c.r, c.me);
  let seconds = 0;
  for (let i = 1; i < series.length; i++) {
    const s = series[i];
    if (s.foodUsed >= 51 && s.foodUsed <= 54 && !fightsNear(c, s.t - 60_000, s.t + 60_000).length) seconds += (s.t - series[i - 1].t) / 1000;
  }
  if (seconds < 120) return null;
  return {
    id: "just_over_50",
    severity: BASIC,
    headline: tr("You sat just over 50 food", "Você ficou logo acima de 50 de food"),
    evidence: [tr(`You spent ${Math.round(seconds)} s at 51-54 food without fighting: that already costs 30% of your gold income (low upkeep) for one or two extra units. Stay at 50 and invest (upgrades, items, a production building), then go well past it right before a fight.`, `Você passou ${Math.round(seconds)} s entre 51 e 54 de food sem lutar: isso já custa 30% da sua renda de ouro (upkeep baixo) por uma ou duas unidades a mais. Fique em 50 e invista (upgrades, itens, um prédio de produção), depois passe bem disso logo antes de uma luta.`)],
  };
}

/** 2026 Human guide (Grubby): one arcane tower and maybe one guard tower per base; more gains little. */
export function towersFinding(c: Ctx): Finding | null {
  const towers = c.me.metrics.towers_total ?? 0; // build and upgrade orders: a guard tower is 2
  const bases = 1 + expansionTimes(c.r, c.me).length;
  if (towers / bases <= Math.max(6, proQ(c, "towersPerBase", "p90") ?? 0)) return null;
  return {
    id: "towers",
    severity: BASIC,
    headline: tr("More towers than they're worth", "Mais torres do que elas valem"),
    evidence: [tr(`Tower build/upgrade orders: ${towers} for ${bases} base${bases > 1 ? "s" : ""} (a guide rule of thumb: an arcane tower and maybe a guard tower per base; after that units are worth more). Kills by towers give your heroes no experience.`, `Ordens de construir/melhorar torres: ${towers} para ${bases} base${bases > 1 ? "s" : ""} (regra prática dos guias: uma arcane tower e talvez uma guard tower por base; depois disso, unidades valem mais). Abates de torres não dão experiência aos seus heróis.`)],
  };
}

/** Human guide: losing about five workers (e.g. while expanding) puts you too far behind. */
export function workersLostFinding(c: Ctx): Finding | null {
  const lost = c.me.metrics.workers_lost_12m ?? 0;
  if (lost < Math.max(5, (proQ(c, "workersLost12", "p90") ?? 0) + 1)) return null;
  return {
    id: "workers_lost",
    severity: BASIC + 0.1,
    headline: tr("You lost too many workers", "Você perdeu trabalhadores demais"),
    evidence: [tr(`Workers lost by ${c.r.game.durationMs < 12 * 60_000 ? `the end (${mmss(c.r.game.durationMs)})` : "12:00"}: ≈${lost} (pros: usually 0-4; deaths are inferred and tend to be undercounted).`, `Trabalhadores perdidos até ${c.r.game.durationMs < 12 * 60_000 ? `o fim (${mmss(c.r.game.durationMs)})` : "12:00"}: ≈${lost} (pros: normalmente 0-4; as mortes são deduzidas e costumam ser subcontadas).`)],
  };
}

/** Grubby's beginner goal "3360": first hero level 3, second hero level 3, 60 food; then seek a fight. */
export function goal3360Finding(c: Ctx): Finding | null {
  const pro = c.ref?.mp.metrics.goal_3360_ms;
  if (!pro || pro.values.length < 10 || c.r.game.durationMs < 15 * 60_000) return null;
  const p75 = [...pro.values].sort((a, b) => a - b)[Math.floor(pro.values.length * 0.75)];
  const got = c.me.metrics.goal_3360_ms;
  if (got !== null && got !== undefined && got <= p75) return null;
  if ((got === null || got === undefined) && c.r.game.durationMs < p75 + 180_000) return null;
  const byOrder = [...c.me.heroes].sort((a, b) => a.order - b.order);
  const food60 = seriesOf(c.r, c.me).find((s) => s.foodUsed >= 60)?.t ?? null;
  return {
    id: "goal_3360",
    severity: BASIC,
    headline: got ? tr("Late to the 3-3-60 goal", "Atrasado na meta 3-3-60") : tr("Never reached the 3-3-60 goal", "Nunca alcançou a meta 3-3-60"),
    evidence: [
      tr(`Grubby's beginner goal: first hero level 3, second hero level 3, 60 food. You: first hero level 3 at ${mmss(byOrder[0]?.levelUps[2] ?? null)}, second hero level 3 at ${mmss(byOrder[1]?.levelUps[2] ?? null)}, 60 food at ${mmss(food60)}${got ? ` (all three at ${mmss(got)})` : ""}. Pros: median ${mmss(pro.p50)}.`, `Meta para iniciantes do Grubby: primeiro herói nível 3, segundo herói nível 3, 60 de food. Você: primeiro herói nível 3 às ${mmss(byOrder[0]?.levelUps[2] ?? null)}, segundo herói nível 3 às ${mmss(byOrder[1]?.levelUps[2] ?? null)}, 60 de food às ${mmss(food60)}${got ? ` (os três às ${mmss(got)})` : ""}. Pros: mediana ${mmss(pro.p50)}.`),
    ],
  };
}

const MINE_GOLD = 12_500;
const tier3Of = (p: PlayerRecord) => p.build.find((b) => b.code === RACES[p.race as RaceCode]?.tier3)?.ms ?? null;

/**
 * Warcraft 3 Gym (all races): "the goal is always to reach 50 supply with level 3 on both heroes",
 * then attack, expand, or tech to tier 3 (Rifle Caster guide; Grubby: "then seek a fight").
 * Fires when 4 minutes after first reaching 50 food you had done none of the three.
 */
export function unusedSpikeFinding(c: Ctx): Finding | null {
  const t50 = seriesOf(c.r, c.me).find((s) => s.foodUsed >= 50)?.t ?? null;
  const until = t50 === null ? null : t50 + 240_000;
  if (t50 === null || until === null || c.r.game.durationMs < until) return null;
  const attacked = fightsNear(c, t50, until).some((f) => f.initiatorId === c.me.playerId && f.playerIds.includes(c.opp.playerId));
  const expanded = expansionTimes(c.r, c.me).some((t) => t >= t50 - 60_000 && t <= until);
  const t3 = tier3Of(c.me);
  const teched = t3 !== null && t3 <= until;
  if (attacked || expanded || teched) return null;
  return {
    id: "unused_spike",
    severity: BASIC + 0.05,
    headline: tr("You reached 50 food and waited", "Você chegou a 50 de food e ficou esperando"),
    evidence: [tr(`You first had 50 food at ${mmss(t50)}. In the next 4 minutes you started no fight with the opponent, took no expansion and didn't start tier 3. Guides: at 50 food (heroes level 3), attack, expand or tech.`, `Você chegou a 50 de food pela primeira vez às ${mmss(t50)}. Nos 4 minutos seguintes não começou nenhuma luta com o oponente, não expandiu e não começou o tier 3. Guias: com 50 de food (heróis nível 3), ataque, expanda ou suba de tier.`)],
  };
}

/**
 * Warcraft 3 Gym (Orc auras guide) and Grubby: don't go over 50 food before investing (attack/armor
 * upgrades), unless you have an expansion.
 */
export function upkeepBeforeUpgradesFinding(c: Ctx): Finding | null {
  const over = seriesOf(c.r, c.me).find((s) => s.foodUsed > 50)?.t ?? null;
  if (over === null) return null;
  const m = c.me.metrics;
  // An upgrade (or caster training) ordered in the next 30 s counts: the food crossing and the
  // click are seconds apart.
  const upgraded = Math.min(m.first_attack_upgrade_ms ?? Infinity, m.first_armor_upgrade_ms ?? Infinity, firstCasterTraining(c.me)) <= over + 30_000;
  const expanded = expansionTimes(c.r, c.me).some((t) => t <= over);
  // Tier 3 is an investment too. (Excusing a fight around that time silenced the rule: the
  // simulation sees some fight nearly all the time.)
  const t3 = tier3Of(c.me);
  const teched = t3 !== null && t3 <= over;
  if (upgraded || expanded || teched) return null;
  return {
    id: "upkeep_before_upgrades",
    severity: BASIC,
    headline: tr("Into upkeep before any upgrade", "Upkeep antes de qualquer upgrade"),
    evidence: [
      tr(`You went over 50 food at ${mmss(over)} with no attack or armor upgrade and no expansion yet (first upgrade: ${mmss(Math.min(m.first_attack_upgrade_ms ?? Infinity, m.first_armor_upgrade_ms ?? Infinity) === Infinity ? null : Math.min(m.first_attack_upgrade_ms ?? Infinity, m.first_armor_upgrade_ms ?? Infinity))}). Guides: invest at 50 food (upgrades, items, a production building), then break upkeep.`, `Você passou de 50 de food às ${mmss(over)} sem nenhum upgrade de ataque ou armadura e sem expansão (primeiro upgrade: ${mmss(Math.min(m.first_attack_upgrade_ms ?? Infinity, m.first_armor_upgrade_ms ?? Infinity) === Infinity ? null : Math.min(m.first_attack_upgrade_ms ?? Infinity, m.first_armor_upgrade_ms ?? Infinity))}). Guias: invista com 50 de food (upgrades, itens, um prédio de produção) e só depois entre no upkeep.`),
    ],
  };
}

/** Warcraft 3 Gym: "expand when your gold mine runs out". A mine holds 12,500 gold. */
export function mineDryFinding(c: Ctx): Finding | null {
  const collected = c.me.metrics.gold_collected;
  if (collected === null || collected === undefined || collected < MINE_GOLD - 1000) return null;
  const exp = expansionTimes(c.r, c.me);
  if (exp.length) return null;
  return {
    id: "mine_dry",
    severity: BASIC + 0.1,
    headline: tr("Your gold mine ran dry with no second base", "Sua mina de ouro secou sem uma segunda base"),
    evidence: [tr(`You collected ≈${Math.round(collected)} gold from one base; a mine holds ${MINE_GOLD}. No expansion was ordered.`, `Você coletou ≈${Math.round(collected)} de ouro com uma base; uma mina tem ${MINE_GOLD}. Nenhuma expansão foi pedida.`)],
  };
}

/**
 * Build discipline: compared with pros who played the same build (closest library build, pros'
 * median food at each step), your tier upgrades, expansion or heroes came much later (6+ food).
 */
export function buildDriftFinding(c: Ctx): Finding | null {
  const principles = c.ref?.principles;
  if (!principles || principles.race !== c.me.race) return null;
  const [best] = matchBuilds(c.r, c.me);
  const pro = proBuildOf(principles, best);
  if (!best || !pro || pro.players < 8) return null;
  // Tier upgrades and expansions only, 8+ food late: pros adapt their builds, and smaller or other
  // differences fired for a third of pro winners.
  const late = deviationsFromPros(best, pro, 8).filter((d) => ["tech", "expand"].includes(d.action) && d.yours !== null && d.yours > d.pros);
  if (!late.length) return null;
  return {
    id: "build_drift",
    severity: BASIC,
    headline: tr("Your key steps came late for your build", "Os passos principais da sua build vieram tarde"),
    evidence: [
      tr(`Closest build: "${best.build.name}" (${best.build.source.author ?? "guide"}); ${pro.players} pros played it (${Math.round(pro.winRate * 100)}% won).`, `Build mais próxima: "${best.build.name}" (${best.build.source.author ?? "guia"}); ${pro.players} pros jogaram ela (${Math.round(pro.winRate * 100)}% venceram).`),
      ...late.map((d) => (d.yours === null ? tr(`No ${d.label}; pros on this build: at ${d.pros} food.`, `Sem ${d.label}; pros nessa build: com ${d.pros} de food.`) : tr(`${d.label} at ${d.yours} food; pros on this build: ${d.pros} food.`, `${d.label} com ${d.yours} de food; pros nessa build: ${d.pros} de food.`))),
      tr("Food counts finished units (the game's counter also includes units in training).", "O food conta unidades prontas (o contador do jogo também inclui unidades em treinamento)."),
    ],
  };
}
