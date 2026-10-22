import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";
import type { GameRecord, SimSample } from "@replay-altar/core/ui";
import { mapActivity } from "../src/mapActivity.ts";

const gz = (file: string, data: unknown) => writeFileSync(file, gzipSync(JSON.stringify(data)));

// A 2000×2000 map centred on 0,0: world (x, y) lands at ((x + 1000) / 2000, (1000 - y) / 2000).
const root = mkdtempSync(join(tmpdir(), "replay-altar-map-"));
mkdirSync(join(root, "client/maps/TestMap"), { recursive: true });
gz(join(root, "client/maps/TestMap/wpm.json.gz"), { grid: [[{ x: -1000, y: 1000 }], [{ x: 968, y: -968 }]] });

const series = (lost: (t: number) => number): SimSample[] =>
  Array.from({ length: 61 }, (_, i) => ({ t: i * 10_000, goldLost: lost(i * 10_000), lumberLost: 0 }) as SimSample);
const fight = (start: number, end: number) => ({ start, end, category: "army-fight", initiatorId: 1, playerIds: [1, 2], involvesHero: false, involvesAir: false });

// Team ids differ from player ids, as in real games: WC3V credits camps to a team.
const me = { playerId: 1, teamId: 0, isMe: true, heroes: [], build: [], metrics: {} };
const opp = { playerId: 2, teamId: 1, isMe: false, heroes: [], build: [], metrics: {} };
const output = join(root, "game.wc3v.gz");
gz(output, {
  battles: [{ startTime: 95_000, category: "army-fight", summary: { center: { x: 0, y: 0 } } }],
  world: {
    neutralGroups: {
      a: { bounds: { minX: -600, maxX: -400, minY: -600, maxY: -400 }, totalLevel: 8, claimOwnerId: 0, clearedTime: 60_000 },
      b: { bounds: { minX: 400, maxX: 600, minY: 400, maxY: 600 }, totalLevel: 5, claimOwnerId: 0, clearedTime: 30_000 },
      c: { bounds: { minX: -100, maxX: 100, minY: 400, maxY: 600 }, totalLevel: 12, claimOwnerId: 1, clearedTime: 50_000 },
      d: { bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 }, totalLevel: 3, claimOwnerId: null, clearedTime: null },
    },
  },
  players: {
    "1": { units: [{ isUnit: true, lastPosition: { x: -1000, y: 1000 }, lostState: { state: "dead", since: 130_000 } }] },
    "2": { units: [{ isUnit: true, lastPosition: { x: 500, y: 500 }, lostState: { state: "active", since: 0 } }] },
  },
});
const record = {
  game: { durationMs: 600_000, map: { file: "(2)TestMap.w3x" } },
  classification: { opponentId: 2 },
  players: [me, opp],
  sim: {
    status: "ok",
    outputPath: output,
    // You lose 300 at 1:40 (a battle WC3V saw at the centre) and 400 at 2:10 (no battle: placed where your unit died).
    fights: [fight(95_000, 105_000), fight(125_000, 135_000)],
    players: [
      { playerId: 1, series: series((t) => (t >= 100_000 ? 300 : 0) + (t >= 130_000 ? 400 : 0)), heroes: [] },
      { playerId: 2, series: series((t) => (t >= 100_000 ? 900 : 0)), heroes: [] },
    ],
  },
} as unknown as GameRecord;

describe("map activity", () => {
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const a = mapActivity(join(root, "client/maps/TestMap"), record)!;

  test("fights sit at the battle's centre, or where the units lost in them were last seen", () => {
    expect(a.fights).toEqual([
      { x: 0.5, y: 0.5, start: 95_000, end: 105_000, label: expect.any(String), you: 300, them: 900 },
      { x: 0, y: 0, start: 125_000, end: 135_000, label: expect.any(String), you: 400, them: 0 },
    ]);
  });

  test("cleared camps go to the team that cleared them, numbered in order per player", () => {
    expect(a.camps.map((c) => [c.by, c.order, c.level])).toEqual([
      ["me", 1, 5],
      ["opp", 1, 12],
      ["me", 2, 8],
    ]);
    expect(a.camps[0]).toMatchObject({ x: 0.75, y: 0.25 });
  });

  test("nothing without a simulation or a map in the library", () => {
    expect(mapActivity(join(root, "client/maps/TestMap"), { ...record, sim: { status: "failed" } } as unknown as GameRecord)).toBeNull();
    expect(mapActivity(null, record)).toBeNull();
  });
});
