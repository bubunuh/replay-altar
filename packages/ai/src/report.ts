// The report's frame around the findings, written from the game data without a model: a recap
// (result, the main problem and its cause), the fight that turned the game, and the one thing
// to work on next (the top finding's advice).
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import { RACE_NAMES } from "@replay-altar/core/gamedata";
import { nameOf } from "@replay-altar/core/names";
import type { Finding } from "./findings.ts";
import { at, fightLosses, mmss, seriesOf } from "./series.ts";

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
  const died = [...heroes(me).map((n) => `your ${n}`), ...heroes(opp).map((n) => `their ${n}`)];
  const category = top.f.category.replace(/-/g, " ");
  const text = [
    `The game turned at ${mmss(top.f.start)}: a ${category} where you lost ≈${top.me} and they lost ≈${top.opp}${died.length ? `; ${died.join(" and ")} died` : ""}.`,
    // Only "before": units trained during and right after the fight make the value after it misleading.
    before[0] !== undefined && before[1] !== undefined ? `Army value going in: you ${before[0]}, opp ${before[1]}.` : "",
    `Watch the replay from ${mmss(Math.max(0, top.f.start - 15_000))}.`,
  ].filter(Boolean).join(" ");
  return { start: top.f.start, end: top.f.end, category, youLost: top.me, theyLost: top.opp, text };
}

/** One or two sentences: the result, the main problem and its first cause, the next problem. */
export function recapOf(r: GameRecord, opp: PlayerRecord, result: string, found: Finding[], strengths: string[]): string {
  const outcome = result === "win" ? "You won" : result === "loss" ? "You lost" : "The game lasted";
  const head = `${outcome} ${result === "win" || result === "loss" ? "in " : ""}${mmss(r.game.durationMs)} against ${RACE_NAMES[opp.race] ?? opp.race}.`;
  if (!found.length) return `${head} No clear problem stood out${strengths.length ? `; best: ${clause(strengths[0])}` : ""}.`;
  const [top, next] = found;
  const cause = top.because?.[0];
  const lead = result === "win" ? "Still worth fixing" : "The biggest problem";
  return `${head} ${lead}: ${clause(top.headline)}${cause ? ` (${clause(cause)})` : ""}${next ? `; also, ${clause(next.headline)}` : ""}.`;
}
