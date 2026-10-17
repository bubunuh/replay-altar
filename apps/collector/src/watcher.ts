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

export class ReplayWatcher {
  private watchers: FSWatcher[] = [];
  private pending = new Map<string, { origin: FileOrigin }>();
  private rescanTimer?: NodeJS.Timeout;
  private dirs: string[];
  private onFile: FileHandler;
  private log: (msg: string) => void;

  constructor(dirs: string[], onFile: FileHandler, log: (msg: string) => void) {
    this.dirs = dirs;
    this.onFile = onFile;
    this.log = log;
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

  stop() {
    for (const w of this.watchers) w.close();
    clearInterval(this.rescanTimer);
  }

  /** Every .w3g under the watched folders. The ingester skips files it has already seen. */
  scanAll() {
    for (const dir of this.dirs) {
      if (!existsSync(dir)) continue;
      for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
        if (e.isFile() && isReplayFile(e.name)) this.schedule(join(e.parentPath, e.name), "scan");
      }
    }
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
      .then((ok) => (ok ? this.onFile(path, job.origin) : undefined))
      .catch((e) => this.log(`failed on ${path}: ${(e as Error).message}`))
      .finally(() => this.pending.delete(path));
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
