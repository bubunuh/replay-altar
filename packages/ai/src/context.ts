// Everything the fact sheet needs for one of your games: record, effective result (with your
// overrides) and the profile of pros playing your race.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getGame, loadConfig, referencePaths, type DB, type GameRecord, type Paths } from "@replay-altar/core/ui";
import { groupForRace, pickProfile } from "@replay-altar/reference/compare";
import type { RefProfile } from "@replay-altar/reference/types";
import { gameFacts, type FactsRef } from "./facts.ts";
import type { Principles } from "./principles.ts";

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
  if (!g || !picked) return null;
  const file = join(referencePaths(g.group.id).root, "principles.json");
  const principles = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Principles) : null;
  return { label: g.group.label, ...picked, principles };
}

export function factsForGame(db: DB, paths: Paths, gameKey: string): { record: GameRecord; result: string; facts: string } {
  const detail = getGame(db, paths, gameKey);
  if (!detail) throw new Error(`no such game: ${gameKey}`);
  const result = detail.row.result ?? "unknown";
  return { record: detail.record, result, facts: gameFacts(detail.record, { result, ref: factsRefFor(detail.record) }) };
}
