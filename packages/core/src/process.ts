// Is the game running? Used by the collector and the desktop app. Linux reads /proc (the game
// runs under Wine/Proton); Windows asks tasklist.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

export function isWarcraftRunning(): boolean {
  return process.platform === "win32" ? runningOnWindows() : runningUnderWine();
}

/** Under Wine/Proton the game's argv[0] is its Windows path: C:\…\_retail_\x86_64\Warcraft III.exe */
function runningUnderWine(): boolean {
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

/** tasklist prints the matching processes as CSV, or an "INFO: No tasks…" line when there are none. */
function runningOnWindows(): boolean {
  try {
    const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq Warcraft III.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
    return /"Warcraft III\.exe"/i.test(out);
  } catch {
    return false;
  }
}
