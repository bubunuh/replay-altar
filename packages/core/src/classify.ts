// Decides what kind of game a replay is and whether it gets analyzed.
// Every check is recorded as a rule with its evidence so the decision can be audited later.
import { isRaceCode, LADDER_HOSTS, observerTeamFor } from "./gamedata.ts";
import type { RawReplay } from "./parse.ts";

export const CLASSIFIER_VERSION = 2;

export type Source = "bnet_ladder" | "w3champions" | "custom";
export type Category = "1v1_human" | "vs_ai" | "team" | "ffa" | "observed" | "unknown";
export type SkipReason = "not_1v1" | "vs_ai" | "observed" | "not_me" | "custom_map";

export type Seat = {
  playerId: number;
  name: string;
  teamId: number;
  isComputer: boolean;
  isObserver: boolean;
};

export type Rule = { rule: string; passed: boolean; evidence: string };

/**
 * A fault in the replay file itself. missing_first_selections: the game's own start-of-game
 * selection is missing, so Warcraft III plays the replay back differently from the game that was
 * played (seen in W3Champions/FLO replays, see missingFirstSelections). truncated: the file ends in
 * the middle of a record (FloTV recordings), so the rest of the game is missing.
 */
export type ReplayProblem = "missing_first_selections" | "truncated";

export type Classification = {
  version: number;
  source: Source;
  category: Category;
  analyzed: boolean;
  skipReason: SkipReason | null;
  meId: number | null;
  opponentId: number | null;
  seats: Seat[];
  rules: Rule[];
  /** Absent in records from before classifier version 2. */
  replayProblem?: ReplayProblem | null;
};

/**
 * Orders this early come from the game, not the player (nobody acts in the first half second):
 * at the start each client selects its units and sends them their first orders, and a replay
 * keeps both. Some W3Champions/FLO replays lost the selection but kept the orders; Warcraft III
 * then plays them back wrong from the start (it desynced on all 4 such replays among 48 recorded,
 * and on none of the others). A player whose first real order comes before their first
 * selection (their main hall is selected at the start) is normal: that order comes later.
 */
export const GAME_START_MS = 500;

/** Players whose orders at the very start of the game came before any selection of theirs. */
export function missingFirstSelections(raw: RawReplay): { playerId: number; name: string; orders: number; firstOrderMs: number; firstSelectionMs: number | null }[] {
  if (!raw.actions) return [];
  return raw.output.players.flatMap((p) => {
    const a = raw.actions![String(p.id)];
    if (!a || a.firstOrderMs === null || a.ordersBeforeSelection === 0 || a.firstOrderMs > GAME_START_MS) return [];
    return [{ playerId: p.id!, name: p.name!, orders: a.ordersBeforeSelection, firstOrderMs: a.firstOrderMs, firstSelectionMs: a.firstSelectionMs }];
  });
}


/** Occupied lobby slots, with names joined from the player records. */
export function seatsOf(raw: RawReplay): Seat[] {
  const obsTeam = observerTeamFor(raw.subheader.version);
  const names = new Map(raw.output.players.map((p) => [p.id!, p.name!]));
  for (const r of raw.meta.playerRecords) if (!names.has(r.playerId)) names.set(r.playerId, r.playerName);
  for (const o of raw.meta.reforgedPlayers) if (o.name && !names.has(o.playerId)) names.set(o.playerId, o.name);
  return raw.meta.slotRecords
    .filter((s) => s.slotStatus === 2)
    .map((s) => ({
      playerId: s.playerId,
      name: s.computerFlag ? `Computer (${["easy", "normal", "insane"][s.aiStrength] ?? s.aiStrength})` : names.get(s.playerId) ?? `player ${s.playerId}`,
      teamId: s.teamId,
      isComputer: s.computerFlag === 1,
      isObserver: s.teamId === obsTeam,
    }));
}

