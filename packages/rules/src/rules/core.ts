// The main findings: the openings, economy, heroes, fights, supply and bases that decide games
// between players of any level (they rank above the basics and the army rules).
import { tr } from "@replay-altar/core/i18n";
import { at, fightLabel, fightLosses, mmss, sampleBoth, seriesOf, STEP_MS } from "../series.ts";
import { type Ctx, type Finding, expansionTimes, heroLevelSum, heroLevels, num, proGap, proQ, simHeroes, vsPros, workerTarget, BASIC, fightsNear } from "./shared.ts";

/** Opponent had no army units for at least two samples (4 minutes) while you had one. */
export function windowFinding(c: Ctx, mine: boolean): Finding | null {
  const army = sampleBoth(c.r, c.me, c.opp, (s) => s.armyValue ?? 0).filter((x) => x.t > STEP_MS);
  const open = (x: { me: number; opp: number }) => (mine ? x.opp === 0 && x.me > 0 : x.me === 0 && x.opp > 0);
  let best: { from: number; to: number } | null = null;
  let cur: { from: number; to: number } | null = null;
  for (const x of army) {
    if (!open(x)) cur = null;
    else if (cur) cur.to = x.t;
    else cur = { from: x.t, to: x.t };
    if (cur && (!best || cur.to - cur.from > best.to - best.from)) best = { from: cur.from, to: cur.to };
  }
  if (!best || best.to - best.from < STEP_MS) return null;
  const { from: since, to } = best;
  const losses = fightLosses(c.r, c.me, c.opp).filter((x) => x.f.start >= since && x.f.start <= to);
  const theyLost = losses.reduce((n, x) => n + x.opp, 0);
  const youLost = losses.reduce((n, x) => n + x.me, 0);
  const sm = seriesOf(c.r, c.me);
  const so = seriesOf(c.r, c.opp);
  if (!mine) {
    return {
      id: "exposed",
      severity: Math.min(0.9, 0.5 + youLost / 2000),
      headline: tr("You had no army while they had one", "Você ficou sem exército enquanto eles tinham um", "No tenías ejército mientras ellos sí", "Vous n'aviez pas d'armée alors qu'il en avait une"),
      evidence: [
        tr(`You had no army units (army value 0) at every check from ${mmss(since)} to ${mmss(to)}; opp's army value reached ${at(so, to)?.armyValue ?? "—"}.`, `Você não tinha unidades de exército (valor do exército 0) em nenhuma verificação de ${mmss(since)} a ${mmss(to)}; o valor do exército do oponente chegou a ${at(so, to)?.armyValue ?? "—"}.`, `No tuviste unidades de ejército (valor de ejército 0) en ningún control de ${mmss(since)} a ${mmss(to)}; el valor del ejército del rival llegó a ${at(so, to)?.armyValue ?? "—"}.`, `Vous n'aviez aucune unité d'armée (valeur d'armée 0) à chaque relevé de ${mmss(since)} à ${mmss(to)} ; la valeur de l'armée adverse a atteint ${at(so, to)?.armyValue ?? "—"}.`),
        tr(`You lost ≈${youLost} in fights in that time; opp lost ≈${theyLost}.`, `Você perdeu ≈${youLost} em lutas nesse tempo; o oponente perdeu ≈${theyLost}.`, `Perdiste ≈${youLost} en combates en ese tiempo; el rival perdió ≈${theyLost}.`, `Vous avez perdu ≈${youLost} en combats pendant ce temps ; l'adversaire a perdu ≈${theyLost}.`),
      ],
    };
  }
  // Not a window when they put the resources into heroes instead (a hero rush): their heroes
  // were ahead of yours by then.
  if (heroLevelSum(c.opp, to) > heroLevelSum(c.me, to) + 1) return null;
  const expansions = expansionTimes(c.r, c.me);
  const expandedInWindow = expansions.some((t) => t >= since && t <= to);
  const xp = c.me.metrics.hero_xp_10m;
  const xpGap = proGap(c, "hero_xp_10m");
  const used = expandedInWindow || theyLost >= 400 || (xpGap !== null && xpGap.worseThan < 0.5);
  const evidence = [
    tr(`Opp had no army units (army value 0) at every check from ${mmss(since)} to ${mmss(to)}, only heroes and buildings; your army value was ${at(sm, to)?.armyValue ?? "—"} at ${mmss(to)}.`, `O oponente não tinha unidades de exército (valor do exército 0) em nenhuma verificação de ${mmss(since)} a ${mmss(to)}, só heróis e construções; o valor do seu exército era ${at(sm, to)?.armyValue ?? "—"} às ${mmss(to)}.`, `El rival no tuvo unidades de ejército (valor de ejército 0) en ningún control de ${mmss(since)} a ${mmss(to)}, solo héroes y edificios; el valor de tu ejército era ${at(sm, to)?.armyValue ?? "—"} a ${mmss(to)}.`, `L'adversaire n'avait aucune unité d'armée (valeur d'armée 0) à chaque relevé de ${mmss(since)} à ${mmss(to)}, seulement des héros et des bâtiments ; la valeur de votre armée était de ${at(sm, to)?.armyValue ?? "—"} à ${mmss(to)}.`),
    expandedInWindow
      ? tr(`You expanded in that time (${expansions.filter((t) => t >= since && t <= to).map((t) => mmss(t)).join(", ")}).`, `Você expandiu nesse tempo (${expansions.filter((t) => t >= since && t <= to).map((t) => mmss(t)).join(", ")}).`, `Te expandiste en ese tiempo (${expansions.filter((t) => t >= since && t <= to).map((t) => mmss(t)).join(", ")}).`, `Vous vous êtes étendu pendant ce temps (${expansions.filter((t) => t >= since && t <= to).map((t) => mmss(t)).join(", ")}).`)
      : tr(`You did not expand in that time (your first expansion: ${expansions.length ? mmss(expansions[0]) : "none"}).`, `Você não expandiu nesse tempo (sua primeira expansão: ${expansions.length ? mmss(expansions[0]) : "nenhuma"}).`, `No te expandiste en ese tiempo (tu primera expansión: ${expansions.length ? mmss(expansions[0]) : "ninguna"}).`, `Vous ne vous êtes pas étendu pendant ce temps (votre première expansion : ${expansions.length ? mmss(expansions[0]) : "aucune"}).`),
    tr(`Opp lost ≈${theyLost} in fights in that time; you lost ≈${youLost}.`, `O oponente perdeu ≈${theyLost} em lutas nesse tempo; você perdeu ≈${youLost}.`, `El rival perdió ≈${theyLost} en combates en ese tiempo; tú perdiste ≈${youLost}.`, `L'adversaire a perdu ≈${theyLost} en combats pendant ce temps ; vous avez perdu ≈${youLost}.`),
    ...(to >= 600_000 && xp !== null && xp !== undefined ? [tr(`Your hero XP by 10:00: ${num(xp)}${vsPros(c, "hero_xp_10m")}.`, `XP dos seus heróis até 10:00: ${num(xp)}${vsPros(c, "hero_xp_10m")}.`, `La XP de tus héroes hasta 10:00: ${num(xp)}${vsPros(c, "hero_xp_10m")}.`, `XP de vos héros à 10:00 : ${num(xp)}${vsPros(c, "hero_xp_10m")}.`)] : []),
    tr(`Your workers at ${mmss(to)}: ${at(sm, to)?.workers ?? "—"}; opp's: ${at(so, to)?.workers ?? "—"}.`, `Seus trabalhadores às ${mmss(to)}: ${at(sm, to)?.workers ?? "—"}; os do oponente: ${at(so, to)?.workers ?? "—"}.`, `Tus trabajadores a ${mmss(to)}: ${at(sm, to)?.workers ?? "—"}; los del rival: ${at(so, to)?.workers ?? "—"}.`, `Vos ouvriers à ${mmss(to)} : ${at(sm, to)?.workers ?? "—"} ; ceux de l'adversaire : ${at(so, to)?.workers ?? "—"}.`),
  ];
  return used
    ? null // Used well: not a problem worth a finding (the strengths list covers good numbers).
    : { id: "window", severity: Math.min(0.95, 0.6 + (to - since) / 1_200_000), headline: tr("They left a window open and you didn't use it", "Eles deixaram uma brecha e você não aproveitou", "Te dejaron una ventana abierta y no la aprovechaste", "Il a laissé une fenêtre ouverte et vous ne l'avez pas exploitée"), evidence };
}

