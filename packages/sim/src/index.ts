// The simulation layer: run WC3V on an archived replay and turn its output into economy data.
import { execFile } from "node:child_process";
import { constants, setPriority } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { RACES, type GameRecord, type RaceCode, type SimFight, type SimPlayer, type SimSummary } from "@replay-altar/core";
import { loadCosts, type CostTables } from "./costs.ts";
import { buildTimelines, economyMetrics, ESTIMATE_HORIZON_MS, runIncome, type EconomyConstants, type WOutput } from "./economy.ts";
import constantsJson from "./economy-constants.json" with { type: "json" };
import { ensureMapData, refreshMapCache, type FromGame } from "./maps.ts";
import { armyAt, armyValueFn, heroTimelines, unitsKilledEstimate } from "./army.ts";
import { DRIVER, gamedataDir, simNotReady, simOutputPath, wc3vCommit } from "./paths.ts";

export { buildTimelines, runIncome, economyMetrics, loadCosts, simNotReady, simOutputPath, gamedataDir, ESTIMATE_HORIZON_MS };
export type { EconomyConstants, WOutput, CostTables };
export type { Timeline } from "./economy.ts";
export { mapDataName, ensureMapData, mapCacheDir, mapClientDir, syncMapCache, type FromGame } from "./maps.ts";
export { armyAt, heroTimelines, unitsKilledEstimate } from "./army.ts";

export const CONSTANTS = constantsJson as unknown as EconomyConstants;
const RUN_TIMEOUT_MS = 180_000;

type DriverResult = { ok: boolean; ms: number; error?: string };

function runDriver(replay: string, out: string): Promise<DriverResult> {
  return new Promise((resolve) => {
    // Lowest priority: the game may be running; the simulation can wait. Linux uses nice (it also
    // covers the threads node starts); Windows sets the priority class once the process exists.
    const [cmd, args] = process.platform === "win32" ? [process.execPath, [DRIVER, replay, out]] : ["nice", ["-n", "19", process.execPath, DRIVER, replay, out]];
    const child = execFile(cmd, args, { timeout: RUN_TIMEOUT_MS, maxBuffer: 16 << 20, windowsHide: true }, (err, stdout) => {
      const line = stdout.trim().split("\n").at(-1) ?? "";
      try {
        resolve(JSON.parse(line) as DriverResult);
      } catch {
        resolve({ ok: false, ms: 0, error: err ? `${err.message}`.slice(0, 500) : `unexpected driver output: ${line.slice(0, 200)}` });
      }
    });
    if (process.platform === "win32" && child.pid) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_LOW);
      } catch {
        // exited already
      }
    }
  });
}

export function readSimOutput(path: string): WOutput {
  return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
}

/** Economy summary from an existing WC3V output (fast; used after a run and on reingest). */
/** WC3V stops reading some replays part way (it reports PARSE_TRUNCATED); more than this missing makes the game unusable. */
const MAX_MISSING_MS = 30_000;

