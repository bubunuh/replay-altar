// The collector as a background service that starts at login. Linux: a systemd user unit.
// Windows: a hidden launcher script (collector.vbs) in the user's Run key, with the running
// collector's pid in collector.pid (no admin rights needed for either).
// macOS: a LaunchAgent that runs the collector in the background under the current user session.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { dataDir } from "./config.ts";

export const SERVICE = "replay-altar-collector.service";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "ReplayAltarCollector";
const windows = process.platform === "win32";
const darwin = process.platform === "darwin";
const LAUNCH_AGENTS_DIR = "Library/LaunchAgents";

export const darwinLaunchAgentPath = () => join(homedir(), LAUNCH_AGENTS_DIR, "replay-altar-collector.plist");

/** A macOS LaunchAgent plist that starts the collector at login. */
export function darwinLaunchAgent(binary: string, args: string[] = []): string {
  const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    "  <string>replay-altar-collector</string>",
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...[binary, ...args].map((arg) => `  <string>${xml(arg)}</string>`),
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <false/>",
    "</dict>",
    "</plist>",
  ].join("\n");
}

export const collectorFiles = () => ({
  launcher: join(dataDir(), "bin/collector.vbs"),
  macosPlist: join(dataDir(), "bin/replay-altar-collector.plist"),
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
  if (darwin) {
    const plist = darwinLaunchAgentPath();
    if (!existsSync(plist)) return "not installed";
    return runningPid() ? "active" : "inactive";
  }
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
  if (darwin) {
    const plist = darwinLaunchAgentPath();
    const launchPath = join(homedir(), ".local/bin/replay-altar");
    const agent = darwinLaunchAgent(launchPath, ["collector"]);
    if (dryRun()) return console.log(`  (skipped) launchctl load ${plist}`);
    mkdirSync(dirname(plist), { recursive: true });
    writeFileSync(plist, agent);
    const uid = process.getuid?.() ?? 0;
    try {
      execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plist], { stdio: "inherit" });
    } catch {
      execFileSync("launchctl", ["load", "-w", plist], { stdio: "inherit" });
    }
    return;
  }
  if (!windows) {
    systemctl("daemon-reload");
    return systemctl("enable", "--now", SERVICE);
  }
  reg("add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", `wscript.exe "${collectorFiles().launcher}"`, "/f");
  startOnWindows();
}

/** Stop now and not at login. */
export function disableCollector() {
  if (darwin) {
    const plist = darwinLaunchAgentPath();
    if (dryRun()) return console.log(`  (skipped) launchctl unload ${plist}`);
    const uid = process.getuid?.() ?? 0;
    try {
      execFileSync("launchctl", ["bootout", `gui/${uid}`, plist], { stdio: "inherit" });
    } catch {
      execFileSync("launchctl", ["unload", "-w", plist], { stdio: "inherit" });
    }
    rmSync(plist, { force: true });
    return;
  }
  if (!windows) return systemctl("disable", "--now", SERVICE);
  reg("delete", RUN_KEY, "/v", RUN_VALUE, "/f");
  stopOnWindows();
}

/** After a settings change: the collector reads its settings at start. */
export function restartCollectorIfRunning() {
  if (darwin) {
    if (!runningPid()) return;
    const uid = process.getuid?.() ?? 0;
    try {
      execFileSync("launchctl", ["kickstart", "-k", `gui/${uid}/replay-altar-collector`], { stdio: "inherit" });
    } catch {
      // already restarted or not installed
    }
    return;
  }
  if (!windows) return systemctl("try-restart", SERVICE);
  if (!runningPid()) return;
  stopOnWindows();
  startOnWindows();
}

/** systemd's quoting for one ExecStart word ($ and % are expanded by systemd unless doubled). */
export const systemdWord = (s: string) => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "$$$$").replaceAll("%", "%%")}"`;

/** The Linux collector's systemd user unit, running `command` (program and arguments). */
export function linuxUnit(command: string[]): string {
  return [
    "[Unit]",
    "Description=Replay Altar replay collector (archives and analyzes Warcraft III replays)",
    "After=graphical-session.target",
    "",
    "[Service]",
    `ExecStart=${command.map(systemdWord).join(" ")}`,
    "Restart=on-failure",
    "RestartSec=10",
    "Nice=10",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/**
 * The hidden launcher Windows runs at login: `command` (program and arguments) with no console
 * window, its output appended to the log, with `env` set first (an installed copy runs the
 * collector with its own Electron as Node: ELECTRON_RUN_AS_NODE=1). VBScript doubles quotes
 * inside strings.
 */
export function windowsLauncher(command: string[], env: Record<string, string> = {}): string {
  const files = collectorFiles();
  const sets = Object.entries(env).map(([k, v]) => `set "${k}=${v}" && `).join("");
  const line = `cmd /c "${sets}${command.map((a) => `"${a}"`).join(" ")} >> "${files.log}" 2>&1"`;
  return `' Replay Altar collector (started at login from the Run key; see replay-altar status)\r\nCreateObject("WScript.Shell").Run "${line.replaceAll('"', '""')}", 0, False\r\n`;
}
