import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { archiveEntryFor, isInside, keptOfficial, type ArchiveEntry, type ArchivedFrom } from "./analysis.ts";
import { gzipSync } from "node:zlib";
import type { Config } from "./config.ts";
import { mapName, writeGame, type DB } from "./db.ts";
import { SIM_METRIC_KEYS } from "./metrics.ts";
import { parseReplay, type RawReplay } from "./parse.ts";
import { mergeOfficial, type OfficialStats } from "./official.ts";
import { bestTimeFile, buildRecord, endTimeOf, mergeSim, type GameRecord, type SourceFile, type TimeSource } from "./record.ts";
import type { SimSummary } from "./sim.ts";
import { type Paths, logEvent, rawPath, readRaw, readRecord, recordPath } from "./store.ts";

export type IngestContext = { db: DB; config: Config; paths: Paths };

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

function save(ctx: IngestContext, record: GameRecord, raw: RawReplay, archiveSha: string) {
  const { paths } = ctx;
  mkdirSync(paths.games, { recursive: true });
  mkdirSync(paths.raw, { recursive: true });
  writeFileSync(rawPath(paths, record.gameKey), gzipSync(JSON.stringify(raw)));
  writeFileSync(recordPath(paths, record.gameKey), JSON.stringify(record, null, 1) + "\n");
  writeGame(ctx.db, record, archiveSha);
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

  const key = raw.output.id;
  const existing = readRecord(paths, key);
  // This content's game as archived before a start-over: the copy and the files it came from.
  const entry = archiveEntryFor(paths, sha);
  const kept = entry?.gameKey === key ? entry : undefined;
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
  mergeOfficial(record, existing?.official ?? keptOfficial(paths, key));

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

/**
 * Rebuild every record and DB row from the archived originals, using the current parser,
 * classifier and metrics. Manual annotations are untouched.
 */
export async function reingestAll(ctx: IngestContext): Promise<{ games: number; errors: string[] }> {
  const { paths } = ctx;
  const errors: string[] = [];
  let games = 0;
  if (!existsSync(paths.games)) return { games, errors };
  for (const f of readdirSync(paths.games).filter((x) => x.endsWith(".json")).sort()) {
    const old = JSON.parse(readFileSync(join(paths.games, f), "utf8")) as GameRecord;
    try {
      const buffer = readFileSync(old.provenance.archivePath);
      const raw = await parseReplay(buffer);
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
  save(ctx, record, readRaw(ctx.paths, gameKey), record.provenance.canonicalFile.sha256);
  logEvent(ctx.paths, { type: "official", gameKey, status: official.status });
  return record;
}
