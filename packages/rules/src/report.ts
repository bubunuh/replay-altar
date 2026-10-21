// The report's frame around the findings, written from the game data without a model: a recap
// (result, the main problem and its cause), the fight that turned the game, and the one thing
// to work on next (the top finding's advice).
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import { RACE_NAMES } from "@replay-altar/core/gamedata";
import { nameOf } from "@replay-altar/core/names";
import { tr } from "@replay-altar/core/i18n";
import type { Finding } from "./findings.ts";
import { at, fightLabel, fightLosses, levelXp, mmss, seriesOf } from "./series.ts";

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const clause = (s: string) => lowerFirst(s.replace(/\.$/, ""));

export type TurningPoint = { start: number; end: number; category: string; youLost: number; theyLost: number; text: string };

/**
 * The fight with the biggest swing for the side that lost the game (in an unknown result, the
 * biggest either way), if it was large (500+ more lost by one side).
 */
export function turningPoint(r: GameRecord, me: PlayerRecord, opp: PlayerRecord, result: string): TurningPoint | null {
  const fights = fightLosses(r, me, opp).filter((x) => x.f.playerIds.includes(opp.playerId) && x.f.playerIds.includes(me.playerId) && x.f.category !== "creep-fight");
  const swing = (x: (typeof fights)[number]) => (result === "win" ? x.opp - x.me : result === "loss" ? x.me - x.opp : Math.abs(x.me - x.opp));
  const top = [...fights].sort((a, b) => swing(b) - swing(a))[0];
  if (!top || swing(top) < 500) return null;
  const sm = seriesOf(r, me);
  const so = seriesOf(r, opp);
  const before = [at(sm, top.f.start - 10_000)?.armyValue, at(so, top.f.start - 10_000)?.armyValue];
  const heroes = (p: PlayerRecord) =>
    r.sim?.status === "ok"
      ? (r.sim.players.find((x) => x.playerId === p.playerId)?.heroes ?? []).flatMap((h) => h.deaths.filter((d) => d.diedAt >= top.f.start - 10_000 && d.diedAt <= top.f.end + 30_000).map(() => nameOf(h.code)))
      : [];
  // Hero deaths from the hero timelines, plus those WC3V's battle summary counted.
  // Only heroes the player trained: the summary sometimes files an enemy hero under the wrong side.
  const fromSummary = (p: PlayerRecord) => (top.f.losses?.[String(p.playerId)]?.heroes ?? []).filter((code) => p.heroes.some((h) => h.code === code)).map((code) => nameOf(code));
  const both = (p: PlayerRecord) => [...new Set([...heroes(p), ...fromSummary(p)])];
  const died = [...both(me).map((n) => tr(`your ${n}`, `seu ${n}`, `tu ${n}`, `votre ${n}`)), ...both(opp).map((n) => tr(`their ${n}`, `o ${n} deles`, `su ${n}`, `son ${n}`))];
  // Already far ahead going in: the fight finished a lead built earlier, so say when it began.
  const ahead = result === "win" ? [sm, so] : result === "loss" ? [so, sm] : null;
  const [fa, fb] = result === "win" ? before : [before[1], before[0]];
  let built = "";
  if (ahead && fa !== undefined && fb !== undefined && fa >= 2 * fb && fa - fb >= 1000) {
    const [a, b] = ahead;
    let from = top.f.start;
    for (let i = a.length - 1; i >= 0; i--) {
      if (a[i].t > top.f.start) continue;
      const other = at(b, a[i].t)?.armyValue ?? 0;
      if ((a[i].armyValue ?? 0) <= other) break;
      from = a[i].t;
    }
    built =
      result === "win"
        ? tr(`You were already far ahead going in: your army had been bigger since ${mmss(from)}.`, `Você já entrou muito na frente: seu exército era maior desde ${mmss(from)}.`, `Ya ibas muy por delante: tu ejército era más grande desde ${mmss(from)}.`, `Vous étiez déjà très en avance : votre armée était plus grande depuis ${mmss(from)}.`)
        : tr(`They were already far ahead going in: their army had been bigger since ${mmss(from)}.`, `Eles já entraram muito na frente: o exército deles era maior desde ${mmss(from)}.`, `Ya iban muy por delante: su ejército era más grande desde ${mmss(from)}.`, `Il était déjà très en avance : son armée était plus grande depuis ${mmss(from)}.`);
  }
  const category = fightLabel(top.f.category);
  const deaths = died.length > 1 ? `${died.slice(0, -1).join(", ")}${tr(" and ", " e ", " y ", " et ")}${died.at(-1)}` : died[0];
  const text = [
    tr(
      `The game turned at ${mmss(top.f.start)}: ${/^[aeiou]/.test(category) ? "an" : "a"} ${category} where you lost ≈${top.me} and they lost ≈${top.opp}${died.length ? `; ${deaths} died` : ""}.`,
      `A partida virou às ${mmss(top.f.start)}: ${category}, em que você perdeu ≈${top.me} e eles perderam ≈${top.opp}${died.length ? `; ${died.length > 1 ? "morreram" : "morreu"} ${deaths}` : ""}.`,
      `La partida cambió a ${mmss(top.f.start)}: ${category}, en la que perdiste ≈${top.me} y ellos perdieron ≈${top.opp}${died.length ? `; ${died.length > 1 ? "murieron" : "murió"} ${deaths}` : ""}.`,
      `La partie a basculé à ${mmss(top.f.start)} : ${category}, où vous avez perdu ≈${top.me} et lui ≈${top.opp}${died.length ? ` ; ${deaths} ${died.length > 1 ? "sont morts" : "est mort"}` : ""}.`,
    ),
    // Only "before": units trained during and right after the fight make the value after it misleading.
    before[0] !== undefined && before[1] !== undefined ? tr(`Army value going in: you ${before[0]}, opp ${before[1]}.`, `Valor dos exércitos antes: você ${before[0]}, oponente ${before[1]}.`, `Valor de los ejércitos antes: tú ${before[0]}, rival ${before[1]}.`, `Valeur des armées avant : vous ${before[0]}, adversaire ${before[1]}.`) : "",
    built,
    tr(`Watch the replay from ${mmss(Math.max(0, top.f.start - 15_000))}.`, `Assista o replay a partir de ${mmss(Math.max(0, top.f.start - 15_000))}.`, `Mira el replay desde ${mmss(Math.max(0, top.f.start - 15_000))}.`, `Regardez le replay à partir de ${mmss(Math.max(0, top.f.start - 15_000))}.`),
  ].filter(Boolean).join(" ");
  return { start: top.f.start, end: top.f.end, category, youLost: top.me, theyLost: top.opp, text };
}

