// The desktop side: is Warcraft III running, notifications, opening the window.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { isInstalled, isWarcraftRunning } from "@replay-altar/core";
import { windowsDesktop } from "./install.ts";

const windows = process.platform === "win32";

export { isWarcraftRunning };

const POLL_MS = 5000;

/** Calls onStart / onStop when the game appears or goes, and `onTick` after every look. */
export function watchWarcraft(onStart: () => void, onStop: () => void, running = isWarcraftRunning(), onTick: () => void = () => {}) {
  return setInterval(() => {
    const now = isWarcraftRunning();
    if (now && !running) onStart();
    if (!now && running) onStop();
    running = now;
    onTick();
  }, POLL_MS);
}

/** The desktop app as a program and its leading arguments (REPLAY_ALTAR_DESKTOP overrides the program). */
export function desktopCommand(): { exe: string; args: string[] } {
  if (process.env.REPLAY_ALTAR_DESKTOP) return { exe: process.env.REPLAY_ALTAR_DESKTOP, args: [] };
  // AppImage: the file itself (the executable inside it only exists while something runs it).
  if (process.env.APPIMAGE) return { exe: process.env.APPIMAGE, args: [] };
  // Installed: the collector runs on the app's own executable (as Node), which is the app.
  if (isInstalled()) return { exe: process.execPath, args: [] };
  return windows ? windowsDesktop() : { exe: join(homedir(), ".local/bin/replay-altar-desktop"), args: [] };
}

export function openDesktop(args: string[]) {
  const app = desktopCommand();
  // Without ELECTRON_RUN_AS_NODE, so an installed copy opens as the app rather than as Node.
  const { ELECTRON_RUN_AS_NODE: _node, ...env } = process.env;
  const child = spawn(app.exe, [...app.args, ...args], { detached: true, stdio: "ignore", env });
  child.on("error", () => {}); // not installed yet: nothing to open
  child.unref();
}

/** Shows a notification; resolves with the action the user clicked, if any. */
export function notify(title: string, body: string, action?: { id: string; label: string }): Promise<string | null> {
  return windows ? toast(title, body, action) : notifySend(title, body, action);
}

function notifySend(title: string, body: string, action?: { id: string; label: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const args = ["--app-name=Replay Altar", "--icon=replay-altar", "--expire-time=15000"];
    if (action) args.push(`--action=${action.id}=${action.label}`, "--wait");
    const child = spawn("notify-send", [...args, title, body], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(out.trim() || null));
  });
}

/**
 * A Windows toast through PowerShell's WinRT bridge (Windows 10 and 11, nothing to install),
 * shown under PowerShell's app id. With an action, waits up to 20 s for a click on the toast and
 * prints the action id. Texts go in through the environment, never through the script.
 */
function toast(title: string, body: string, action?: { id: string; label: string }): Promise<string | null> {
  const script = [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
    "$t = $xml.GetElementsByTagName('text'); $t.Item(0).InnerText = $env:RA_TITLE; $t.Item(1).InnerText = $env:RA_BODY",
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
    "$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "if ($env:RA_ACTION) { Register-ObjectEvent -InputObject $toast -EventName Activated -SourceIdentifier ra | Out-Null }",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)",
    "if ($env:RA_ACTION) { if (Wait-Event -SourceIdentifier ra -Timeout 20) { Write-Output $env:RA_ACTION } }",
  ].join("\n");
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, RA_TITLE: title, RA_BODY: body, RA_ACTION: action?.id ?? "" },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(out.trim() || null));
  });
}