/** Below the worker target (5 per gold mine + lumber crew) at 6:00 or 10:00, usually from an idle town hall. */
export function economyFinding(c: Ctx): Finding | null {
  const series = seriesOf(c.r, c.me);
  const checks = [
    { t: 360_000, slack: 3, key: "workers6" },
    { t: 600_000, slack: 2, key: "workers10" },
  ]
    .filter(({ t }) => c.r.game.durationMs >= t)
    .map(({ t, slack, key }) => {
      const target = workerTarget(c.r, c.me, t);
      // Short of the guides' target and below 9 in 10 pros of the race: Orc and Undead pros run
      // leaner than the guide numbers (Orc pros plateau at ~12 even on two bases).
      const floor = Math.min(target.target - slack, proQ(c, key, "p10") ?? Infinity);
      return { t, floor, workers: at(series, t)?.workers ?? null, ...target };
    })
    .filter((x) => x.workers !== null);
  const short = checks.filter((x) => x.workers! < x.floor);
  if (!short.length) return null;
  const gap = Math.max(...short.map((x) => x.target - x.workers!));
  const m = c.me.metrics;
  return {
    id: "economy",
    severity: Math.min(0.9, 0.55 + 0.05 * gap),
    headline: tr("You had too few workers", "Você teve poucos trabalhadores", "Tenías muy pocos trabajadores", "Vous aviez trop peu d'ouvriers"),
    evidence: [
      ...checks.map((x) => tr(`Workers at ${mmss(x.t)}: ${x.workers} of the ${x.target} your ${x.bases === 1 ? "base needs" : `${x.bases} bases need`} (5 on gold per base + lumber crew).`, `Trabalhadores às ${mmss(x.t)}: ${x.workers} dos ${x.target} que ${x.bases === 1 ? "a sua base precisa" : `as suas ${x.bases} bases precisam`} (5 no ouro por base + equipe da madeira).`, `Trabajadores a ${mmss(x.t)}: ${x.workers} de los ${x.target} que ${x.bases === 1 ? "necesita tu base" : `necesitan tus ${x.bases} bases`} (5 en el oro por base + equipo de madera).`, `Ouvriers à ${mmss(x.t)} : ${x.workers} sur les ${x.target} ${x.bases === 1 ? "dont votre base a besoin" : `dont vos ${x.bases} bases ont besoin`} (5 sur l'or par base + équipe du bois).`)),
      ...(m.hall_idle_6m_s !== null && m.hall_idle_6m_s !== undefined && (proGap(c, "hall_idle_6m_s")?.worseThan ?? 1) >= 0.5 ? [tr(`Your main hall was idle ${num(m.hall_idle_6m_s)} of the first 360 seconds${vsPros(c, "hall_idle_6m_s")}; it should train workers non-stop until the target.`, `Sua base principal ficou parada ${num(m.hall_idle_6m_s)} dos primeiros 360 segundos${vsPros(c, "hall_idle_6m_s")}; ela deveria treinar trabalhadores sem parar até a meta.`, `Tu edificio principal estuvo parado ${num(m.hall_idle_6m_s)} de los primeros 360 segundos${vsPros(c, "hall_idle_6m_s")}; debería entrenar trabajadores sin parar hasta el objetivo.`, `Votre bâtiment principal est resté inactif ${num(m.hall_idle_6m_s)} des 360 premières secondes${vsPros(c, "hall_idle_6m_s")} ; il devrait produire des ouvriers sans arrêt jusqu'à l'objectif.`)] : []),
      ...(m.workers_lost_12m ? [tr(`Workers lost by 12:00: ≈${m.workers_lost_12m}.`, `Trabalhadores perdidos até 12:00: ≈${m.workers_lost_12m}.`, `Trabajadores perdidos hasta 12:00: ≈${m.workers_lost_12m}.`, `Ouvriers perdus jusqu'à 12:00 : ≈${m.workers_lost_12m}.`)] : []),
    ],
  };
}

