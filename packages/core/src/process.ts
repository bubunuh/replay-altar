// Is the game running? Read from /proc, so it works for the collector and the desktop app.
import { readdirSync, readFileSync } from "node:fs";

/** Under Wine/Proton the game's argv[0] is its Windows path: C:\…\_retail_\x86_64\Warcraft III.exe */
export function isWarcraftRunning(): boolean {
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const argv0 = readFileSync(`/proc/${pid}/cmdline`, "latin1").split("\0")[0];
      if (/[\\/]Warcraft III\.exe$/i.test(argv0)) return true;
    } catch {
      // process exited while we looked
    }
  }
  return false;
}
