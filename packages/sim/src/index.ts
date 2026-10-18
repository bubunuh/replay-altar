// The simulation layer: run WC3V on an archived replay and turn its output into economy data.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { RACES, type GameRecord, type RaceCode, type SimFight, type SimSummary } from "@replay-altar/core";
import { loadCosts, type CostTables } from "./costs.ts";
import { buildTimelines, economyMetrics, ESTIMATE_HORIZON_MS, runIncome, type EconomyConstants, type WOutput } from "./economy.ts";
import constantsJson from "./economy-constants.json" with { type: "json" };
import { ensureMapData } from "./maps.ts";
import { armyAt, heroTimelines, unitsKilledEstimate } from "./army.ts";
import { DRIVER, gamedataDir, simNotReady, simOutputPath, wc3vCommit } from "./paths.ts";

export { buildTimelines, runIncome, economyMetrics, loadCosts, simNotReady, simOutputPath, gamedataDir, ESTIMATE_HORIZON_MS };
export type { EconomyConstants, WOutput, CostTables };
export type { Timeline } from "./economy.ts";
export { mapDataName, ensureMapData } from "./maps.ts";
export { armyAt, heroTimelines, unitsKilledEstimate } from "./army.ts";

export const CONSTANTS = constantsJson as unknown as EconomyConstants;
const RUN_TIMEOUT_MS = 180_000;

type DriverResult = { ok: boolean; ms: number; error?: string };

function runDriver(replay: string, out: string): Promise<DriverResult> {
  return new Promise((resolve) => {
    // nice: the game may be running; the simulation can wait.
    execFile("nice", ["-n", "19", process.execPath, DRIVER, replay, out], { timeout: RUN_TIMEOUT_MS, maxBuffer: 16 << 20 }, (err, stdout) => {
      const line = stdout.trim().split("\n").at(-1) ?? "";
      try {
        resolve(JSON.parse(line) as DriverResult);
      } catch {
        resolve({ ok: false, ms: 0, error: err ? `${err.message}`.slice(0, 500) : `unexpected driver output: ${line.slice(0, 200)}` });
      }
    });
  });
}

export function readSimOutput(path: string): WOutput {
  return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
}

/** Economy summary from an existing WC3V output (fast; used after a run and on reingest). */
export function summarize(record: GameRecord, o: WOutput, costs: CostTables, k: EconomyConstants, meta: { ranAt: string; runMs: number; outputPath: string }): SimSummary {
  const timelines = buildTimelines(o, record, costs);
  const incomes = timelines.map((tl) => runIncome(tl, k));
  const warnings: string[] = [];
  const players = timelines.map((tl, i) => {
    const oppIndex = timelines.findIndex((x) => x.teamId !== tl.teamId);
    const metrics = economyMetrics(tl, incomes[i], oppIndex >= 0 ? { tl: timelines[oppIndex], income: incomes[oppIndex] } : null, o, costs);
    const early = incomes[i].series.filter((s) => s.t <= ESTIMATE_HORIZON_MS);
    const worst = early.reduce((m, s) => (s.estGoldBank < m.estGoldBank ? s : m), early[0]);
    if (worst && worst.estGoldBank < -200) {
      warnings.push(`player ${tl.playerId}: spent ${-worst.estGoldBank} more gold than the income model estimates by ${Math.floor(worst.t / 60000)}:${String(Math.floor((worst.t % 60000) / 1000)).padStart(2, "0")}`);
    }
    const pw = (o.validation?.warnings ?? []).filter((w) => String(w.player) === String(tl.playerId)).map((w) => `${w.type ?? "warning"}: ${w.message ?? ""}`.trim());
    const rp = record.players.find((p) => p.playerId === tl.playerId)!;
    const series = incomes[i].series.map((s) => ({ ...s, ...armyAt(s.t, s.foodUsed, s.workers, rp, costs) }));
    metrics.units_killed = unitsKilledEstimate(o, tl.playerId, tl.teamId, k.unitsKilledFactor ?? 1.49, costs);
    // The game counts its "largest army" in food, heroes included.
    metrics.largest_army = Math.max(0, ...series.map((s) => s.foodUsed - s.workers));
    const heroes = heroTimelines(o, tl.playerId, rp, costs, record.game.durationMs);
    // Grubby's "3360": first hero level 3, second hero level 3, 60 food.
    const byOrder = [...rp.heroes].sort((a, b) => a.order - b.order);
    const l3 = (i: number) => byOrder[i]?.levelUps[2] ?? null;
    const food60 = series.find((s) => s.foodUsed >= 60)?.t ?? null;
    metrics.goal_3360_ms = l3(0) !== null && l3(1) !== null && food60 !== null ? Math.max(l3(0)!, l3(1)!, food60) : null;
    metrics.workers_lost_12m = workersLost(o, tl.playerId, rp.race, 720_000);
    return { playerId: tl.playerId, parseConfidence: tl.parseConfidence, validationWarnings: pw, series, metrics, heroes };
  });
  return {
    status: "ok",
    engine: { name: "wc3v", commit: wc3vCommit() },
    gameData: { version: costs.version, manifestSha256: costs.manifestSha256 },
    model: { version: k.version, constants: k as unknown as Record<string, unknown> },
    ...meta,
    players,
    fights: fightsOf(o),
    warnings,
  };
}

