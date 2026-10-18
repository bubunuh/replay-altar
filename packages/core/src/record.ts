// The canonical, self-describing record of one game. Written as games/<game_key>.json;
// the SQLite tables are a queryable projection of these files.
import { basename } from "node:path";
import { classify, type Classification } from "./classify.ts";
import { computeMetrics, METRICS_VERSION, SIM_METRICS, type Metrics } from "./metrics.ts";
import { levelUpTimes } from "./heroxp.ts";
import { dropRepeatedBuildOrders } from "./gamedata.ts";
import { abilityName, nameOf, NAMES_SOURCE } from "./names.ts";
import type { RawReplay } from "./parse.ts";
import { detectResult, type ResultInfo } from "./result.ts";
import type { OfficialStats } from "./official.ts";
import type { SimSummary } from "./sim.ts";

export const SCHEMA_VERSION = 1;

export type TimeSource = "w3c_filename" | "lastreplay_mtime" | "saved_file_mtime";

export type SourceFile = {
  path: string;
  sha256: string;
  size: number;
  mtime: string;
  durationMs: number;
  timeSource: TimeSource;
  endedAt: string;
};

export type BuildEvent = { ms: number; kind: "building" | "unit" | "upgrade" | "item"; code: string; name: string };

export type HeroRecord = {
  order: number;
  code: string;
  name: string;
  level: number;
  /** When it reached level 1 (acquired), 2, 3, ... (retraining re-picks excluded). */
  levelUps: number[];
  skills: { ms: number; code: string; name: string }[];
  retrainings: number;
};

export type PlayerRecord = {
  playerId: number;
  name: string;
  teamId: number;
  racePicked: string;
  race: string;
  isMe: boolean;
  result: "win" | "loss" | "unknown";
  apmPerMinute: number[];
  heroes: HeroRecord[];
  build: BuildEvent[];
  actions: Record<string, number>;
  controlGroups: Record<string, { assigned: number; used: number }>;
  metrics: Metrics;
};

export type GameRecord = {
  schemaVersion: number;
  gameKey: string;
  userLabel: string | null;
  game: {
    playedAt: string;
    endedAt: string;
    timeSource: TimeSource;
    durationMs: number;
    gameName: string;
    gameTypeRaw: string;
    version: string;
    build: number;
    map: { file: string; path: string; checksum: string; checksumSha1: string };
    settings: RawReplay["output"]["settings"];
  };
  classification: Classification;
  result: ResultInfo;
  players: PlayerRecord[];
  chat: { ms: number; player: string; mode: string; message: string }[];
  /** Economy from the simulation layer; absent until the game has been simulated. */
  sim?: SimSummary;
  /** The game's own end-of-game stats (W3Champions games only). */
  official?: OfficialStats;
  /** Metrics whose value came from the official stats instead of our estimate. */
  metricSources?: Record<string, "official">;
  provenance: {
    gameKeyMethod: string;
    canonicalFile: SourceFile;
    files: SourceFile[];
    archivePath: string;
    parser: RawReplay["parser"];
    namesSource: string;
    classifierVersion: number;
    metricsVersion: number;
    ingestedAt: string;
  };
};

const TIME_SOURCE_RANK: Record<TimeSource, number> = { w3c_filename: 0, lastreplay_mtime: 1, saved_file_mtime: 2 };

/** When the game ended, judged from the file it came from. Replays carry no timestamp. */
export function endTimeOf(path: string, mtimeMs: number): { endedAt: string; timeSource: TimeSource } {
  const name = basename(path);
  // W3Champions names files after the UTC time they were written (game end).
  const w3c = /^w3c-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name);
  if (w3c) {
    const [, y, mo, d, h, mi, s] = w3c;
    return { endedAt: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString(), timeSource: "w3c_filename" };
  }
  return {
    endedAt: new Date(mtimeMs).toISOString(),
    // LastReplay.w3g is written when the game ends; hand-saved copies can be saved any time later.
    timeSource: name.toLowerCase() === "lastreplay.w3g" ? "lastreplay_mtime" : "saved_file_mtime",
  };
}

/** The file whose timestamp we trust most; ties go to the earliest end time. */
export function bestTimeFile(files: SourceFile[]): SourceFile {
  return [...files].sort(
    (a, b) => TIME_SOURCE_RANK[a.timeSource] - TIME_SOURCE_RANK[b.timeSource] || a.endedAt.localeCompare(b.endedAt),
  )[0];
}

/** A name the player gave the replay, i.e. any saved file not named by the game or W3Champions. */
export function userLabelOf(files: SourceFile[]): string | null {
  const labelled = files
    .map((f) => basename(f.path).replace(/\.w3g$/i, ""))
    .filter((n) => n.toLowerCase() !== "lastreplay" && !/^w3c-\d{14}/.test(n) && !/^Replay_\d{4}/.test(n));
  return labelled[0] ?? null;
}