export function classify(raw: RawReplay, myAccounts: string[]): Classification {
  const rules: Rule[] = [];
  const rule = (name: string, passed: boolean, evidence: string) => {
    rules.push({ rule: name, passed, evidence });
    return passed;
  };
  const mine = new Set(myAccounts.map((a) => a.toLowerCase()));
  const isMe = (name: string) => mine.has(name.toLowerCase());

  const seats = seatsOf(raw);
  const observers = seats.filter((s) => s.isObserver);
  const ai = seats.filter((s) => !s.isObserver && s.isComputer);
  const humans = seats.filter((s) => !s.isObserver && !s.isComputer);
  const teams = new Set([...humans, ...ai].map((s) => s.teamId));
  const fmt = (list: Seat[]) => list.map((s) => `${s.name}@team${s.teamId}`).join(", ") || "none";

  // --- source -----------------------------------------------------------------------------
  const { gameName } = raw.meta;
  const mapPath = raw.output.map.path ?? "";
  const observerNames = observers.map((s) => s.name);
  const bnet = rule(
    "source.bnet_ladder",
    gameName === "BNet" && observerNames.includes(LADDER_HOSTS.bnet),
    `gamename=${JSON.stringify(gameName)} observers=[${observerNames.join(", ")}] gametype=${raw.meta.gameType}`,
  );
  const w3c =
    !bnet &&
    rule(
      "source.w3champions",
      gameName.startsWith("w3c-") || /w3champions/i.test(mapPath) || observerNames.includes(LADDER_HOSTS.w3c),
      `gamename=${JSON.stringify(gameName)} map=${JSON.stringify(mapPath)} observers=[${observerNames.join(", ")}]`,
    );
  const source: Source = bnet ? "bnet_ladder" : w3c ? "w3champions" : "custom";

  // --- category ---------------------------------------------------------------------------
  rule("seats.players", true, `humans: ${fmt(humans)}; computers: ${fmt(ai)}; observers: ${fmt(observers)}`);
  const me = humans.find((s) => isMe(s.name)) ?? null;
  const meObserving = observers.some((s) => isMe(s.name));
  rule("seats.me_playing", me !== null, me ? `${me.name} is player ${me.playerId} on team ${me.teamId}` : meObserving ? "you are in an observer slot" : `none of [${myAccounts.join(", ")}] is in this game`);

  let category: Category;
  let skipReason: SkipReason | null = null;
  let opponent: Seat | null = null;
  if (!me) {
    category = "observed";
    skipReason = meObserving ? "observed" : "not_me";
  } else if (ai.length > 0) {
    rule("seats.no_computers", false, `${ai.length} computer slot(s)`);
    category = "vs_ai";
    skipReason = "vs_ai";
  } else if (humans.length === 2 && teams.size === 2) {
    rule("seats.two_opposing_humans", true, fmt(humans));
    category = "1v1_human";
    opponent = humans.find((s) => s !== me)!;
  } else {
    const teamSizes = [...teams].map((t) => humans.filter((s) => s.teamId === t).length);
    category = teams.size === humans.length && humans.length > 2 ? "ffa" : humans.length > 2 ? "team" : "unknown";
    rule("seats.two_opposing_humans", false, `${humans.length} humans on ${teams.size} team(s), sizes ${teamSizes.join("v")}`);
    skipReason = "not_1v1";
  }

  // Custom lobbies count only on melee maps: "(n)" filename and both players on a melee race.
  if (category === "1v1_human" && source === "custom") {
    const file = raw.output.map.file ?? "";
    const races = raw.output.players.filter((p) => p.id === me!.playerId || p.id === opponent!.playerId).map((p) => p.raceDetected || p.race);
    const melee = rule(
      "custom.melee_map",
      /^\(\d+\)/.test(file) && races.length === 2 && races.every((r) => isRaceCode(r)),
      `map file ${JSON.stringify(file)}, detected races [${races.join(", ")}]`,
    );
    if (!melee) skipReason = "custom_map";
  }

  // --- the replay file itself -----------------------------------------------------------------
  let replayProblem: ReplayProblem | null = null;
  if (raw.actions) {
    const missing = missingFirstSelections(raw);
    const fmtMs = (ms: number | null) => (ms === null ? "never" : `${(ms / 1000).toFixed(1)} s`);
    rule(
      "replay.first_selections",
      missing.length === 0,
      missing.length
        ? missing.map((m) => `${m.name}: ${m.orders} order(s) from ${fmtMs(m.firstOrderMs)} before the first selection (${fmtMs(m.firstSelectionMs)})`).join("; ")
        : "every player's first orders follow a selection",
    );
    if (missing.length) replayProblem = "missing_first_selections";
  }
  if (raw.truncated) {
    const at = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
    rule("replay.complete", false, `the file is cut short: its data ends at ${at(raw.truncated.atMs)}, its header says the game lasted ${at(raw.truncated.headerDurationMs)}`);
    replayProblem = "truncated";
  }

  return {
    version: CLASSIFIER_VERSION,
    source,
    category,
    analyzed: category === "1v1_human" && skipReason === null,
    skipReason,
    meId: me?.playerId ?? null,
    opponentId: opponent?.playerId ?? null,
    seats,
    rules,
    replayProblem,
  };
}
