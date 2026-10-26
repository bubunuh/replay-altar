import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import W3GReplay, { type ParserOutput, type LeaveGameBlock } from "w3gjs";

const require = createRequire(import.meta.url);
// w3gjs does not export package.json; require.resolve("w3gjs") is dist/cjs/index.js. Bundles
// (the installed collector) have no node_modules to look in: the packager writes the version in.
export const PARSER = {
  name: "w3gjs",
  version: process.env.REPLAY_ALTAR_W3GJS_VERSION ?? (require(join(dirname(require.resolve("w3gjs")), "../../package.json")).version as string),
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
  /** Per player id: what the raw actions show that w3gjs's summary leaves out. Absent in raw files from before 0.2.2. */
  actions?: Record<string, PlayerActions>;
};

/** Facts read from one player's raw actions (times in ms of game time). */
export type PlayerActions = {
  /** The player's first selection (action 0x16) and first order (0x10 to 0x14); null when there is none. */
  firstSelectionMs: number | null;
  firstOrderMs: number | null;
  /** Orders the player issued before their first selection. */
  ordersBeforeSelection: number;
  /** Each time the player opened a hero's skill menu (action 0x66): skill picks come in these sessions. */
  skillMenuMs: number[];
  /** Tomes of Retraining bought (the order w3gjs also reads as a retraining). */
  tomeMs: number[];
};

const ORDER_ACTIONS = new Set([0x10, 0x11, 0x12, 0x13, 0x14]);

type DataBlock = { id: number; timeIncrement?: number; commandBlocks?: { playerId: number; actions: { id: number; orderId?: number[] }[] }[] };

/** An order id as w3gjs's objectIdFormatter reads it: four characters, last byte first. */
const fourCC = (b: number[] | undefined) => (b ? String.fromCharCode(...[...b].reverse()) : "");
const TOMES = new Set(["tret", "tert"]);

/** Collects PlayerActions from w3gjs's raw game data blocks, keeping time the way w3gjs does. */
function actionCollector() {
  const out: Record<string, PlayerActions> = {};
  let t = 0;
  const onBlock = (block: DataBlock) => {
    if (block.id === 0x1f || block.id === 0x1e) t += block.timeIncrement ?? 0;
    for (const cb of block.commandBlocks ?? []) {
      const p = (out[String(cb.playerId)] ??= { firstSelectionMs: null, firstOrderMs: null, ordersBeforeSelection: 0, skillMenuMs: [], tomeMs: [] });
      for (const a of cb.actions) {
        if (a.id === 0x16) p.firstSelectionMs ??= t;
        else if (a.id === 0x66) p.skillMenuMs.push(t);
        else if (ORDER_ACTIONS.has(a.id)) {
          if (a.id === 0x10 && TOMES.has(fourCC(a.orderId))) p.tomeMs.push(t);
          p.firstOrderMs ??= t;
          if (p.firstSelectionMs === null) p.ordersBeforeSelection++;
        }
      }
    }
  };
  return { out, onBlock };
}

export async function parseReplay(buffer: Buffer): Promise<RawReplay> {
  const replay = new W3GReplay();
  const actions = actionCollector();
  replay.on("gamedatablock", actions.onBlock);
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
      actions: actions.out,
    }),
  );
}