/**
 * The longest stretch in which one of your first two heroes gained no level (from appearing, or
 * from its last level, until the next level or the end), with how many levels their heroes
 * gained meanwhile.
 */
export function heroStall(c: Ctx) {
  const end = c.r.game.durationMs;
  const appear = new Map(simHeroes(c, c.me).map((h) => [h.code, h.appearAt]));
  let best: { name: string; level: number; from: number; to: number; theirs: number; theirTop: string } | null = null;
  for (const h of [...c.me.heroes].sort((a, b) => a.order - b.order).slice(0, 2)) {
    const start = appear.get(h.code) ?? h.levelUps[0];
    if (start === null || start === undefined) continue;
    // A hero starts at level 1; its first skill point is spent at once, later ones at each level.
    const marks = [start, ...h.levelUps.slice(1), end];
    for (let i = 0; i + 1 < marks.length; i++) {
      const [from, to] = [marks[i], marks[i + 1]];
      if (best && to - from <= best.to - best.from) continue;
      // Levels gained, not skill points: a hero's first point comes with it at level 1.
      const gained = (x: (typeof c.opp.heroes)[number]) => x.levelUps.slice(1).filter((t) => t > from && t <= to).length;
      const theirs = c.opp.heroes.reduce((n, x) => n + gained(x), 0);
      const top = [...c.opp.heroes].sort((a, b) => gained(b) - gained(a))[0];
      const lv = (t: number) => Math.max(1, top?.levelUps.filter((x) => x <= t).length ?? 1);
      best = { name: h.name, level: i + 1, from, to, theirs, theirTop: top ? tr(`their ${top.name} went from level ${lv(from)} to ${lv(to)}`, `o ${top.name} deles foi do nível ${lv(from)} ao ${lv(to)}`, `su ${top.name} pasó del nivel ${lv(from)} al ${lv(to)}`, `son ${top.name} est passé du niveau ${lv(from)} au niveau ${lv(to)}`) : "" };
    }
  }
  return best;
}
const STALL_MS = 6 * 60_000;