export function summarize(record: GameRecord, o: WOutput, costs: CostTables, k: EconomyConstants, meta: { ranAt: string; runMs: number; outputPath: string }): SimSummary {
  // A truncated read looks like a game where everyone stopped playing: no fights, no levels,
  // no spending after the cut. Better no simulation than one that misleads (7-10% of the pro
  // corpus on WC3V 2026-10).
  const cut = ((o.validation?.warnings ?? []) as { type?: string; missingMs?: number; lastActionGameTimeMs?: number }[]).find((w) => w.type === "PARSE_TRUNCATED" && (w.missingMs ?? 0) > MAX_MISSING_MS);
  if (cut) {
    const at = Math.round((cut.lastActionGameTimeMs ?? 0) / 1000);
    return { status: "failed", engine: { name: "wc3v", commit: wc3vCommit() }, ranAt: meta.ranAt, reason: `the simulation could read the replay only up to ${Math.floor(at / 60)}:${String(at % 60).padStart(2, "0")} (WC3V parse truncated)` };
  }
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
    const valueAt = armyValueFn(o, tl.playerId, costs);
    const series = incomes[i].series.map((s) => ({ ...s, ...armyAt(s.t, s.foodUsed, s.workers, rp, costs), armyValue: valueAt(s.t) }));
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
    return { playerId: tl.playerId, parseConfidence: tl.parseConfidence, validationWarnings: pw, series, metrics, heroes, bases: basesOf(o, tl.playerId, rp.race), camps: campsOf(o, tl.playerId, record) };
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

const EXPANSION_MIN_DISTANCE = 2500;
const SAME_SITE = 1200;
const HALLS: Record<string, string[]> = { H: ["htow", "hkee", "hcas"], O: ["ogre", "ostr", "ofrt"], U: ["unpl", "unp1", "unp2", "ugol"], N: ["etol", "etoa", "etoe"] };

/** Expansion halls standing in the simulation, one per site (see SimPlayer.bases). */
function basesOf(o: WOutput, playerId: number, race: string): { at: number; lostAt: number | null }[] {
  type U = { itemId: string; isIllusion?: boolean; spawnTime?: number | null; constructionStartTime?: number | null; spawnPosition?: { x: number; y: number } | null; lastPosition?: { x: number; y: number } | null; lostState?: { state: string; since: number } | null };
  const p = o.players[String(playerId)] as unknown as { units?: U[]; startingPosition?: { x: number; y: number } } | undefined;
  const start = p?.startingPosition;
  const codes = HALLS[race] ?? [];
  if (!p || !start) return [];
  const sites: { x: number; y: number; at: number; lostAt: number | null }[] = [];
  for (const u of (p.units ?? []).filter((x) => codes.includes(x.itemId) && !x.isIllusion)) {
    const pos = u.lastPosition ?? u.spawnPosition;
    const at = u.constructionStartTime ?? u.spawnTime;
    // The starting hall is no expansion, even when a Night Elf walks it elsewhere.
    if (!pos || at === null || at === undefined || at < 5_000 || Math.hypot(pos.x - start.x, pos.y - start.y) < EXPANSION_MIN_DISTANCE) continue;
    const lostAt = u.lostState?.state === "lost" ? u.lostState.since : null;
    const same = sites.find((s) => Math.hypot(s.x - pos.x, s.y - pos.y) < SAME_SITE);
    if (same) {
      same.at = Math.min(same.at, at);
      continue;
    }
    sites.push({ x: pos.x, y: pos.y, at, lostAt });
  }
  return sites.sort((a, b) => a.at - b.at).map(({ at, lostAt }) => ({ at, lostAt }));
}

/** A camp this much closer to one start than to the other is on that player's side (Vortix: your camps, theirs, contested). */
const SIDE_RATIO = 0.8;

/**
 * Creep camps WC3V credits this player with clearing, and whose side of the map they were on:
 * nearer the player's start than the opponent's, nearer the opponent's, or in between.
 */
function campsOf(o: WOutput, playerId: number, record: GameRecord): NonNullable<SimPlayer["camps"]> {
  type Group = { bounds?: { minX: number; minY: number; maxX: number; maxY: number }; totalLevel?: number; clearedTime?: number | null; playerCredit?: Record<string, { credited?: boolean }> };
  const startOf = (id: number) => (o.players[String(id)] as unknown as { startingPosition?: { x: number; y: number } } | undefined)?.startingPosition;
  const me = record.players.find((p) => p.playerId === playerId);
  const opp = record.players.find((p) => p.teamId !== me?.teamId);
  const [mine, theirs] = [startOf(playerId), opp ? startOf(opp.playerId) : undefined];
  if (!mine || !theirs) return [];
  const out: NonNullable<SimPlayer["camps"]> = [];
  for (const g of Object.values((o.world?.neutralGroups ?? {}) as unknown as Record<string, Group>)) {
    if (!g.bounds || typeof g.clearedTime !== "number" || !g.playerCredit?.[String(playerId)]?.credited) continue;
    const c = { x: (g.bounds.minX + g.bounds.maxX) / 2, y: (g.bounds.minY + g.bounds.maxY) / 2 };
    const ratio = Math.hypot(c.x - mine.x, c.y - mine.y) / Math.max(1, Math.hypot(c.x - theirs.x, c.y - theirs.y));
    out.push({ at: g.clearedTime, level: g.totalLevel ?? 0, side: ratio < SIDE_RATIO ? "own" : ratio > 1 / SIDE_RATIO ? "theirs" : "middle" });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Workers of this race the simulation saw die (lost or possibly lost) by a time. */
function workersLost(o: WOutput, playerId: number, race: string, byMs: number): number {
  const worker = RACES[race as RaceCode]?.worker;
  const units = ((o.players[String(playerId)] as unknown as { units?: { itemId: string; lostState?: { state: string; since: number } | null }[] })?.units ?? []);
  return units.filter((u) => u.itemId === worker && (u.lostState?.state === "lost" || u.lostState?.state === "possiblyLost") && u.lostState.since <= byMs).length;
}

type WLossGroup = { gold?: number; lumber?: number; units?: { itemId: string; count: number; isHero?: boolean }[] };
type WBattle = {
  startTime: number;
  endTime: number;
  category: string;
  startingPlayerId?: number | null;
  participants?: { playerId: number }[];
  flags?: { involvesHero?: boolean; involvesAir?: boolean };
  summary?: { perPlayer?: Record<string, { definite?: WLossGroup; estimated?: WLossGroup; heroDeaths?: { itemId: string }[] }> };
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
    // WC3V's own count of what each side lost in the battle (definite + estimated). Units it
    // only estimates as killed here may still be alive in its unit list.
    losses: Object.fromEntries(
      Object.entries(b.summary?.perPlayer ?? {}).map(([pid, x]) => [
        pid,
        {
          value: (x.definite?.gold ?? 0) + (x.definite?.lumber ?? 0) + (x.estimated?.gold ?? 0) + (x.estimated?.lumber ?? 0),
          heroes: (x.heroDeaths ?? []).map((h) => h.itemId),
        },
      ]),
    ),
  }));
}

