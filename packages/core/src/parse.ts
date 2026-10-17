import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import W3GReplay, { type ParserOutput, type LeaveGameBlock } from "w3gjs";

const require = createRequire(import.meta.url);
// w3gjs does not export package.json; require.resolve("w3gjs") is dist/cjs/index.js.
export const PARSER = {
  name: "w3gjs",
  version: require(join(dirname(require.resolve("w3gjs")), "../../package.json")).version as string,
};

export type SlotRecord = W3GReplay["slots"][number];

/**
 * Everything we keep from a parse, JSON-safe. Stored gzipped next to each game so
 * any derived number can be recomputed or audited without the original parser run.
 */
export type RawReplay = {
  parser: typeof PARSER;
  output: ParserOutput;
  meta: {
    gameName: string;
    gameType: string;
    randomSeed: number;
    playerCount: number;
    startSpotCount: number;
    isPost202ReplayFormat: boolean;
    map: Omit<W3GReplay["meta"]["map"], never>;
    playerRecords: W3GReplay["playerList"];
    slotRecords: SlotRecord[];
    reforgedPlayers: { playerId: number; name: string; clan: string }[];
  };
  header: W3GReplay["info"]["header"];
  subheader: W3GReplay["info"]["subheader"];
  leaveEvents: LeaveGameBlock[];
};

export async function parseReplay(buffer: Buffer): Promise<RawReplay> {
  const replay = new W3GReplay();
  const output = await replay.parse(buffer);
  const m = replay.meta;
  return JSON.parse(
    JSON.stringify({
      parser: PARSER,
      output: { ...output, parseTime: 0 }, // parse time varies per run; zero it so reingest is deterministic
      meta: {
        gameName: m.gameName,
        gameType: m.gameType,
        randomSeed: m.randomSeed,
        playerCount: m.playerCount,
        startSpotCount: m.startSpotCount,
        isPost202ReplayFormat: m.isPost202ReplayFormat,
        map: m.map,
        playerRecords: m.playerRecords,
        slotRecords: m.slotRecords,
        reforgedPlayers: m.reforgedPlayerMetadata.map(({ playerId, name, clan }) => ({ playerId, name, clan })),
      },
      header: replay.info.header,
      subheader: replay.info.subheader,
      leaveEvents: replay.leaveEvents,
    }),
  );
}