export function heroFinding(c: Ctx): Finding | null {
  const gap = proGap(c, "hero_xp_10m") ?? proGap(c, "hero_xp_6m");
  const share = c.me.metrics.hero_xp_share;
  // A low share of both players' XP goes with losing even when your own pace was like pros'
  // (holdout: 68% of pro losses vs 30% of wins; requiring a slow pace too dropped it to 47%).
  // Then the gap is theirs, not your creeping, and the advice says so.
  const losingShare = share !== null && share !== undefined && share < 0.45;
  if ((gap?.worseThan ?? 0) < 0.75 && !losingShare) return null;
  const ownPaceFine = (gap?.worseThan ?? 1) < 0.5;
  const m = c.me.metrics;
  const end = c.r.game.durationMs;
  return {
    id: "heroes",
    severity: Math.max(gap?.worseThan ?? 0, losingShare ? 0.6 + (0.45 - share!) : 0),
    // Ahead of the opponent but slow by pro standards: say so, not "fell behind" (scan-reports).
    headline: ownPaceFine
      ? tr("Their heroes out-levelled yours", "Os heróis deles upparam mais que os seus", "Sus héroes superaron a los tuyos en nivel", "Ses héros ont pris plus de niveaux que les vôtres")
      : (share ?? 0) >= 0.5 ? tr("Your heroes levelled slower than pros, though faster than theirs", "Seus heróis upparam mais devagar que os dos pros, mas mais rápido que os deles", "Tus héroes subieron de nivel más despacio que los pros, aunque más rápido que los suyos", "Vos héros ont monté de niveau moins vite que les pros, mais plus vite que les siens") : tr("Your heroes fell behind", "Seus heróis ficaram para trás", "Tus héroes se quedaron atrás", "Vos héros ont pris du retard"),
    // Your own pace was the problem (the links then look at your creeping).
    variant: ownPaceFine ? "theirs" : "slow",
    ...(ownPaceFine
      ? { advice: tr("Your own levelling was at pro pace; theirs was faster, much of it from your units. Fight with your heroes alive and focus theirs, don't trade units in small skirmishes, and creep the camps on their side to take that experience away.", "Seu ritmo de nível foi como o dos pros; o deles foi mais rápido, boa parte com as suas unidades. Lute com seus heróis vivos e foque os deles, não troque unidades em escaramuças pequenas e limpe os acampamentos do lado deles para tirar essa experiência.", "Tu propio ritmo de niveles fue de pro; el suyo fue más rápido, en buena parte gracias a tus unidades. Pelea con tus héroes vivos y concéntrate en los suyos, no cambies unidades en escaramuzas pequeñas, y creepea los campamentos de su lado para quitarles esa experiencia.", "Votre propre rythme de niveaux était celui d'un pro ; le sien était plus rapide, en bonne partie grâce à vos unités. Combattez avec vos héros en vie et concentrez-vous sur les siens, n'échangez pas d'unités dans de petites escarmouches, et creepez les camps de son côté pour lui prendre cette expérience.") }
      : {}),
    evidence: [
      tr(`Hero XP by 6:00: you ${num(m.hero_xp_6m)}, opp ${num(c.opp.metrics.hero_xp_6m)}${vsPros(c, "hero_xp_6m")}.`, `XP dos heróis até 6:00: você ${num(m.hero_xp_6m)}, oponente ${num(c.opp.metrics.hero_xp_6m)}${vsPros(c, "hero_xp_6m")}.`, `XP de héroes hasta 6:00: tú ${num(m.hero_xp_6m)}, rival ${num(c.opp.metrics.hero_xp_6m)}${vsPros(c, "hero_xp_6m")}.`, `XP des héros à 6:00 : vous ${num(m.hero_xp_6m)}, adversaire ${num(c.opp.metrics.hero_xp_6m)}${vsPros(c, "hero_xp_6m")}.`),
      ...(m.hero_xp_10m !== null && m.hero_xp_10m !== undefined ? [tr(`Hero XP by 10:00: you ${num(m.hero_xp_10m)}, opp ${num(c.opp.metrics.hero_xp_10m)}${vsPros(c, "hero_xp_10m")}.`, `XP dos heróis até 10:00: você ${num(m.hero_xp_10m)}, oponente ${num(c.opp.metrics.hero_xp_10m)}${vsPros(c, "hero_xp_10m")}.`, `XP de héroes hasta 10:00: tú ${num(m.hero_xp_10m)}, rival ${num(c.opp.metrics.hero_xp_10m)}${vsPros(c, "hero_xp_10m")}.`, `XP des héros à 10:00 : vous ${num(m.hero_xp_10m)}, adversaire ${num(c.opp.metrics.hero_xp_10m)}${vsPros(c, "hero_xp_10m")}.`)] : []),
      ...(m.hero_level3_ms !== null && m.hero_level3_ms !== undefined ? [tr(`First hero level 3 at ${mmss(m.hero_level3_ms)}${vsPros(c, "hero_level3_ms", mmss)}.`, `Primeiro herói no nível 3 às ${mmss(m.hero_level3_ms)}${vsPros(c, "hero_level3_ms", mmss)}.`, `Primer héroe a nivel 3 a ${mmss(m.hero_level3_ms)}${vsPros(c, "hero_level3_ms", mmss)}.`, `Premier héros niveau 3 à ${mmss(m.hero_level3_ms)}${vsPros(c, "hero_level3_ms", mmss)}.`)] : []),
      tr(`Creep camps cleared by 6:00: ${num(m.creep_camps_6m)}${vsPros(c, "creep_camps_6m")}.`, `Acampamentos de creeps limpos até 6:00: ${num(m.creep_camps_6m)}${vsPros(c, "creep_camps_6m")}.`, `Campamentos de creeps limpiados hasta 6:00: ${num(m.creep_camps_6m)}${vsPros(c, "creep_camps_6m")}.`, `Camps de creeps nettoyés avant 6:00 : ${num(m.creep_camps_6m)}${vsPros(c, "creep_camps_6m")}.`),
      ...(share !== null && share !== undefined ? [tr(`Your share of both players' hero XP: ${Math.round(share * 100)}%.`, `Sua parte do XP dos heróis dos dois jogadores: ${Math.round(share * 100)}%.`, `Tu parte de la XP de héroes de ambos jugadores: ${Math.round(share * 100)}%.`, `Votre part de l'XP des héros des deux joueurs : ${Math.round(share * 100)} %.`)] : []),
      tr(`Hero levels at the end: yours ${heroLevels(c.me, end)}; opp's ${heroLevels(c.opp, end)}.`, `Níveis dos heróis no fim: os seus ${heroLevels(c.me, end)}; os do oponente ${heroLevels(c.opp, end)}.`, `Niveles de los héroes al final: los tuyos ${heroLevels(c.me, end)}; los del rival ${heroLevels(c.opp, end)}.`, `Niveaux des héros à la fin : les vôtres ${heroLevels(c.me, end)} ; ceux de l'adversaire ${heroLevels(c.opp, end)}.`),
      ...stallLine(c),
    ],
  };
}

