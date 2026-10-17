// Everything the fact sheet needs for one of your games: record, effective result (with your
// overrides) and the profile of pros playing your race.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getGame, loadConfig, referencePaths, type DB, type GameRecord, type Paths } from "@w3stats/core/ui";
import { groupForRace, pickProfile } from "@w3stats/reference/compare";
import type { RefProfile } from "@w3stats/reference/types";
import { gameFacts, type FactsRef } from "./facts.ts";

export function factsRefFor(r: GameRecord): FactsRef | null {
  const me = r.players.find((p) => p.isMe);
  const opp = r.players.find((p) => p.playerId === r.classification.opponentId);
  if (!me || !opp) return null;
  const groups = loadConfig().reference.groups.map((group) => {
    const file = join(referencePaths(group.id).root, "profile.json");
    return { group, profile: existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RefProfile) : null };
  });
  const g = groupForRace(groups, me.race);
  const picked = pickProfile(g?.profile, `${me.race}v${opp.race}`);
  return g && picked ? { label: g.group.label, ...picked } : null;
}

export function factsForGame(db: DB, paths: Paths, gameKey: string): { record: GameRecord; result: string; facts: string } {
  const detail = getGame(db, paths, gameKey);
  if (!detail) throw new Error(`no such game: ${gameKey}`);
  const result = detail.row.result ?? "unknown";
  return { record: detail.record, result, facts: gameFacts(detail.record, { result, ref: factsRefFor(detail.record) }) };
}
