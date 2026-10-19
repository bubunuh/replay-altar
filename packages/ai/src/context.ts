// Everything the fact sheet needs for one of your games: record, effective result (with your
// overrides) and the profile of pros playing your race. Also used by the scripts that score the
// rules, so the app and the scores judge games against the same pro data.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getGame, loadConfig, referencePaths, type DB, type GameRecord, type Paths, type PlayerRecord, type ReferenceGroup } from "@replay-altar/core/ui";
import { groupForRace, pickProfile } from "@replay-altar/reference/compare";
import type { RefProfile } from "@replay-altar/reference/types";
import { gameFacts, type FactsRef } from "./facts.ts";
import type { Principles } from "./principles.ts";

export type RefGroup = { group: ReferenceGroup; profile: RefProfile | null; principles: Principles | null };

const readJson = (file: string) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

/**
 * profile.json and principles.json of each configured reference group (null until the first
 * refresh). With `principlesDir`, principles come from its principles-<group>.json instead
 * (eval-findings' holdout).
 */
export function loadRefGroups(principlesDir?: string): RefGroup[] {
  return loadConfig().reference.groups.map((group) => {
    const root = referencePaths(group.id).root;
    return {
      group,
      profile: readJson(join(root, "profile.json")),
      principles: readJson(principlesDir ? join(principlesDir, `principles-${group.id}.json`) : join(root, "principles.json")),
    };
  });
}

/** The pros of `me`'s race in this matchup (or all their games when the matchup has too few). */
export function refFor(groups: RefGroup[], me: PlayerRecord, opp: PlayerRecord): FactsRef | null {
  const g = groupForRace(groups, me.race);
  const picked = pickProfile(g?.profile, `${me.race}v${opp.race}`);
  if (!g || !picked) return null;
  return { label: g.group.label, ...picked, principles: g.principles };
}

/** The game seen from one player's side: the fact sheet and the report are written for "you". */
export function asPlayer(r: GameRecord, playerId: number): GameRecord {
  const me = r.players.find((x) => x.playerId === playerId)!;
  const opp = r.players.find((x) => x.playerId !== playerId && x.teamId !== me.teamId) ?? r.players.find((x) => x.playerId !== playerId)!;
  return { ...r, players: r.players.map((x) => ({ ...x, isMe: x.playerId === playerId })), classification: { ...r.classification, opponentId: opp.playerId } };
}

export function factsRefFor(r: GameRecord): FactsRef | null {
  const me = r.players.find((p) => p.isMe);
  const opp = r.players.find((p) => p.playerId === r.classification.opponentId);
  return me && opp ? refFor(loadRefGroups(), me, opp) : null;
}

export function factsForGame(db: DB, paths: Paths, gameKey: string): { record: GameRecord; result: string; facts: string } {
  const detail = getGame(db, paths, gameKey);
  if (!detail) throw new Error(`no such game: ${gameKey}`);
  const result = detail.row.result ?? "unknown";
  return { record: detail.record, result, facts: gameFacts(detail.record, { result, ref: factsRefFor(detail.record) }) };
}