/**
 * Simulate one archived game. Never throws: failures come back as status "failed".
 * dataRoot is where the output goes; gamedataRoot (default dataRoot) holds sim/gamedata/current
 * and the extracted maps (sim/maps), so reference corpora share the user's. mapFolders: where the
 * map files are (mapFolders in core's config).
 */
export async function simulateGame(record: GameRecord, opts: { dataRoot: string; mapFolders: string[]; gamedataRoot?: string; fromGame?: FromGame }): Promise<SimSummary> {
  const ranAt = new Date().toISOString();
  const engine = { name: "wc3v" as const, commit: wc3vCommit() };
  const gamedataRoot = opts.gamedataRoot ?? opts.dataRoot;
  const notReady = simNotReady(gamedataRoot);
  if (notReady) return { status: "failed", engine, ranAt, reason: notReady };
  const mapProblem = ensureMapData(record.game.map.file, opts.mapFolders, gamedataRoot, opts.fromGame);
  if (mapProblem) return { status: "failed", engine, ranAt, reason: mapProblem };
  const out = simOutputPath(opts.dataRoot, record.gameKey);
  const res = await runDriver(record.provenance.archivePath, out);
  if (!res.ok || !existsSync(out)) return { status: "failed", engine, ranAt, reason: res.error ?? "simulation produced no output" };
  try {
    refreshMapCache(gamedataRoot, record.game.map.file);
  } catch {
    // the cache is a convenience; the simulation itself worked
  }
  try {
    const costs = loadCosts(gamedataDir(gamedataRoot));
    const sim = summarize(record, readSimOutput(out), costs, CONSTANTS, { ranAt, runMs: res.ms, outputPath: out });
    // WC3V can run to the end and still follow nobody (seen on a classic Reign of Chaos .w3m map).
    if (sim.status === "ok" && sim.players.every((p) => !p.series.length)) return { status: "failed", engine, ranAt, reason: "the simulation followed no units on this map (WC3V may not support it)" };
    return sim;
  } catch (e) {
    return { status: "failed", engine, ranAt, reason: `summary failed: ${(e as Error).message}` };
  }
}
