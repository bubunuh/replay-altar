// Watches the replay folders and hands finished .w3g files to the ingester.
import { existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const SETTLE_MS = 3000; // file must be unchanged this long before we read it
const RESCAN_MS = 5 * 60_000; // safety net for missed inotify events

/** "event": the file just appeared or changed; "scan": found by a (startup or periodic) rescan. */
export type FileOrigin = "event" | "scan";
export type FileHandler = (path: string, origin: FileOrigin) => Promise<void>;

/** Finished replays only. The game writes TempReplay.w3g while a match is running. */
export const isReplayFile = (name: string) => /\.w3g$/i.test(name) && !/(^|[\\/])TempReplay\.w3g$/i.test(name);

/** What a scan found: every replay in the folders, and the older ones left out by the limit. */
export type ScanResult = { found: number; older: number };

export type WatcherOptions = {
  /** How many of the newest replays a scan imports (null: all). New files are always imported. */
  limit: number | null;
  /** Already imported, unchanged since: a scan doesn't read it again. */
  known: (path: string, size: number, mtime: string) => boolean;
  onScan?: (r: ScanResult) => void;
};

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
        if (name && isReplayFile(name)) this.schedule(join(dir, name), "event");
      });
      w.on("error", (e) => this.log(`watch error on ${dir}: ${e.message}`));
      this.watchers.push(w);
      this.log(`watching ${dir}`);
    }
    this.rescanTimer = setInterval(() => this.scanAll(), RESCAN_MS);
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
   * The newest replays under the watched folders, up to the limit, that aren't imported yet
   * (or changed since, like LastReplay.w3g after every game).
   */
  scanAll() {
    // The folders overlap (Replays and its Autosaved subfolder are both watched): once per file.
    const byPath = new Map<string, { path: string; size: number; mtime: Date }>();
    for (const dir of this.dirs) {
      if (!existsSync(dir)) continue;
      for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
        if (!e.isFile() || !isReplayFile(e.name)) continue;
        const path = join(e.parentPath, e.name);
        if (byPath.has(path)) continue;
        try {
          const s = statSync(path);
          byPath.set(path, { path, size: s.size, mtime: s.mtime });
        } catch {
          // gone meanwhile
        }
      }
    }
    const all = [...byPath.values()];
    all.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const fresh = all.filter((f) => !this.opts.known(f.path, f.size, f.mtime.toISOString()));
    const inLimit = new Set(this.opts.limit === null ? all.map((f) => f.path) : all.slice(0, this.opts.limit).map((f) => f.path));
    for (const f of fresh) if (inLimit.has(f.path)) this.schedule(f.path, "scan");
    this.opts.onScan?.({ found: all.length, older: fresh.filter((f) => !inLimit.has(f.path)).length });
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