/** What the report can't see: no simulation, or a long game in which it detected no fights. */
function blindSpot(r: GameRecord): string {
  if (r.sim?.status !== "ok") return tr(" The replay couldn't be simulated, so fights and army sizes aren't judged.", " Não foi possível simular o replay, então lutas e tamanho de exército não são avaliados.", " No se pudo simular el replay, así que no se juzgan los combates ni el tamaño de los ejércitos.", " Le replay n'a pas pu être simulé, donc les combats et la taille des armées ne sont pas jugés.");
  const fights = (r.sim.fights ?? []).filter((f) => f.category !== "creep-fight" && f.playerIds.length >= 2);
  if (r.game.durationMs >= 10 * 60_000 && !fights.length) return tr(" The simulation detected no fights in this game, so fights aren't judged.", " A simulação não detectou lutas nesta partida, então as lutas não são avaliadas.", " La simulación no detectó combates en esta partida, así que no se juzgan los combates.", " La simulation n'a détecté aucun combat dans cette partie, donc les combats ne sont pas jugés.");
  return "";
}

/**
 * For a loss with no finding: how the game went from the numbers (seen in scans of pro losses
 * where "no clear problem" was all the report said).
 */
function lossShape(r: GameRecord, opp: PlayerRecord): string {
  const me = r.players.find((p) => p.playerId !== opp.playerId && p.teamId !== opp.teamId);
  if (!me || r.sim?.status !== "ok") return "";
  const sm = seriesOf(r, me).filter((s) => s.t >= 120_000);
  const so = seriesOf(r, opp);
  // Since when they led to the end, by one measure; null when you led at the end.
  const since = (theirs: (t: number) => number, mine: (t: number) => number) => {
    let from: number | null = null;
    for (let i = sm.length - 1; i >= 0 && theirs(sm[i].t) > mine(sm[i].t); i--) from = sm[i].t;
    return from;
  };
  const army = since((t) => at(so, t)?.armyValue ?? 0, (t) => at(sm, t)?.armyValue ?? 0);
  const xp = since((t) => levelXp(opp, t), (t) => levelXp(me, t));
  if (army === null) return tr(" Your army was bigger at the end, so the game was decided outside the fights the replay shows (buildings lost, or a leave).", " Seu exército era maior no fim, então a partida foi decidida fora das lutas que o replay mostra (construções perdidas, ou alguém saiu).", " Tu ejército era más grande al final, así que la partida se decidió fuera de los combates que muestra el replay (edificios perdidos, o un abandono).", " Votre armée était plus grande à la fin : la partie s'est donc décidée hors des combats que montre le replay (bâtiments perdus, ou un abandon).");
  return tr(
    ` Their army was bigger from ${mmss(army)} to the end${xp !== null ? `, and their heroes ahead from ${mmss(xp)}` : ""}: no single mistake explains it, so watch the replay from ${mmss(army)} to see how they pulled ahead.`,
    ` O exército deles foi maior de ${mmss(army)} até o fim${xp !== null ? `, e os heróis deles estavam na frente desde ${mmss(xp)}` : ""}: nenhum erro sozinho explica isso, então assista o replay a partir de ${mmss(army)} para ver como eles abriram vantagem.`,
    ` Su ejército fue más grande desde ${mmss(army)} hasta el final${xp !== null ? `, y sus héroes iban por delante desde ${mmss(xp)}` : ""}: ningún error concreto lo explica, así que mira el replay desde ${mmss(army)} para ver cómo se adelantaron.`,
    ` Son armée a été plus grande de ${mmss(army)} jusqu'à la fin${xp !== null ? `, et ses héros en avance à partir de ${mmss(xp)}` : ""} : aucune erreur précise ne l'explique, alors regardez le replay à partir de ${mmss(army)} pour voir comment il a pris l'avantage.`,
  );
}