/** Workers of this race the simulation saw die (lost or possibly lost) by a time. */
function workersLost(o: WOutput, playerId: number, race: string, byMs: number): number {
  const worker = RACES[race as RaceCode]?.worker;
  const units = ((o.players[String(playerId)] as unknown as { units?: { itemId: string; lostState?: { state: string; since: number } | null }[] })?.units ?? []);
  return units.filter((u) => u.itemId === worker && (u.lostState?.state === "lost" || u.lostState?.state === "possiblyLost") && u.lostState.since <= byMs).length;
}

type WBattle = {
  startTime: number;
  endTime: number;
  category: string;
  startingPlayerId?: number | null;
  participants?: { playerId: number }[];
  flags?: { involvesHero?: boolean; involvesAir?: boolean };
};

function fightsOf(o: WOutput): SimFight[] {
  const battles = ((o as unknown as { battles?: WBattle[] }).battles ?? []).filter((b) => Number.isFinite(b.startTime));
  return battles.map((b) => ({
    start: b.startTime,
    end: b.endTime,
    category: b.category,
    initiatorId: b.startingPlayerId ?? null,
    playerIds: [...new Set((b.participants ?? []).map((p) => p.playerId))],
    involvesHero: !!b.flags?.involvesHero,
    involvesAir: !!b.flags?.involvesAir,
  }));
}

/**
 * Simulate one archived game. Never throws: failures come back as status "failed".
 * dataRoot is where the output goes; gamedataRoot (default dataRoot) holds sim/gamedata/current,
 * so reference corpora can share the user's extracted game data.
 */
export async function simulateGame(
  record: GameRecord,
  opts: { dataRoot: string; warcraftDocuments: string[]; gamedataRoot?: string; extraMapDirs?: string[] },
): Promise<SimSummary> {
  const ranAt = new Date().toISOString();
  const engine = { name: "wc3v" as const, commit: wc3vCommit() };
  const gamedataRoot = opts.gamedataRoot ?? opts.dataRoot;
  const notReady = simNotReady(gamedataRoot);
  if (notReady) return { status: "failed", engine, ranAt, reason: notReady };
  const mapProblem = ensureMapData(record.game.map.file, opts.warcraftDocuments, opts.extraMapDirs);
  if (mapProblem) return { status: "failed", engine, ranAt, reason: mapProblem };
  const out = simOutputPath(opts.dataRoot, record.gameKey);
  const res = await runDriver(record.provenance.archivePath, out);
  if (!res.ok || !existsSync(out)) return { status: "failed", engine, ranAt, reason: res.error ?? "simulation produced no output" };
  try {
    const costs = loadCosts(gamedataDir(gamedataRoot));
    return summarize(record, readSimOutput(out), costs, CONSTANTS, { ranAt, runMs: res.ms, outputPath: out });
  } catch (e) {
    return { status: "failed", engine, ranAt, reason: `summary failed: ${(e as Error).message}` };
  }
}
