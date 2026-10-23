// Everything the fact sheet needs for one of your games: record, effective result (with your
// overrides) and the profile of pros playing your race. Also used by the scripts that score the
// rules, so the app and the scores judge games against the same pro data.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getGame, loadConfig, proDataDir, type DB, type GameRecord, type Paths, type PlayerRecord, type ReferenceGroup } from "@replay-altar/core/ui";
import { groupForRace, pickProfile } from "@replay-altar/reference/compare";
import type { RefProfile } from "@replay-altar/reference/types";
import { gameFacts, type FactsRef } from "./facts.ts";
import type { Principles } from "./principles.ts";

export type RefGroup = { group: ReferenceGroup; profile: RefProfile | null; principles: Principles | null };

const readJson = (file: string) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

/**
 * profile.json and principles.json of each configured reference group, as shipped in
 * data/reference (null when missing). With `principlesDir`, principles come from its principles-<group>.json instead
 * (eval-findings' holdout).
 */
export function loadRefGroups(principlesDir?: string): RefGroup[] {
  const groups = loadConfig().reference.groups;
  const files = groups.map((group) => {
    const root = proDataDir(group.id);
    return { group, profile: join(root, "profile.json"), principles: principlesDir ? join(principlesDir, `principles-${group.id}.json`) : join(root, "principles.json") };
  });
  // Read again only when a file changed: parsing the profiles (about 11 MB) for every game took
  // 15 ms each, seconds for a match list of hundreds of games.
  const stamp = JSON.stringify([groups, files.map((f) => [mtime(f.profile), mtime(f.principles)])]);
  const hit = cached.get(principlesDir ?? "");
  if (hit?.stamp === stamp) return hit.groups;
  const loaded = files.map((f) => ({ group: f.group, profile: readJson(f.profile), principles: readJson(f.principles) }));
  cached.set(principlesDir ?? "", { stamp, groups: loaded });
  return loaded;
}
const cached = new Map<string, { stamp: string; groups: RefGroup[] }>();
const mtime = (file: string) => (existsSync(file) ? statSync(file).mtimeMs : null);

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
