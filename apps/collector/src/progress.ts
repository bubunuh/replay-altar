// What the collector is busy with, for the window's progress bar (progress.json in the data
// folder, rewritten every second while something changes). Mostly the first start: setting up,
// importing the replays already on the computer, then simulating them one by one.
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Progress } from "@replay-altar/core";

export function progressWriter(root: string) {
  const file = join(root, "progress.json");
  let last = "";
  return (p: Omit<Progress, "at">) => {
    const body = JSON.stringify(p);
    // Rewritten when it changes, and every 10 s while busy so the window knows we're alive.
    const busy = p.setup !== null || p.import !== null || p.sims !== null;
    const stamp = busy ? Math.floor(Date.now() / 10_000) : 0;
    if (body + stamp === last) return;
    last = body + stamp;
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...p, at: new Date().toISOString() }));
    renameSync(tmp, file);
  };
}
