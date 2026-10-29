// The collector as a background service. Linux: a systemd user unit. Windows: the installed app's
// own executable as the CLI (`ReplayAltar.exe --cli collector`; a checkout: a hidden launcher
// script, collector.vbs), with the running collector's pid in collector.pid (no admin rights
// needed for either). It starts at login (the unit enabled; the command in the user's Run key)
// unless Settings → Behaviour says to run it only with the window ("off"), in which case the
// window starts it and stops it when it closes. The window marks itself open in window.pid, so a
// collector waiting for Warcraft III ("game") wakes up for it too.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { dataDir, type CollectorMode } from "./config.ts";
import { isInstalled } from "./root.ts";

export const SERVICE = "replay-altar-collector.service";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const RUN_VALUE = "ReplayAltarCollector";
const windows = process.platform === "win32";

export const collectorFiles = () => ({
  /** A checkout's launcher (an installed copy before 0.2.3 had one too, removed by the window). */
  launcher: join(dataDir(), "bin/collector.vbs"),
  pid: join(dataDir(), "collector.pid"),
  log: join(dataDir(), "logs/collector.log"),
  /** The window's pid while it is open. */
  windowPid: join(dataDir(), "window.pid"),
});

/** The Linux user unit's file, as install and the AppImage write it. */
export const linuxUnitFile = () => join(homedir(), ".config/systemd/user", SERVICE);

/** Is the collector set up as a service on this computer (by an install, the AppImage or the Windows app)? */
export const collectorInstalled = () => (windows ? isInstalled() || existsSync(collectorFiles().launcher) : existsSync(linuxUnitFile()));

/**
 * An installed Windows copy's collector: its own executable, which runs the CLI on itself as Node
 * and stays (without a window) until it is done, as the AppImage does. 0.2.2 and earlier went
 * through a hidden script started by wscript.exe, which antivirus programs took for a trojan.
 */
export const windowsCollectorCommand = (exe = process.execPath) => [exe, "--cli", "collector"];

let loginItem: ((on: boolean) => void) | null = null;

/** The window of an installed Windows copy writes the Run entry itself (Electron's login items), not through reg.exe. */
export function useLoginItem(set: (on: boolean) => void) {
  loginItem = set;
}

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

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Called by the window: a collector waiting for Warcraft III wakes up while it is open. */
export function markWindowOpen() {
  const file = collectorFiles().windowPid;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, String(process.pid));
}

/** The window is closing (or crashed and restarted: only its own mark is removed). */
export function markWindowClosed() {
  const file = collectorFiles().windowPid;
  try {
    if (readFileSync(file, "utf8") === String(process.pid)) rmSync(file);
  } catch {
    // not there
  }
}

/** Is Replay Altar's window open? (window.pid names a running process.) */
export function isWindowOpen(): boolean {
  try {
    const pid = Number(readFileSync(collectorFiles().windowPid, "utf8"));
    return pid > 0 && alive(pid);
  } catch {
    return false;
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
  if (windows) return runningPid() ? "active" : collectorInstalled() ? "inactive" : "not installed";
  try {
    return execFileSync("systemctl", ["--user", "is-active", SERVICE], { encoding: "utf8" }).trim();
  } catch (e) {
    return ((e as { stdout?: string }).stdout ?? "").trim() || "not installed";
  }
}

function startOnWindows() {
  const [cmd, ...args] = isInstalled() ? windowsCollectorCommand() : ["wscript.exe", collectorFiles().launcher];
  if (dryRun()) return console.log(`  (skipped) start ${[cmd, ...args].join(" ")}`);
  if (runningPid()) return;
  // Without ELECTRON_RUN_AS_NODE, so the executable starts as the app (its --cli) rather than as Node.
  const { ELECTRON_RUN_AS_NODE: _node, ...env } = process.env;
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true, env }).unref();
}

function stopOnWindows() {
  if (dryRun()) return console.log("  (skipped) stop the collector");
  const pid = runningPid();
  if (!pid) return;
  // Not its whole process tree (taskkill /T): a window the collector opened is one of its children.
  try {
    process.kill(pid);
  } catch {
    // already gone
  }
  rmSync(collectorFiles().pid, { force: true });
}

/** What the Run entry starts on Windows: the installed executable as the CLI, or a checkout's launcher. */
export const windowsLoginValue = (installed = isInstalled()) =>
  installed ? windowsCollectorCommand().map((a) => `"${a}"`).join(" ") : `wscript.exe "${collectorFiles().launcher}"`;

/** The command that makes the collector start at every login, or no longer (`on` false). */
export function loginCommand(on: boolean, platform: NodeJS.Platform = process.platform, installed = isInstalled()): string[] {
  if (platform !== "win32") return ["systemctl", "--user", on ? "enable" : "disable", SERVICE];
  return on ? ["reg", "add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", windowsLoginValue(installed), "/f"] : ["reg", "delete", RUN_KEY, "/v", RUN_VALUE, "/f"];
}

function setLogin(on: boolean) {
  if (windows && loginItem) {
    if (dryRun()) return console.log(`  (skipped) login item ${on ? "on" : "off"}`);
    return loginItem(on);
  }
  const [cmd, ...args] = loginCommand(on);
  if (dryRun()) return console.log(`  (skipped) ${[cmd, ...args].join(" ")}`);
  try {
    execFileSync(cmd, args, { stdio: windows ? "ignore" : "inherit", windowsHide: true });
  } catch {
    // e.g. deleting a Run entry that is not there
  }
}

/**
 * Start the collector now (if it isn't running) and at every login only when `atLogin`; false
 * also takes it out of the login (Linux: the unit disabled; Windows: no Run entry).
 */
export function startCollector(atLogin: boolean) {
  if (!windows) systemctl("daemon-reload"); // the unit file may have just been (re)written
  setLogin(atLogin);
  if (!windows) return systemctl("start", SERVICE);
  startOnWindows();
}

/** Stop the collector now (the window closed and it shouldn't keep running); login unchanged. */
export function stopCollector() {
  if (!windows) return systemctl("stop", SERVICE);
  stopOnWindows();
}

/** Start now and at every login. */
export function enableCollector() {
  startCollector(true);
}

/** Stop now and not at login. */
export function disableCollector() {
  setLogin(false);
  stopCollector();
}

/**
 * What the window does with the collector, by when it should run (Settings → Behaviour): when the
 * window opens or the setting changes, the collector runs, and starts at login unless "off"; when
 * the window closes, an "off" collector stops (a "game" one goes back to waiting by itself).
 */
export function collectorForWindow(moment: "opened" | "setting changed" | "closed", mode: CollectorMode) {
  if (moment !== "closed") return startCollector(mode !== "off");
  if (mode === "off") stopCollector();
}

/** After a settings change: the collector reads its settings at start. */
export function restartCollectorIfRunning() {
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
 * A checkout's hidden launcher, which Windows runs at login: `command` (program and arguments)
 * with no console window (node.exe would open one), its output appended to the log, with `env`
 * set first. VBScript doubles quotes inside strings.
 */
export function windowsLauncher(command: string[], env: Record<string, string> = {}): string {
  const files = collectorFiles();
  const sets = Object.entries(env).map(([k, v]) => `set "${k}=${v}" && `).join("");
  const line = `cmd /c "${sets}${command.map((a) => `"${a}"`).join(" ")} >> "${files.log}" 2>&1"`;
  return `' Replay Altar collector (started at login from the Run key; see replay-altar status)\r\nCreateObject("WScript.Shell").Run "${line.replaceAll('"', '""')}", 0, False\r\n`;
}
