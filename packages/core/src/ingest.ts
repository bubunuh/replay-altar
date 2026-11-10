import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { archiveEntryFor, isInside, keptOfficial, type ArchiveEntry, type ArchivedFrom } from "./analysis.ts";
import { gzipSync } from "node:zlib";
import type { Config } from "./config.ts";
import { mapName, transaction, writeGame, type DB } from "./db.ts";
import { gameKeyOf, matchGameName } from "./gamekey.ts";
import { SIM_METRIC_KEYS } from "./metrics.ts";
import { parseReplay, type RawReplay } from "./parse.ts";
import { mergeOfficial, settleW3cResult, takesW3cResult, type OfficialStats, type W3cResults } from "./official.ts";
import { bestTimeFile, buildRecord, endTimeOf, mergeSim, type GameRecord, type SourceFile, type TimeSource } from "./record.ts";
import type { SimSummary } from "./sim.ts";
import { type Paths, logEvent, rawPath, readRaw, readRecord, recordPath } from "./store.ts";

/** w3cResults: set for your own games only (official.ts). */
export type IngestContext = { db: DB; config: Config; paths: Paths; w3cResults?: W3cResults };

export type IngestOutcome =
  /** needsSim: the game has no simulation for its current canonical file yet. */
  | { status: "new" | "updated"; path: string; record: GameRecord; needsSim: boolean }
  | { status: "duplicate"; path: string; gameKey: string }
  | { status: "error"; path: string; error: string };

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
const safe = (s: string) => s.replace(/[\\/:*?"<>|#\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

function localStamp(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return { dir: `${d.getFullYear()}/${p(d.getMonth() + 1)}`, stamp: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}` };
}

/** archive/YYYY/MM/2026-10-16_2235_bnet_ladder_HvH_EchoIsles_Vardaine-2461_dc564e3a.w3g */
function archivePathFor(paths: Paths, r: GameRecord): string {
  const { dir, stamp } = localStamp(r.game.playedAt);
  const me = r.players.find((p) => p.isMe);
  const opp = r.players.find((p) => p.playerId === r.classification.opponentId);
  const what = me && opp ? `${me.race}v${opp.race}` : r.classification.category;
  const parts = [stamp, r.classification.source, what, mapName(r.game.map.file), opp?.name ?? "", r.gameKey.slice(0, 8)];
  return join(paths.archive, dir, parts.filter(Boolean).map(safe).join("_") + ".w3g");
}

/** `target`, or the same name with _2, _3… when another file is there; a file with the same content there is reused. */
function freePath(target: string, sha: string): string {
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? target : target.replace(/(\.w3g)?$/i, `_${i}$1`);
    if (!existsSync(candidate)) return candidate;
    try {
      if (sha256(readFileSync(candidate)) === sha) return candidate;
    } catch {
      // unreadable: take another name
    }
  }
}

/**
 * When a game whose archived copy has no index entry ended: an archive name starts with the local
 * time the game started (2026-10-16_2235_…), an unparsed copy's with its original name.
 */
export function archiveTime(path: string, mtimeMs: number, durationMs: number): { endedAt: string; timeSource: TimeSource } {
  const name = basename(path);
  const original = /^[0-9a-f]{12}_(.+)$/.exec(name)?.[1];
  if (original) {
    const t = endTimeOf(original, mtimeMs);
    return t.timeSource === "w3c_filename" ? t : { ...t, timeSource: "saved_file_mtime" };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})_/.exec(name);
  if (m) {
    const started = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    return { endedAt: new Date(started + durationMs).toISOString(), timeSource: "saved_file_mtime" };
  }
  return { endedAt: new Date(mtimeMs).toISOString(), timeSource: "saved_file_mtime" };
}

/** A file a game came from, as the archive index keeps it, back as a record's source file. */
export const sourceFileOf = (f: ArchivedFrom, durationMs: number): SourceFile => ({
  path: f.path,
  sha256: f.sha256,
  size: f.size,
  mtime: f.mtime,
  durationMs: f.durationMs ?? durationMs,
  ...endTimeOf(f.path, Date.parse(f.mtime)),
});

/** When the game of an archive index entry ended, judged from the files it came from (ms). */
export const archivedEndTime = (entry: ArchiveEntry): number | null =>
  entry.files.length ? Date.parse(bestTimeFile(entry.files.map((f) => sourceFileOf(f, 0))).endedAt) : null;

function writeFiles(paths: Paths, record: GameRecord, raw: RawReplay) {
  mkdirSync(paths.games, { recursive: true });
  mkdirSync(paths.raw, { recursive: true });
  writeFileSync(rawPath(paths, record.gameKey), gzipSync(JSON.stringify(raw)));
  writeFileSync(recordPath(paths, record.gameKey), JSON.stringify(record, null, 1) + "\n");
}

function save(ctx: IngestContext, record: GameRecord, raw: RawReplay, archiveSha: string) {
  settleW3cResult(record, ctx.w3cResults);
  writeFiles(ctx.paths, record, raw);
  writeGame(ctx.db, record, archiveSha);
}

/** A changed record whose replay didn't change: its JSON and DB rows. */
function saveRecord(ctx: IngestContext, record: GameRecord) {
  settleW3cResult(record, ctx.w3cResults);
  mkdirSync(ctx.paths.games, { recursive: true });
  writeFileSync(recordPath(ctx.paths, record.gameKey), JSON.stringify(record, null, 1) + "\n");
  writeGame(ctx.db, record, record.provenance.canonicalFile.sha256);
}


/**
 * Archive and analyze one replay file. Safe to call repeatedly on the same file:
 * a file already seen is a no-op, and another copy of a known game is recorded as an alias.
 *
 * A replay in the archive itself (imported again after a start-over, analysis.ts) is not copied
 * again, nor recorded as an alias of a game imported from the same content elsewhere. A replay
 * the archive index knows (the copy, or a file it was copied from) gets back the files the game
 * first came from, so it keeps its date (a LastReplay.w3g overwritten since dated the game better
 * than a copy saved later), and reuses the archived copy.
 */
export async function ingestFile(ctx: IngestContext, path: string): Promise<IngestOutcome> {
  const { db, config, paths } = ctx;
  let buffer: Buffer;
  try {
    buffer = readFileSync(path);
  } catch (e) {
    return { status: "error", path, error: `read failed: ${(e as Error).message}` };
  }
  const sha = sha256(buffer);
  const known = db.prepare("SELECT game_key FROM files WHERE path = ? AND sha256 = ?").get(path, sha) as { game_key: string } | undefined;
  if (known) return { status: "duplicate", path, gameKey: known.game_key };
  const fromArchive = isInside(path, paths.archive);
  if (fromArchive) {
    const same = db.prepare("SELECT game_key FROM games WHERE sha256 = ? UNION ALL SELECT game_key FROM files WHERE sha256 = ? LIMIT 1").get(sha, sha) as { game_key: string } | undefined;
    if (same) return { status: "duplicate", path, gameKey: same.game_key };
  }

  const stat = statSync(path);
  let raw: RawReplay;
  try {
    raw = await parseReplay(buffer);
  } catch (e) {
    // Keep the bytes anyway: LastReplay.w3g is overwritten by the next game.
    const keep = fromArchive ? path : join(paths.archive, "unparsed", `${sha.slice(0, 12)}_${basename(path)}`);
    if (!fromArchive) {
      mkdirSync(dirname(keep), { recursive: true });
      if (!existsSync(keep)) copyFileSync(path, keep);
    }
    const error = `parse failed: ${(e as Error).message}`;
    logEvent(paths, { type: "error", path, error, keptAs: keep });
    return { status: "error", path, error };
  }

  const key = gameKeyOf(raw);
  const existing = readRecord(paths, key);
  // This content's game as archived before a start-over: the copy and the files it came from.
  // Archived before 0.2.5, a W3Champions game may be there under its key of then (w3gjs's id).
  const entry = archiveEntryFor(paths, sha);
  const kept = entry && (entry.gameKey === key || entry.gameKey === raw.output.id) ? entry : undefined;
  const here: SourceFile = {
    path,
    sha256: sha,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    durationMs: raw.output.duration,
    ...(fromArchive ? archiveTime(path, stat.mtimeMs, raw.output.duration) : endTimeOf(path, stat.mtimeMs)),
  };
  const origins = kept ? kept.files.map((f) => sourceFileOf(f, raw.output.duration)) : [];
  // Imported from the archived copy: the file it was copied from stands for it.
  const file = (fromArchive && origins.find((f) => f.sha256 === sha)) || here;
  const files: SourceFile[] = [];
  for (const f of [...(existing?.provenance.files ?? []), ...origins, file]) {
    const i = files.findIndex((g) => g.path === f.path && g.sha256 === f.sha256);
    if (i >= 0) files.splice(i, 1);
    files.push(f);
  }

  // The longest copy is the canonical one; a shorter one only adds an alias.
  const replacesCanonical = !existing || file.durationMs > existing.provenance.canonicalFile.durationMs;
  const canonical = replacesCanonical ? file : existing.provenance.canonicalFile;
  const canonicalRaw = replacesCanonical ? raw : readRaw(paths, key);
  const record = buildRecord({
    raw: canonicalRaw,
    myAccounts: config.accounts,
    canonicalFile: canonical,
    files,
    archivePath: existing?.provenance.archivePath ?? "",
    ingestedAt: existing?.provenance.ingestedAt ?? new Date().toISOString(),
  });

  // A simulation belongs to the canonical file; keep it unless that file changed. Official stats
  // belong to the game, so they always carry over.
  if (!replacesCanonical) mergeSim(record, existing?.sim);
  // Kept through a start-over: not asked for again.
  mergeOfficial(record, existing?.official ?? keptOfficial(paths, key) ?? keptOfficial(paths, raw.output.id));

  if (replacesCanonical) {
    if (existing && existsSync(existing.provenance.archivePath)) {
      mkdirSync(paths.superseded, { recursive: true });
      renameSync(existing.provenance.archivePath, freePath(join(paths.superseded, basename(existing.provenance.archivePath)), existing.provenance.canonicalFile.sha256));
    }
    record.provenance.archivePath = archiveFor(paths, record, path, buffer, sha, fromArchive, kept);
  }
  save(ctx, record, canonicalRaw, canonical.sha256);
  logEvent(paths, { type: "ingested", status: existing ? "updated" : "new", gameKey: key, path, analyzed: record.classification.analyzed });
  return { status: existing ? "updated" : "new", path, record, needsSim: record.classification.analyzed && !record.sim };
}

/**
 * Where a game's canonical replay is archived: the archived copy itself when that is what was
 * imported (an unparsed one moves to a proper name), the copy made before a start-over when it is
 * still there, else a new copy (never over another replay).
 */
function archiveFor(paths: Paths, record: GameRecord, path: string, buffer: Buffer, sha: string, fromArchive: boolean, kept: ArchiveEntry | undefined): string {
  const loose = isInside(path, join(paths.archive, "unparsed")) || isInside(path, paths.superseded);
  if (fromArchive && !loose) return path;
  const before = kept?.sha256 === sha && join(paths.archive, ...kept.archive.split("/"));
  if (before && existsSync(before)) return before;
  const target = freePath(archivePathFor(paths, record), sha);
  mkdirSync(dirname(target), { recursive: true });
  if (fromArchive) {
    if (target !== path) renameSync(path, target);
  } else if (!existsSync(target)) writeFileSync(target, buffer);
  return target;
}

/** The tables that name a game by its key, other than games (its own rows go with it). */
const keyedTables = (db: DB) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'games'").all() as { name: string }[])
    .map((t) => t.name)
    .filter((t) => (db.prepare(`SELECT name FROM pragma_table_info(?)`).all(t) as { name: string }[]).some((c) => c.name === "game_key"));

/**
 * A game stored under a key it no longer has (gamekey.ts: before 0.2.5, a W3Champions game's two
 * copies were two games), moved to its key: `raw` is its canonical file read. When another copy of
 * the game is there already, the two become one game as in ingestFile: every file of both, the
 * longer copy canonical (on a tie, the game already there), with that copy's simulation, and the
 * W3Champions statistics found for either. What hangs on the old key follows (results corrected by
 * hand); the other copy's archived replay moves to the superseded folder. Safe to run again after
 * an interruption: the old game is only gone once the new one is written.
 */
function moveGame(ctx: IngestContext, from: string, raw: RawReplay): { key: string; merged: boolean } {
  const { db, config, paths } = ctx;
  const old = readRecord(paths, from);
  if (!old) throw new Error(`no record for ${from}`);
  const key = gameKeyOf(raw);
  const there = readRecord(paths, key);
  const oldWins = !there || old.provenance.canonicalFile.durationMs > there.provenance.canonicalFile.durationMs;
  const [win, lose] = oldWins ? [old, there] : [there, old];
  const files: SourceFile[] = [];
  for (const f of [...(there?.provenance.files ?? []), ...old.provenance.files]) {
    if (!files.some((g) => g.path === f.path && g.sha256 === f.sha256)) files.push(f);
  }
  const winRaw = oldWins ? raw : readRaw(paths, key);
  const record = buildRecord({
    raw: winRaw,
    myAccounts: config.accounts,
    canonicalFile: win.provenance.canonicalFile,
    files,
    archivePath: win.provenance.archivePath,
    ingestedAt: [old.provenance.ingestedAt, there?.provenance.ingestedAt].filter((t): t is string => !!t).sort()[0],
  });
  // The simulation belongs to the canonical file; its output goes by the key.
  let sim = win.sim;
  if (sim?.status === "ok" && win === old) {
    const to = join(dirname(sim.outputPath), `${key}.wc3v.gz`);
    if (existsSync(sim.outputPath)) renameSync(sim.outputPath, to);
    if (existsSync(to)) sim = { ...sim, outputPath: to }; // moved now, or by a run cut short
  }
  mergeSim(record, sim);
  const officials = [win.official, lose?.official, keptOfficial(paths, key), keptOfficial(paths, from)].filter((o): o is OfficialStats => !!o);
  mergeOfficial(record, officials.find((o) => o.status === "ok") ?? officials[0]);
  settleW3cResult(record, ctx.w3cResults);

  writeFiles(paths, record, winRaw);
  transaction(db, () => {
    db.prepare("DELETE FROM games WHERE game_key = ?").run(from);
    for (const t of keyedTables(db)) {
      db.prepare(`UPDATE OR IGNORE "${t}" SET game_key = ? WHERE game_key = ?`).run(key, from);
      db.prepare(`DELETE FROM "${t}" WHERE game_key = ?`).run(from);
    }
    writeGame(db, record, record.provenance.canonicalFile.sha256);
  });
  rmSync(recordPath(paths, from), { force: true });
  rmSync(rawPath(paths, from), { force: true });
  if (lose) {
    const lost = lose.provenance.archivePath;
    if (lost && lost !== record.provenance.archivePath && existsSync(lost) && isInside(lost, paths.archive) && !isInside(lost, paths.superseded)) {
      mkdirSync(paths.superseded, { recursive: true });
      renameSync(lost, freePath(join(paths.superseded, basename(lost)), lose.provenance.canonicalFile.sha256));
    }
    const output = (r: GameRecord) => (r.sim?.status === "ok" ? r.sim.outputPath : null);
    const lostOutput = output(lose);
    if (lostOutput && lostOutput !== output(record)) rmSync(lostOutput, { force: true });
  }
  return { key, merged: !!there };
}

/**
 * The games stored under a key they no longer have, moved to it (moveGame): from before 0.2.5, a
 * W3Champions game named with a player's suffix. Only those are read.
 */
export function rekeyGames(ctx: IngestContext): { moved: number; merged: number; errors: string[] } {
  const { db, paths } = ctx;
  const out = { moved: 0, merged: 0, errors: [] as string[] };
  const rows = db.prepare("SELECT game_key, game_name FROM games WHERE game_name LIKE 'w3c-%'").all() as { game_key: string; game_name: string }[];
  for (const { game_key, game_name } of rows) {
    if (matchGameName(game_name) === game_name) continue;
    try {
      const raw = readRaw(paths, game_key);
      if (gameKeyOf(raw) === game_key) continue;
      const { merged } = moveGame(ctx, game_key, raw);
      out.moved++;
      if (merged) out.merged++;
    } catch (e) {
      out.errors.push(`${game_key}: ${(e as Error).message}`);
    }
  }
  // The window keeps each game's findings until an event says the games changed.
  if (out.moved) logEvent(paths, { type: "reingested", games: out.moved });
  return out;
}

/**
 * Rebuild every record and DB row from the archived originals, using the current parser,
 * classifier and metrics. Manual annotations are untouched. A game whose key changed moves to it
 * (moveGame).
 */
export async function reingestAll(ctx: IngestContext): Promise<{ games: number; errors: string[] }> {
  const { paths } = ctx;
  const errors: string[] = [];
  let games = 0;
  if (!existsSync(paths.games)) return { games, errors };
  for (const f of readdirSync(paths.games).filter((x) => x.endsWith(".json")).sort()) {
    const file = join(paths.games, f);
    if (!existsSync(file)) continue; // moved to its key meanwhile
    const old = JSON.parse(readFileSync(file, "utf8")) as GameRecord;
    try {
      const buffer = readFileSync(old.provenance.archivePath);
      const raw = await parseReplay(buffer);
      if (gameKeyOf(raw) !== old.gameKey) {
        moveGame(ctx, old.gameKey, raw);
        games++;
        continue;
      }
      const record = buildRecord({
        raw,
        myAccounts: ctx.config.accounts,
        canonicalFile: old.provenance.canonicalFile,
        files: old.provenance.files,
        archivePath: old.provenance.archivePath,
        ingestedAt: old.provenance.ingestedAt,
      });
      mergeSim(record, old.sim);
      mergeOfficial(record, old.official);
      save(ctx, record, raw, sha256(buffer));
      games++;
    } catch (e) {
      errors.push(`${f}: ${(e as Error).message}`);
    }
  }
  // The window keeps each game's findings until an event says the games changed.
  logEvent(paths, { type: "reingested", games });
  return { games, errors };
}

/** Store a finished simulation with its game (record JSON + DB rows). */
export function applySim(ctx: IngestContext, gameKey: string, sim: SimSummary): GameRecord | null {
  const record = readRecord(ctx.paths, gameKey);
  if (!record) return null;
  delete record.sim;
  for (const p of record.players) {
    for (const k of Object.keys(p.metrics)) if (SIM_METRIC_KEYS.has(k)) p.metrics[k] = null;
  }
  mergeSim(record, sim);
  mergeOfficial(record, record.official); // official numbers win over fresh estimates
  const raw = readRaw(ctx.paths, gameKey);
  save(ctx, record, raw, record.provenance.canonicalFile.sha256);
  logEvent(ctx.paths, { type: "simulated", gameKey, status: sim.status, reason: sim.status === "failed" ? sim.reason : undefined });
  return record;
}

/** Store official end-of-game stats with a game (or a "missing" note for retries). */
export function applyOfficial(ctx: IngestContext, gameKey: string, official: OfficialStats): GameRecord | null {
  const record = readRecord(ctx.paths, gameKey);
  if (!record) return null;
  mergeOfficial(record, official);
  saveRecord(ctx, record);
  logEvent(ctx.paths, { type: "official", gameKey, status: official.status });
  return record;
}

/**
 * Your W3Champions games' results as W3Champions gives them now (official.ts), at each start: the
 * ones still from the replay (up to 0.2.4, once) and, when the lookups were turned on or off since
 * the last start (`modeChanged`), the ones without a winner. Only the games whose result changes
 * are written. Returns how many.
 */
export function settleW3cResults(ctx: IngestContext, modeChanged: boolean): number {
  const rows = ctx.db
    .prepare(
      `SELECT game_key, result_detected, result_method FROM games
       WHERE source = 'w3champions' AND analyzed = 1 AND category = '1v1_human' AND opp_name IS NOT NULL
         AND (result_method <> 'w3champions' OR (? AND result_detected IN ('reviewing', 'unknown')))`,
    )
    .all(modeChanged ? 1 : 0) as { game_key: string; result_detected: string; result_method: string }[];
  let changed = 0;
  for (const row of rows) {
    const record = readRecord(ctx.paths, row.game_key);
    if (!record || !takesW3cResult(record)) continue;
    settleW3cResult(record, ctx.w3cResults);
    if (record.result.me === row.result_detected && record.result.method === row.result_method) continue;
    saveRecord(ctx, record);
    changed++;
  }
  // The window keeps each game's findings until an event says the games changed.
  if (changed) logEvent(ctx.paths, { type: "reingested", games: changed });
  return changed;
}
