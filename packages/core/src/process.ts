// Is the game running? Used by the collector and the desktop app. Linux reads /proc (the game
// runs under Wine/Proton); Windows asks tasklist; macOS checks the launch services process list.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

/** Parse a Darwin `ps` output where columns are PID + COMMAND, or a `pgrep`/`ps` command's stdout. */
export function parseDarwinProcessList(text: string): boolean {
  const names = text.split(/\r?\n/).flatMap((line) => {
    const m = /^\s*\d+\s+(.*)$/.exec(line.trim());
    if (!m) return [];
    const value = m[1].trim();
    return value ? [value] : [];
  });
  return names.some((name) => /(?:^|[\\/])Warcraft III(?:\.app)?(?:[\\/]|$)/i.test(name) || /(^|\s)Warcraft III(\s|$)/i.test(name));
}

export function isWarcraftRunning(): boolean {
  if (process.platform === "win32") return runningOnWindows();
  if (process.platform === "darwin") return runningOnDarwin();
  return runningUnderWine();
}

function runningOnDarwin(): boolean {
  try {
    const out = execFileSync("ps", ["-axo", "pid,comm"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return parseDarwinProcessList(out);
  } catch {
    return false;
  }
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