const stallLine = (c: Ctx) => {
  const s = heroStall(c);
  return s && s.level <= 3 && s.to - s.from >= STALL_MS && s.theirs >= 2 ? [tr(`Your ${s.name} stayed level ${s.level} from ${mmss(s.from)} to ${mmss(s.to)}; meanwhile ${s.theirTop}.`, `Seu ${s.name} ficou no nível ${s.level} de ${mmss(s.from)} a ${mmss(s.to)}; enquanto isso, ${s.theirTop}.`, `Tu ${s.name} se quedó en el nivel ${s.level} de ${mmss(s.from)} a ${mmss(s.to)}; mientras tanto, ${s.theirTop}.`, `Votre ${s.name} est resté niveau ${s.level} de ${mmss(s.from)} à ${mmss(s.to)} ; pendant ce temps, ${s.theirTop}.`)] : [];
};

export function fightFinding(c: Ctx): Finding | null {
  const losses = fightLosses(c.r, c.me, c.opp);
  const youLost = losses.reduce((n, x) => n + x.me, 0);
  const theyLost = losses.reduce((n, x) => n + x.opp, 0);
  const trade = proGap(c, "trade_efficiency");
  if (youLost <= theyLost * 1.3 || youLost < 800) return null;
  // The whole-game trade (all losses, not only detected fights) at or above the pro median
  // contradicts "your fights cost far more"; seen in reviews of pro games.
  if (trade && trade.worseThan < 0.5) return null;
  const sim = c.r.sim?.status === "ok" ? c.r.sim.players.find((p) => p.playerId === c.me.playerId)?.heroes ?? [] : [];
  const worst = losses.filter((x) => x.me > x.opp).sort((a, b) => b.me - b.opp - (a.me - a.opp)).slice(0, 3).sort((a, b) => a.f.start - b.f.start);
  const deathsNear = (from: number, to: number) => sim.flatMap((h) => h.deaths.filter((d) => d.diedAt >= from - 30_000 && d.diedAt <= to + 30_000).map((d) => tr(`your ${h.name} died ≈${mmss(d.diedAt)}`, `seu ${h.name} morreu ≈${mmss(d.diedAt)}`, `tu ${h.name} murió ≈${mmss(d.diedAt)}`, `votre ${h.name} est mort vers ≈${mmss(d.diedAt)}`)));
  return {
    id: "fights",
    severity: Math.max(trade?.worseThan ?? 0.6, 0.6),
    headline: tr("Your fights cost far more than theirs", "Suas lutas custaram muito mais que as deles", "Tus combates te costaron mucho más que a ellos", "Vos combats vous ont coûté bien plus qu'à lui"),
    evidence: [
      tr(`In fights you lost ≈${youLost}, opp lost ≈${theyLost} (trade efficiency ≈${Math.round((c.me.metrics.trade_efficiency ?? 0) * 100)}%${trade ? `, pros median ${Math.round(trade.median * 100)}%` : ""}).`, `Em lutas você perdeu ≈${youLost}, o oponente perdeu ≈${theyLost} (eficiência nas trocas ≈${Math.round((c.me.metrics.trade_efficiency ?? 0) * 100)}%${trade ? `, mediana dos pros ${Math.round(trade.median * 100)}%` : ""}).`, `En combates perdiste ≈${youLost}, el rival perdió ≈${theyLost} (eficiencia de intercambio ≈${Math.round((c.me.metrics.trade_efficiency ?? 0) * 100)}%${trade ? `, mediana de los pros ${Math.round(trade.median * 100)}%` : ""}).`, `En combats, vous avez perdu ≈${youLost}, l'adversaire ≈${theyLost} (efficacité des échanges ≈${Math.round((c.me.metrics.trade_efficiency ?? 0) * 100)} %${trade ? `, médiane des pros ${Math.round(trade.median * 100)} %` : ""}).`),
      ...worst.map((x) => {
        const d = deathsNear(x.f.start, x.f.end);
        return tr(`${mmss(x.f.start)}–${mmss(x.f.end)} ${fightLabel(x.f.category)}: you lost ≈${x.me}, opp ≈${x.opp}${d.length ? `; ${d.join(", ")}` : ""}.`, `${mmss(x.f.start)}–${mmss(x.f.end)} ${fightLabel(x.f.category)}: você perdeu ≈${x.me}, o oponente ≈${x.opp}${d.length ? `; ${d.join(", ")}` : ""}.`, `${mmss(x.f.start)}–${mmss(x.f.end)} ${fightLabel(x.f.category)}: perdiste ≈${x.me}, el rival ≈${x.opp}${d.length ? `; ${d.join(", ")}` : ""}.`, `${mmss(x.f.start)}–${mmss(x.f.end)} ${fightLabel(x.f.category)} : vous avez perdu ≈${x.me}, l'adversaire ≈${x.opp}${d.length ? `; ${d.join(", ")}` : ""}.`);
      }),
    ],
  };
}

export function supplyFinding(c: Ctx): Finding | null {
  const g = proGap(c, "supply_blocked_s");
  // Compared per 10 minutes: in a 5-minute game 13 s looked like 26. Under 30 s isn't worth a finding.
  if (!g || g.worseThan < 0.75 || (c.me.metrics.supply_blocked_s ?? 0) < 30) return null;
  return {
    id: "supply",
    severity: 0.4 + g.worseThan / 4,
    headline: tr("You got supply blocked", "Você ficou travado no food", "Te quedaste bloqueado por food", "Vous avez été bloqué par la food"),
    evidence: [tr(`Time supply blocked: ${num(c.me.metrics.supply_blocked_s)} s${vsPros(c, "supply_blocked_s")}.`, `Tempo travado no food: ${num(c.me.metrics.supply_blocked_s)} s${vsPros(c, "supply_blocked_s")}.`, `Tiempo bloqueado por food: ${num(c.me.metrics.supply_blocked_s)} s${vsPros(c, "supply_blocked_s")}.`, `Temps bloqué par la food : ${num(c.me.metrics.supply_blocked_s)} s${vsPros(c, "supply_blocked_s")}.`)],
  };
}