function buildEvents(p: RawReplay["output"]["players"][number]): BuildEvent[] {
  const kinds = [
    ["building", dropRepeatedBuildOrders(p.buildings!.order)],
    ["unit", p.units!.order],
    ["upgrade", p.upgrades!.order],
    ["item", p.items!.order],
  ] as const;
  return kinds
    .flatMap(([kind, orders]) => orders.map((o) => ({ ms: o.ms, kind, code: o.id, name: nameOf(o.id) })))
    .sort((a, b) => a.ms - b.ms || a.kind.localeCompare(b.kind));
}

export function buildRecord(input: {
  raw: RawReplay;
  myAccounts: string[];
  canonicalFile: SourceFile;
  files: SourceFile[];
  archivePath: string;
  ingestedAt: string;
}): GameRecord {
  const { raw, files } = input;
  const out = raw.output;
  const classification = classify(raw, input.myAccounts);
  const result = detectResult(raw, classification);
  const timeFile = bestTimeFile(files);
  const durationMs = out.duration;
  const playedAt = new Date(Date.parse(timeFile.endedAt) - durationMs).toISOString();
  const meTeam = classification.seats.find((s) => s.playerId === classification.meId)?.teamId;

  const players: PlayerRecord[] = classification.seats
    .filter((s) => !s.isObserver && !s.isComputer)
    .map((seat): PlayerRecord => {
      const p = out.players.find((x) => x.id === seat.playerId)!;
      return {
        playerId: seat.playerId,
        name: seat.name,
        teamId: seat.teamId,
        racePicked: p.race!,
        race: p.raceDetected || p.race!,
        isMe: seat.playerId === classification.meId,
        result:
          result.winnerTeamId === null ? "unknown" : seat.teamId === result.winnerTeamId ? "win" : "loss",
        apmPerMinute: p.actions!.timed,
        heroes: (p.heroes ?? [])
          .map((h) => ({
            code: h.id,
            name: nameOf(h.id, "heroes"),
            level: h.level,
            levelUps: levelUpTimes(h.abilityOrder as { type: "ability" | "retraining"; time: number; value?: string }[]),
            skills: h.abilityOrder
              .filter((x) => x.type === "ability")
              .map((x) => ({ ms: x.time, code: (x as { value: string }).value, name: abilityName((x as { value: string }).value) })),
            retrainings: h.retrainingHistory.length,
          }))
          .sort((a, b) => (a.skills[0]?.ms ?? Infinity) - (b.skills[0]?.ms ?? Infinity))
          .map((h, i) => ({ order: i + 1, ...h })),
        build: buildEvents(p),
        actions: Object.fromEntries(Object.entries(p.actions!).filter(([k]) => k !== "timed")) as Record<string, number>,
        controlGroups: p.groupHotkeys as Record<string, { assigned: number; used: number }>,
        // Simulation metrics stay null until mergeSim() fills them in.
        metrics: { ...computeMetrics(raw, seat.playerId), ...Object.fromEntries(SIM_METRICS.map((m) => [m.key, null])) },
      };
    })
    // Me first, then by team, so "players[1]" is the opponent in a 1v1.
    .sort((a, b) => Number(b.isMe) - Number(a.isMe) || Number(a.teamId === meTeam) - Number(b.teamId === meTeam) || a.playerId - b.playerId);

  // Hero XP share needs both sides of the game.
  for (const p of players) {
    const mine = p.metrics.hero_xp_total;
    const theirs = players.filter((x) => x.teamId !== p.teamId).reduce((sum, x) => sum + (x.metrics.hero_xp_total ?? 0), 0);
    p.metrics.hero_xp_share = typeof mine === "number" && mine + theirs > 0 ? mine / (mine + theirs) : null;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    gameKey: out.id,
    userLabel: userLabelOf(files),
    game: {
      playedAt,
      endedAt: timeFile.endedAt,
      timeSource: timeFile.timeSource,
      durationMs,
      gameName: raw.meta.gameName,
      gameTypeRaw: raw.meta.gameType,
      version: out.version,
      build: out.buildNumber,
      map: { file: out.map.file, path: out.map.path, checksum: out.map.checksum, checksumSha1: out.map.checksumSha1 },
      settings: out.settings,
    },
    classification,
    result,
    players,
    chat: out.chat.map((m) => ({ ms: m.timeMS, player: m.playerName, mode: m.mode, message: m.message })),
    provenance: {
      gameKeyMethod: "w3gjs id: sha256(randomSeed + non-observer player names by id + gameName)",
      canonicalFile: input.canonicalFile,
      files,
      archivePath: input.archivePath,
      parser: raw.parser,
      namesSource: NAMES_SOURCE,
      classifierVersion: classification.version,
      metricsVersion: METRICS_VERSION,
      ingestedAt: input.ingestedAt,
    },
  };
}

/** Attach a simulation result to a record and copy its metrics into the players. */
export function mergeSim(record: GameRecord, sim: SimSummary | undefined): GameRecord {
  if (!sim) return record;
  record.sim = sim;
  if (sim.status === "ok") {
    for (const sp of sim.players) {
      const p = record.players.find((x) => x.playerId === sp.playerId);
      if (p) p.metrics = { ...p.metrics, ...sp.metrics };
    }
  }
  return record;
}