/** One or two sentences: the result, the main problem and its first cause, the next problem. */
export function recapOf(r: GameRecord, opp: PlayerRecord, result: string, found: Finding[], strengths: string[]): string {
  const race = RACE_NAMES[opp.race] ?? opp.race;
  const length = mmss(r.game.durationMs);
  const head =
    (result === "win" ? tr(`You won in ${length} against ${race}.`, `Você venceu em ${length} contra ${race}.`, `Ganaste en ${length} contra ${race}.`, `Vous avez gagné en ${length} contre ${race}.`)
    : result === "loss" ? tr(`You lost in ${length} against ${race}.`, `Você perdeu em ${length} contra ${race}.`, `Perdiste en ${length} contra ${race}.`, `Vous avez perdu en ${length} contre ${race}.`)
    : tr(`The game lasted ${length} against ${race}.`, `A partida durou ${length} contra ${race}.`, `La partida duró ${length} contra ${race}.`, `La partie a duré ${length} contre ${race}.`)) + blindSpot(r);
  if (!found.length) return `${head} ${tr("No clear problem stood out", "Nenhum problema claro se destacou", "No destacó ningún problema claro", "Aucun problème net ne ressort")}${strengths.length ? tr(`; best: ${clause(strengths[0])}`, `; o melhor: ${clause(strengths[0])}`, `; lo mejor: ${clause(strengths[0])}`, `; le meilleur : ${clause(strengths[0])}`) : ""}.${result === "loss" ? lossShape(r, opp) : ""}`;
  // Lost while clearly ahead at the end: usually a leave or a disconnect, not the findings.
  const me = r.players.find((p) => p.playerId !== opp.playerId && p.teamId !== opp.teamId);
  const last = (p?: PlayerRecord) => (p ? (seriesOf(r, p).at(-1)?.armyValue ?? 0) : 0);
  const aheadAtEnd = result === "loss" && me && last(me) >= 1.3 * last(opp) && last(me) - last(opp) >= 500;
  const ended = aheadAtEnd
    ? tr(` The game ended while your army was bigger (${last(me)} vs ${last(opp)}): if you didn't leave on purpose, it may have been a disconnect.`, ` A partida acabou com o seu exército maior (${last(me)} contra ${last(opp)}): se você não saiu de propósito, pode ter sido uma desconexão.`, ` La partida terminó cuando tu ejército era más grande (${last(me)} contra ${last(opp)}): si no saliste a propósito, puede haber sido una desconexión.`, ` La partie s'est terminée alors que votre armée était plus grande (${last(me)} contre ${last(opp)}) : si vous n'êtes pas parti exprès, c'était peut-être une déconnexion.`)
    : "";
  if (aheadAtEnd && !found.length) return `${head}${ended}`;
  const [top, next] = found;
  const cause = top.because?.[0];
  const lead = result === "win" ? tr("Still worth fixing", "Ainda vale corrigir", "Aun así vale la pena corregir", "À corriger quand même") : tr("The biggest problem", "O maior problema", "El mayor problema", "Le plus gros problème");
  return `${head}${ended} ${lead}: ${clause(top.headline)}${cause ? ` (${clause(cause)})` : ""}${next ? tr(`; also, ${clause(next.headline)}`, `; além disso, ${clause(next.headline)}`, `; además, ${clause(next.headline)}`, `; aussi, ${clause(next.headline)}`) : ""}.`;
}