/**
 * Played without control groups or hotkeys: shown whenever it happens, win or lose, because it
 * caps how much a player can do. The limits sit below 99 in 100 tournament player-games (8,294
 * of them, 2022-2026: at least 2 groups, 8.6 group recalls a minute and 23% of selections by
 * hotkey at the 1st percentile).
 */
export const HOTKEY_LIMITS = { groups: 1, recallsPerMin: 5, hotkeyShare: 0.15 };

export function mechanicsFinding(c: Ctx): Finding | null {
  const m = c.me.metrics;
  if (m.control_groups_used == null || m.control_group_recalls_per_min == null || m.hotkey_select_share == null) return null;
  const noGroups = m.control_groups_used <= HOTKEY_LIMITS.groups || m.control_group_recalls_per_min < HOTKEY_LIMITS.recallsPerMin;
  const noHotkeys = m.hotkey_select_share < HOTKEY_LIMITS.hotkeyShare;
  if (!noGroups && !noHotkeys) return null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return {
    id: "mechanics",
    severity: 0.6,
    headline: noGroups
      ? tr("You played without control groups", "Você jogou sem grupos de controle", "Jugaste sin grupos de control", "Vous avez joué sans groupes de contrôle")
      : tr("You selected almost everything with the mouse", "Você selecionou quase tudo com o mouse", "Seleccionaste casi todo con el ratón", "Vous avez presque tout sélectionné à la souris"),
    evidence: [
      tr(`Control groups used: ${num(m.control_groups_used)}; recalls per minute: ${num(m.control_group_recalls_per_min)}${vsPros(c, "control_group_recalls_per_min")}.`, `Grupos de controle usados: ${num(m.control_groups_used)}; chamadas por minuto: ${num(m.control_group_recalls_per_min)}${vsPros(c, "control_group_recalls_per_min")}.`, `Grupos de control usados: ${num(m.control_groups_used)}; llamadas por minuto: ${num(m.control_group_recalls_per_min)}${vsPros(c, "control_group_recalls_per_min")}.`, `Groupes de contrôle utilisés : ${num(m.control_groups_used)} ; rappels par minute : ${num(m.control_group_recalls_per_min)}${vsPros(c, "control_group_recalls_per_min")}.`),
      tr(`Selections via hotkey: ${pct(m.hotkey_select_share)}${vsPros(c, "hotkey_select_share", pct)}.`, `Seleções por atalho: ${pct(m.hotkey_select_share)}${vsPros(c, "hotkey_select_share", pct)}.`, `Selecciones con atajo: ${pct(m.hotkey_select_share)}${vsPros(c, "hotkey_select_share", pct)}.`, `Sélections par raccourci : ${pct(m.hotkey_select_share)}${vsPros(c, "hotkey_select_share", pct)}.`),
      tr("99 in 100 tournament players use at least 2 groups and select about a quarter or more of the time by hotkey.", "99 em cada 100 jogadores de torneio usam pelo menos 2 grupos e selecionam pelo atalho em um quarto das vezes ou mais.", "99 de cada 100 jugadores de torneo usan al menos 2 grupos y seleccionan con atajo una cuarta parte de las veces o más.", "99 joueurs de tournoi sur 100 utilisent au moins 2 groupes et sélectionnent par raccourci au moins un quart du temps."),
    ],
  };
}

/** Official basics: keep heroes alive "at all costs"; a Town Portal is the way out. */
export function heroDeathsFinding(c: Ctx): Finding | null {
  const mine = simHeroes(c, c.me).flatMap((h) => h.deaths.map((d) => ({ h, d })));
  const theirs = simHeroes(c, c.opp).reduce((n, h) => n + h.deaths.length, 0);
  if (mine.length < 2 || mine.length <= theirs) return null;
  const m = c.me.metrics;
  return {
    id: "hero_deaths",
    severity: Math.min(0.9, 0.55 + 0.1 * (mine.length - theirs)),
    headline: tr("You lost your heroes too often", "Você perdeu seus heróis vezes demais", "Perdiste a tus héroes demasiadas veces", "Vous avez perdu vos héros trop souvent"),
    evidence: [
      tr(`Your heroes died ${mine.length} times, opp's ${theirs}: `, `Seus heróis morreram ${mine.length} vezes, os do oponente ${theirs}: `, `Tus héroes murieron ${mine.length} veces, los del rival ${theirs}: `, `Vos héros sont morts ${mine.length} fois, ceux de l'adversaire ${theirs} : `) +
        `${mine
          .sort((a, b) => a.d.diedAt - b.d.diedAt)
          .map(({ h, d }) => `${h.name} ≈${mmss(d.diedAt)}${d.revivedAt !== null && d.revivedAt <= c.r.game.durationMs ? tr(` (back ${mmss(d.revivedAt)})`, ` (voltou ${mmss(d.revivedAt)})`, ` (volvió a ${mmss(d.revivedAt)})`, ` (revenu à ${mmss(d.revivedAt)})`) : tr(" (not back before the end)", " (não voltou antes do fim)", " (no volvió antes del final)", " (pas revenu avant la fin)")}`)
          .join(", ")}.`,
      tr(`Town Portals bought: you ${num(m.tp_bought)}, opp ${num(c.opp.metrics.tp_bought)}. Potions bought: you ${num(m.potions_bought)}, opp ${num(c.opp.metrics.potions_bought)}.`, `Town Portals comprados: você ${num(m.tp_bought)}, oponente ${num(c.opp.metrics.tp_bought)}. Poções compradas: você ${num(m.potions_bought)}, oponente ${num(c.opp.metrics.potions_bought)}.`, `Town Portals comprados: tú ${num(m.tp_bought)}, rival ${num(c.opp.metrics.tp_bought)}. Pociones compradas: tú ${num(m.potions_bought)}, rival ${num(c.opp.metrics.potions_bought)}.`, `Town Portals achetés : vous ${num(m.tp_bought)}, adversaire ${num(c.opp.metrics.tp_bought)}. Potions achetées : vous ${num(m.potions_bought)}, adversaire ${num(c.opp.metrics.potions_bought)}.`),
    ],
  };
}

