// Which game a replay is: its key, the same for every copy of the game.
import { createHash } from "node:crypto";
import type { RawReplay } from "./parse.ts";

/**
 * A W3Champions game is named after its match: w3c-<gateway>-<match id>, the match id 9 or 10
 * letters, digits, "-" or "_" (so it can end in "-8" itself). The copy the game saves
 * (LastReplay.w3g) adds "-<number>", each player's own; the W3Champions launcher's copy
 * (w3c-<date>.w3g) has none, and a replay from its site has one or none.
 */
const W3C_PLAYER_SUFFIX = /^(w3c-\d+-[A-Za-z0-9_-]{9,10})-\d+$/;

/** The game's name without a W3Champions player's suffix: the same in every copy of the game. */
export const matchGameName = (gameName: string) => W3C_PLAYER_SUFFIX.exec(gameName)?.[1] ?? gameName;

/** 1: w3gjs's id (up to 0.2.4). 2: without a W3Champions player's suffix (0.2.5). */
export const GAME_KEY_VERSION = 2;

export const GAME_KEY_METHOD = "sha256(randomSeed + non-observer player names by id + gameName), as w3gjs's id, a W3Champions player's -<number> left out of gameName";

/**
 * The game's key: w3gjs's id (its random seed, its players and its name), with the name every
 * copy of the game has. Two copies of a W3Champions game, one named with a player's suffix and one
 * without, are one game.
 */
export function gameKeyOf(raw: Pick<RawReplay, "output" | "meta">): string {
  const name = matchGameName(raw.meta.gameName);
  if (name === raw.meta.gameName) return raw.output.id;
  // w3gjs's generateID(): the players without the observers, by id.
  const players = [...raw.output.players].sort((a, b) => a.id - b.id).map((p) => p.name).join("");
  return createHash("sha256").update(`${raw.meta.randomSeed}${players}${name}`).digest("hex");
}
