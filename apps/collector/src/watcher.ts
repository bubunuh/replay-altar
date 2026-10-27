// Watches the replay folders and hands finished .w3g files to the ingester.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const SETTLE_MS = 3000; // file must be unchanged this long before we read it
const RESCAN_MS = 5 * 60_000; // safety net for missed inotify events

/** "event": the file just appeared or changed; "scan": found by a (startup or periodic) rescan. */
export type FileOrigin = "event" | "scan";
export type FileHandler = (path: string, origin: FileOrigin) => Promise<void>;

/** Finished replays only. The game writes TempReplay.w3g while a match is running. */
export const isReplayFile = (name: string) => /\.w3g$/i.test(name) && !/(^|[\\/])TempReplay\.w3g$/i.test(name);

/**
 * What a scan found: the games in the folders (and the archive), and how many of the older ones
 * the limit leaves out that aren't imported. Copies of one replay (same content, or files the
 * archive index knows as the same game) count once.
 */
export type ScanResult = { found: number; older: number };

/** What the archive index (core analysis.ts) knows of a file. */
export type Known = {
  /** The game it is a copy of. */
  game?: string;
  /** When that game was played, for the order (ms; an archived copy's own date is when it was copied). */
  time?: number;
  /** For an archived copy: the file it was copied from. */
  copyOf?: { path: string; size: number; mtime: string };
};

export type ArchiveScan = {
  /**
   * The archive folder: scanned with the replay folders, never watched. After a start-over its
   * copies are imported again like the replays in the folders (for some games the copy is the only
   * one left); a copy whose replay is still in the folders is left to that replay. Its superseded
   * folder (shorter copies of games archived since) is left out.
   */
  dir: string;
  lookup: (path: string, size: number, mtime: string) => Known | null;
};

export type WatcherOptions = {
  /**
   * Replays saved after this are new games: a scan always imports them (the ones played while
   * the collector was stopped, too). Null: every replay counts as older.
   */
  since: Date | null;
  /**
   * How many of the older replays (saved before `since`) a scan imports, newest first (null: all;
   * 0: none until asked for). A file event always imports its replay.
   */
  limit: number | null;
  /** Already imported, unchanged since: a scan doesn't read it again. Its game key when known. */
  known: (path: string, size: number, mtime: string) => string | boolean | null;
  onScan?: (r: ScanResult) => void;
  archive?: ArchiveScan;
};

type Found = { path: string; size: number; mtime: Date; copy: boolean; known: boolean; time: number; game: string | null };

export class ReplayWatcher {
  private watchers: FSWatcher[] = [];
  private pending = new Map<string, { origin: FileOrigin }>();
  private rescanTimer?: NodeJS.Timeout;
  private dirs: string[];
  private onFile: FileHandler;
  private log: (msg: string) => void;
  private opts: WatcherOptions;
  // One replay is read at a time: thousands parsed at once filled the memory and froze the PC.
  private queue: Promise<void> = Promise.resolve();
  /** Contents of files of the same size, read once per version of the file. */
  private hashes = new Map<string, string>();

  constructor(dirs: string[], onFile: FileHandler, log: (msg: string) => void, opts: WatcherOptions) {
    this.dirs = dirs;
    this.onFile = onFile;
    this.log = log;
    this.opts = opts;
  }

  start() {
    for (const dir of this.dirs) {
      if (!existsSync(dir)) continue;
      const w = watch(dir, { recursive: true }, (_event, name) => {
        if (name && isReplayFile(name)) this.onEvent(join(dir, name));
      });
      w.on("error", (e) => this.log(`watch error on ${dir}: ${e.message}`));
      this.watchers.push(w);
      this.log(`watching ${dir}`);
    }
    this.rescanTimer = setInterval(() => this.scanAll(), RESCAN_MS);
  }

  /**
   * A file appeared or changed: a game that just ended (or LastReplay.w3g rewritten). Windows also
   * reports a file whose last-access time or attributes changed (reading it, OneDrive): an
   * imported file that is unchanged needs nothing, and a replay dated before `since` (touched, or
   * copied in with its date) is an older replay, imported only when the limit takes it (at the
   * next scan).
   */
  onEvent(path: string) {
    let s;
    try {
      s = statSync(path);
    } catch {
      return; // gone (or not written yet: another event follows)
    }
    if (this.opts.known(path, s.size, s.mtime.toISOString())) return;
    if (this.opts.limit !== null && this.opts.since && s.mtimeMs <= this.opts.since.getTime()) return;
    this.schedule(path, "event");
  }

  /** Files waiting to settle or being ingested. */
  get pendingCount() {
    return this.pending.size;
  }

  stop() {
    for (const w of this.watchers) w.close();
    clearInterval(this.rescanTimer);
  }