/** Official basics: when all your heroes are dead, retreat (no experience, no spells). */
export function noHeroesFinding(c: Ctx): Finding | null {
  const heroes = simHeroes(c, c.me).filter((h) => h.appearAt !== null);
  if (!heroes.length) return null;
  const allDead = (t: number) =>
    heroes.every((h) => h.appearAt! > t || h.deaths.some((d) => d.diedAt <= t && (d.revivedAt === null || d.revivedAt > t))) && heroes.some((h) => h.appearAt! <= t);
  // Defending your own base when they attack it can't be avoided by retreating.
  const atHome = (x: { f: { category: string; initiatorId: number | null } }) => x.f.initiatorId === c.opp.playerId && (x.f.category === "tower-dive" || x.f.category === "base-defense");
  const losses = fightLosses(c.r, c.me, c.opp).filter((x) => !atHome(x) && (allDead(x.f.start) || allDead((x.f.start + x.f.end) / 2)));
  const lost = losses.reduce((n, x) => n + x.me, 0);
  if (lost < 300) return null;
  return {
    id: "no_heroes",
    severity: Math.min(0.85, 0.55 + lost / 4000),
    headline: tr("You kept fighting with all heroes dead", "Você continuou lutando com todos os heróis mortos", "Seguiste peleando con todos tus héroes muertos", "Vous avez continué à combattre avec tous vos héros morts"),
    evidence: [
      ...losses.map((x) => tr(`${mmss(x.f.start)}–${mmss(x.f.end)} ${fightLabel(x.f.category)} while all your heroes were dead: you lost ≈${x.me}, opp ≈${x.opp}.`, `${mmss(x.f.start)}–${mmss(x.f.end)} ${fightLabel(x.f.category)} com todos os seus heróis mortos: você perdeu ≈${x.me}, o oponente ≈${x.opp}.`, `${mmss(x.f.start)}–${mmss(x.f.end)} ${fightLabel(x.f.category)} con todos tus héroes muertos: perdiste ≈${x.me}, el rival ≈${x.opp}.`, `${mmss(x.f.start)}–${mmss(x.f.end)} ${fightLabel(x.f.category)} alors que tous vos héros étaient morts : vous avez perdu ≈${x.me}, l'adversaire ≈${x.opp}.`)),
    ],
  };
}

/**
 * High upkeep (above 80 food: you keep 40% of mined gold). Official page: avoid it unless you have
 * 2-3 expansions. Grubby: only go there "if you intend to use it to fight very soon". Counted
 * with fewer than 2 expansions (also requiring "no fight within 90 s" almost never fired: the
 * simulation sees some fight nearly all the time); the fights are given as evidence instead.
 */
