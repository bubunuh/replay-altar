// The collector as a background service that starts at login. Linux: a systemd user unit.
// Windows: a hidden launcher script (collector.vbs) in the user's Run key, with the running
// collector's pid in collector.pid (no admin rights needed for either).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./config.ts";

export const SERVICE = "replay-altar-collector.service";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "ReplayAltarCollector";
const windows = process.platform === "win32";

export const collectorFiles = () => ({
  launcher: join(dataDir(), "bin/collector.vbs"),
  pid: join(dataDir(), "collector.pid"),
  log: join(dataDir(), "logs/collector.log"),
});

// REPLAY_ALTAR_NO_SYSTEMD=1 (tests): write files only, never touch the running user session.
const dryRun = () => !!process.env.REPLAY_ALTAR_NO_SYSTEMD;

const systemctl = (...args: string[]) => {
  if (dryRun()) return console.log(`  (skipped) systemctl --user ${args.join(" ")}`);
  try {
    execFileSync("systemctl", ["--user", ...args], { stdio: "inherit" });
  } catch {
    // e.g. stopping a unit that is not loaded
  }
};

const reg = (...args: string[]) => {
  if (dryRun()) return console.log(`  (skipped) reg ${args.join(" ")}`);
  try {
    execFileSync("reg", args, { stdio: "ignore", windowsHide: true });
  } catch {
    // e.g. deleting a value that is not there
  }
};

/** The collector's pid while it runs (Windows), from the file it writes at start. */
function runningPid(): number | null {
  const file = collectorFiles().pid;
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, "utf8"));
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/** Called by the collector itself: lets `status`, stop and restart find it on Windows. */
export function markCollectorRunning() {
  const file = collectorFiles().pid;
  writeFileSync(file, String(process.pid));
  process.on("exit", () => {
    if (existsSync(file) && readFileSync(file, "utf8") === String(process.pid)) rmSync(file);
  });
}

/** "active", "inactive" (installed, not running), "not installed", or systemd's own word. */
export function collectorState(): string {
  if (windows) return runningPid() ? "active" : existsSync(collectorFiles().launcher) ? "inactive" : "not installed";
  try {
    return execFileSync("systemctl", ["--user", "is-active", SERVICE], { encoding: "utf8" }).trim();
  } catch (e) {
    return ((e as { stdout?: string }).stdout ?? "").trim() || "not installed";
  }
}

function startOnWindows() {
  if (dryRun()) return console.log(`  (skipped) start ${collectorFiles().launcher}`);
  if (runningPid()) return;
  spawn("wscript.exe", [collectorFiles().launcher], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

function stopOnWindows() {
  if (dryRun()) return console.log("  (skipped) stop the collector");
  const pid = runningPid();
  if (!pid) return;
  try {
    process.kill(pid);
  } catch {
    // already gone
  }
  rmSync(collectorFiles().pid, { force: true });
}

/** Start now and at every login. */
export function enableCollector() {
  if (!windows) {
    systemctl("daemon-reload");
    return systemctl("enable", "--now", SERVICE);
  }
  reg("add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", `wscript.exe "${collectorFiles().launcher}"`, "/f");
  startOnWindows();
}

/** Stop now and not at login. */
export function disableCollector() {
  if (!windows) return systemctl("disable", "--now", SERVICE);
  reg("delete", RUN_KEY, "/v", RUN_VALUE, "/f");
  stopOnWindows();
}

/** After a settings change: the collector reads its settings at start. */
export function restartCollectorIfRunning() {
  if (!windows) return systemctl("try-restart", SERVICE);
  if (!runningPid()) return;
  stopOnWindows();
  startOnWindows();
}

/**
 * The hidden launcher Windows runs at login: `command` (program and arguments) with no console
 * window, its output appended to the log. VBScript doubles quotes inside strings.
 */
export function windowsLauncher(command: string[]): string {
  const files = collectorFiles();
  const line = `cmd /c "${command.map((a) => `"${a}"`).join(" ")} >> "${files.log}" 2>&1"`;
  return `' Replay Altar collector (started at login from the Run key; see replay-altar status)\r\nCreateObject("WScript.Shell").Run "${line.replaceAll('"', '""')}", 0, False\r\n`;
}
