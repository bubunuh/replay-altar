import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Config } from "./config.ts";
import { mapName, writeGame, type DB } from "./db.ts";
import { parseReplay, type RawReplay } from "./parse.ts";
import { buildRecord, endTimeOf, type GameRecord, type SourceFile } from "./record.ts";
import { rawPath, readRaw, readRecord, recordPath, type Paths } from "./store.ts";

export type IngestContext = { db: DB; config: Config; paths: Paths };

export type IngestOutcome =
  | { status: "new" | "updated"; path: string; record: GameRecord }
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

function save(ctx: IngestContext, record: GameRecord, raw: RawReplay, archiveSha: string) {
  const { paths } = ctx;
  mkdirSync(paths.games, { recursive: true });
  mkdirSync(paths.raw, { recursive: true });
  writeFileSync(rawPath(paths, record.gameKey), gzipSync(JSON.stringify(raw)));
  writeFileSync(recordPath(paths, record.gameKey), JSON.stringify(record, null, 1) + "\n");
  writeGame(ctx.db, record, archiveSha);
}

export function logEvent(paths: Paths, event: Record<string, unknown>) {
  mkdirSync(paths.root, { recursive: true });
  appendFileSync(paths.events, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
}

/**
 * Archive and analyze one replay file. Safe to call repeatedly on the same file:
 * a file already seen is a no-op, and another copy of a known game is recorded as an alias.
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

  const stat = statSync(path);
  let raw: RawReplay;
  try {
    raw = await parseReplay(buffer);
  } catch (e) {
    // Keep the bytes anyway: LastReplay.w3g is overwritten by the next game.
    const keep = join(paths.archive, "unparsed", `${sha.slice(0, 12)}_${basename(path)}`);
    mkdirSync(dirname(keep), { recursive: true });
    if (!existsSync(keep)) copyFileSync(path, keep);
    const error = `parse failed: ${(e as Error).message}`;
    logEvent(paths, { type: "error", path, error, keptAs: keep });
    return { status: "error", path, error };
  }

  const key = raw.output.id;
  const existing = readRecord(paths, key);
  const file: SourceFile = {
    path,
    sha256: sha,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    durationMs: raw.output.duration,
    ...endTimeOf(path, stat.mtimeMs),
  };
  const files = [...(existing?.provenance.files ?? []).filter((f) => !(f.path === path && f.sha256 === sha)), file];

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

  if (replacesCanonical) {
    if (existing && existsSync(existing.provenance.archivePath)) {
      mkdirSync(paths.superseded, { recursive: true });
      renameSync(existing.provenance.archivePath, join(paths.superseded, basename(existing.provenance.archivePath)));
    }
    record.provenance.archivePath = archivePathFor(paths, record);
    mkdirSync(dirname(record.provenance.archivePath), { recursive: true });
    writeFileSync(record.provenance.archivePath, buffer);
  }
  save(ctx, record, canonicalRaw, canonical.sha256);
  logEvent(paths, { type: "ingested", status: existing ? "updated" : "new", gameKey: key, path, analyzed: record.classification.analyzed });
  return { status: existing ? "updated" : "new", path, record };
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
      save(ctx, record, raw, sha256(buffer));
      games++;
    } catch (e) {
      errors.push(`${f}: ${(e as Error).message}`);
    }
  }
  return { games, errors };
}