export function upkeepFinding(c: Ctx): Finding | null {
  const series = seriesOf(c.r, c.me);
  const exp = expansionTimes(c.r, c.me);
  let seconds = 0;
  let first: number | null = null;
  for (let i = 1; i < series.length; i++) {
    const s = series[i];
    const bases = exp.filter((t) => t <= s.t).length; // expansions ordered by then
    if (s.foodUsed > 80 && bases < 2) {
      seconds += (s.t - series[i - 1].t) / 1000;
      first ??= s.t;
    }
  }
  // More than 9 in 10 pros of your race (and at least 2 minutes).
  if (seconds < Math.max(120, proQ(c, "highUpkeepFewBases", "p90") ?? 0)) return null;
  const top = Math.max(...series.map((s) => s.foodUsed));
  return {
    id: "upkeep",
    // A basic since the base counts and food got more accurate (holdout lift 1.3 -> 1.0): the
    // simulation's food count keeps dead units, so long games overstate it.
    severity: BASIC,
    headline: tr("You sat in high upkeep on too few bases", "Você ficou em upkeep alto com poucas bases", "Estuviste en upkeep alto con pocas bases", "Vous êtes resté en upkeep élevé avec trop peu de bases"),
    evidence: [
      tr(`You were above 80 food (high upkeep: you keep 40% of the gold your workers mine) for ${Math.round(seconds)} s, from ${mmss(first)}; at most ${top} food. Go that high only right before a fight.`, `Você ficou acima de 80 de food (upkeep alto: você fica com 40% do ouro que seus trabalhadores mineram) por ${Math.round(seconds)} s, a partir de ${mmss(first)}; no máximo ${top} de food. Só suba tanto logo antes de uma luta.`, `Estuviste por encima de 80 de food (upkeep alto: te quedas con el 40% del oro que minan tus trabajadores) durante ${Math.round(seconds)} s, desde ${mmss(first)}; como máximo ${top} de food. Sube tanto solo justo antes de un combate.`, `Vous étiez au-dessus de 80 de food (upkeep élevé : vous ne gardez que 40 % de l'or que minent vos ouvriers) pendant ${Math.round(seconds)} s, à partir de ${mmss(first)} ; au plus ${top} de food. Ne montez aussi haut que juste avant un combat.`),
      tr(`Fights you were in from then on: ${fightsNear(c, first ?? 0, c.r.game.durationMs).map((f) => `${mmss(f.start)} ${fightLabel(f.category)}`).join(", ") || "none"}.`, `Lutas em que você esteve a partir daí: ${fightsNear(c, first ?? 0, c.r.game.durationMs).map((f) => `${mmss(f.start)} ${fightLabel(f.category)}`).join(", ") || "nenhuma"}.`, `Combates en los que estuviste desde entonces: ${fightsNear(c, first ?? 0, c.r.game.durationMs).map((f) => `${mmss(f.start)} ${fightLabel(f.category)}`).join(", ") || "ninguno"}.`, `Combats auxquels vous avez pris part depuis : ${fightsNear(c, first ?? 0, c.r.game.durationMs).map((f) => `${mmss(f.start)} ${fightLabel(f.category)}`).join(", ") || "aucun"}.`),
      tr(`Expansions by ${mmss(first)}: ${exp.filter((t) => t <= (first ?? 0)).length} (your expansions: ${exp.length ? exp.map((t) => mmss(t)).join(", ") : "none"}).`, `Expansões até ${mmss(first)}: ${exp.filter((t) => t <= (first ?? 0)).length} (suas expansões: ${exp.length ? exp.map((t) => mmss(t)).join(", ") : "nenhuma"}).`, `Expansiones hasta ${mmss(first)}: ${exp.filter((t) => t <= (first ?? 0)).length} (tus expansiones: ${exp.length ? exp.map((t) => mmss(t)).join(", ") : "ninguna"}).`, `Expansions avant ${mmss(first)} : ${exp.filter((t) => t <= (first ?? 0)).length} (vos expansions : ${exp.length ? exp.map((t) => mmss(t)).join(", ") : "aucune"}).`),
      tr(`Opp's highest food: ${Math.max(0, ...seriesOf(c.r, c.opp).map((s) => s.foodUsed))}.`, `Maior food do oponente: ${Math.max(0, ...seriesOf(c.r, c.opp).map((s) => s.foodUsed))}.`, `Food máximo del rival: ${Math.max(0, ...seriesOf(c.r, c.opp).map((s) => s.foodUsed))}.`, `Food maximale de l'adversaire : ${Math.max(0, ...seriesOf(c.r, c.opp).map((s) => s.foodUsed))}.`),
    ],
  };
}

/** Liquipedia: Human (and most races) expand early when safe. No expansion, or much later than pros. */
export function expansionFinding(c: Ctx): Finding | null {
  const ms = c.me.metrics.expansion_ms;
  const pro = c.ref?.mp.metrics.expansion_ms;
  if (!pro || pro.values.length < 5) return null;
  const p75 = [...pro.values].sort((a, b) => a - b)[Math.floor(pro.values.length * 0.75)];
  // Tested on 56 pro perspectives: "later than 3 in 4 pros" fired for half of them, wins and
  // losses alike. Only the extreme case is worth saying: a long game on one base while the
  // opponent expanded.
  const late = (ms === null || ms === undefined) && c.r.game.durationMs >= 20 * 60_000 && c.opp.metrics.expansion_ms !== null && c.opp.metrics.expansion_ms !== undefined;
  if (!late) return null;
  return {
    id: "expansion",
    severity: ms === null || ms === undefined ? 0.65 : 0.55,
    headline: ms === null || ms === undefined ? tr("You never expanded", "Você nunca expandiu", "Nunca te expandiste", "Vous ne vous êtes jamais étendu") : tr("You expanded late", "Você expandiu tarde", "Te expandiste tarde", "Vous vous êtes étendu tard"),
    evidence: [
      tr(`Your first expansion: ${ms === null || ms === undefined ? "none" : mmss(ms)}; pros who expanded did it by ${mmss(pro.p50)} (median) and ${mmss(p75)} (three in four).`, `Sua primeira expansão: ${ms === null || ms === undefined ? "nenhuma" : mmss(ms)}; os pros que expandiram fizeram isso até ${mmss(pro.p50)} (mediana) e ${mmss(p75)} (três em cada quatro).`, `Tu primera expansión: ${ms === null || ms === undefined ? "ninguna" : mmss(ms)}; los pros que se expandieron lo hicieron hacia ${mmss(pro.p50)} (mediana) y ${mmss(p75)} (tres de cada cuatro).`, `Votre première expansion : ${ms === null || ms === undefined ? "aucune" : mmss(ms)} ; les pros qui se sont étendus l'ont fait vers ${mmss(pro.p50)} (médiane) et ${mmss(p75)} (trois sur quatre).`),
      tr(`Opp's first expansion: ${mmss(c.opp.metrics.expansion_ms)}.`, `Primeira expansão do oponente: ${mmss(c.opp.metrics.expansion_ms)}.`, `Primera expansión del rival: ${mmss(c.opp.metrics.expansion_ms)}.`, `Première expansion de l'adversaire : ${mmss(c.opp.metrics.expansion_ms)}.`),
    ],
  };
}
