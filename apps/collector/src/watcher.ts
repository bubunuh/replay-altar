// Watches the replay folders and hands finished .w3g files to the ingester.
import { existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const SETTLE_MS = 3000; // file must be unchanged this long before we read it
const RESCAN_MS = 5 * 60_000; // safety net for missed inotify events

export type FileHandler = (path: string) => Promise<void>;

export class ReplayWatcher {
  private watchers: FSWatcher[] = [];
  private pending = new Map<string, Promise<void>>();
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
        if (name && name.toLowerCase().endsWith(".w3g")) this.schedule(join(dir, name));
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
        if (e.isFile() && e.name.toLowerCase().endsWith(".w3g")) this.schedule(join(e.parentPath, e.name));
      }
    }
  }

  /** One settle-then-ingest job per path; events arriving meanwhile join the running job. */
  private schedule(path: string) {
    if (this.pending.has(path)) return;
    const job = this.settle(path)
      .then((ok) => (ok ? this.onFile(path) : undefined))
      .catch((e) => this.log(`failed on ${path}: ${(e as Error).message}`))
      .finally(() => this.pending.delete(path));
    this.pending.set(path, job);
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
