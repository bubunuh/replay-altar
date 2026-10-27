// The archive as the replay scan sees it (watcher.ts): after a start-over (core analysis.ts) its
// copies are imported again like the replays in the folders, and its index says which game each
// copy is, when that game was played and which file it was copied from.
import { join } from "node:path";
import { archivedEndTime, archiveTime, isInside, readArchiveIndex, type ArchiveEntry, type Paths } from "@replay-altar/core";
import type { Known } from "./watcher.ts";

/**
 * What the archive index knows of a file for the scan: an archived copy's game, when it was
 * played and the file it was copied from; a replay in the folders it was imported from, its game.
 */
export function archiveLookup(p: Paths): (path: string, size: number, mtime: string) => Known | null {
  let built: { stamp: object; byArchive: Map<string, ArchiveEntry>; byFile: Map<string, ArchiveEntry> } | null = null;
  const tables = () => {
    const index = readArchiveIndex(p);
    if (built?.stamp !== index) {
      const byArchive = new Map<string, ArchiveEntry>();
      const byFile = new Map<string, ArchiveEntry>();
      for (const e of Object.values(index.bySha)) {
        byArchive.set(key(join(p.archive, ...e.archive.split("/"))), e);
        for (const f of e.files) byFile.set(`${key(f.path)}|${f.size}|${f.mtime}`, e);
      }
      built = { stamp: index, byArchive, byFile };
    }
    return built;
  };
  const key = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);
  return (path, size, mtime) => {
    const t = tables();
    const copy = t.byArchive.get(key(path));
    if (copy) {
      const original = copy.files.find((f) => f.sha256 === copy.sha256);
      return { game: copy.gameKey, time: archivedEndTime(copy) ?? undefined, copyOf: original && { path: original.path, size: original.size, mtime: original.mtime } };
    }
    if (isInside(path, p.archive)) return { time: Date.parse(archiveTime(path, Date.parse(mtime), 0).endedAt) };
    const from = t.byFile.get(`${key(path)}|${size}|${mtime}`);
    return from ? { game: from.gameKey } : null;
  };
}