  /**
   * The replays under the watched folders (and the archive) that aren't imported yet (or changed
   * since, like LastReplay.w3g after every game): every new one, and the newest older ones up to
   * the limit. Copies of one game go together: the limit and the count take them as one.
   */
  scanAll() {
    // The folders overlap (Replays and its Autosaved subfolder are both watched): once per file.
    const byPath = new Map<string, Found>();
    const add = (dir: string, copy: boolean) => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
        if (!e.isFile() || !isReplayFile(e.name)) continue;
        const path = join(e.parentPath, e.name);
        if (byPath.has(path)) continue;
        if (copy && this.opts.archive && `${path}`.startsWith(join(this.opts.archive.dir, "superseded") + sep)) continue;
        try {
          const s = statSync(path);
          const mtime = s.mtime.toISOString();
          const known = this.opts.known(path, s.size, mtime);
          const look = this.opts.archive?.lookup(path, s.size, mtime) ?? null;
          const game = typeof known === "string" ? known : (look?.game ?? null);
          byPath.set(path, { path, size: s.size, mtime: s.mtime, copy, known: !!known, time: look?.time ?? s.mtimeMs, game });
          if (copy && look?.copyOf) copyOf.set(path, look.copyOf);
        } catch {
          // gone meanwhile
        }
      }
    };
    const copyOf = new Map<string, NonNullable<Known["copyOf"]>>();
    for (const dir of this.dirs) add(dir, false);
    if (this.opts.archive) add(this.opts.archive.dir, true);
    // An archived copy whose replay is still where it was copied from, unchanged: that replay stands for it.
    for (const [path, from] of copyOf) {
      const f = byPath.get(from.path);
      if (f && !f.copy && f.size === from.size && f.mtime.toISOString() === from.mtime) byPath.delete(path);
    }
    const { units, redundant } = this.games([...byPath.values()]);
    const time = (u: Found[]) => Math.max(...u.map((f) => f.time));
    units.sort((a, b) => time(b) - time(a));
    const since = this.opts.since?.getTime() ?? Infinity;
    const older = units.filter((u) => time(u) <= since);
    const wanted = [...units.filter((u) => time(u) > since), ...(this.opts.limit === null ? older : older.slice(0, this.opts.limit))];
    for (const u of wanted) for (const f of u) if (!f.known && !redundant.has(f.path)) this.schedule(f.path, "scan");
    const inLimit = new Set(wanted);
    this.opts.onScan?.({ found: units.length, older: older.filter((u) => !inLimit.has(u) && !u.some((f) => f.known)).length });
  }

  /**
   * The files grouped by game: the ones the archive index knows by their game, the others by
   * content (only files of the same size are read, and only when one of them isn't imported).
   * `redundant`: archived copies with the same content as a replay in the folders (importing that
   * replay brings the game) or as another copy; never imported themselves.
   */
  private games(files: Found[]): { units: Found[][]; redundant: Set<string> } {
    const parent = new Map<string, string>(files.map((f) => [f.path, f.path]));
    const root = (p: string): string => {
      for (let q = parent.get(p)!; q !== p; q = parent.get(p)!) {
        parent.set(p, parent.get(q)!);
        p = q;
      }
      return p;
    };
    const join2 = (a: string, b: string) => parent.set(root(a), root(b));
    const byGame = new Map<string, string>();
    for (const f of files) {
      if (!f.game) continue;
      const other = byGame.get(f.game);
      if (other) join2(f.path, other);
      else byGame.set(f.game, f.path);
    }
    const bySize = new Map<number, Found[]>();
    for (const f of files) bySize.set(f.size, [...(bySize.get(f.size) ?? []), f]);
    const redundant = new Set<string>();
    for (const same of bySize.values()) {
      if (same.length < 2 || same.every((f) => f.known)) continue;
      const byHash = new Map<string, Found[]>();
      for (const f of same) {
        const h = this.hash(f);
        if (h) byHash.set(h, [...(byHash.get(h) ?? []), f]);
      }
      for (const [h, group] of byHash) {
        for (const f of group) {
          join2(f.path, group[0].path);
        }
        const original = group.find((f) => !f.copy);
        for (const f of group) if (f.copy && (original || f !== group.find((g) => g.copy && (g.known || !group.some((x) => x.known))))) redundant.add(f.path);
      }
    }
    const units = new Map<string, Found[]>();
    for (const f of files) {
      const r = root(f.path);
      units.set(r, [...(units.get(r) ?? []), f]);
    }
    return { units: [...units.values()], redundant };
  }

  private hash(f: Found): string | null {
    const key = `${f.path}|${f.size}|${f.mtime.getTime()}`;
    let h = this.hashes.get(key);
    if (!h) {
      try {
        h = createHash("sha256").update(readFileSync(f.path)).digest("hex");
      } catch {
        return null;
      }
      this.hashes.set(key, h);
    }
    return h;
  }

  /** One settle-then-ingest job per path; events arriving meanwhile join the running job. */
  private schedule(path: string, origin: FileOrigin) {
    const running = this.pending.get(path);
    if (running) {
      // A real file event outranks the rescan that happened to get there first.
      if (origin === "event") running.origin = "event";
      return;
    }
    const job = { origin };
    this.pending.set(path, job);
    this.settle(path)
      .then((ok) => (ok ? this.enqueue(() => this.onFile(path, job.origin)) : undefined))
      .catch((e) => this.log(`failed on ${path}: ${(e as Error).message}`))
      .finally(() => this.pending.delete(path));
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => {});
    return run;
  }

  private async settle(path: string): Promise<boolean> {
    let last = "";
    for (;;) {
      if (!existsSync(path)) return false;
      const s = statSync(path);
      const sig = `${s.size}:${s.mtimeMs}`;
      if (sig === last && s.size > 0) return true;
      last = sig;
      await sleep(SETTLE_MS);
    }
  }
}
