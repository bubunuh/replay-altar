// The desktop side: is Warcraft III running, notifications, opening the window.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { isWarcraftRunning } from "@replay-altar/core";

export { isWarcraftRunning };

const POLL_MS = 5000;

export function watchWarcraft(onStart: () => void, onStop: () => void) {
  let running = isWarcraftRunning();
  return setInterval(() => {
    const now = isWarcraftRunning();
    if (now && !running) onStart();
    if (!now && running) onStop();
    running = now;
  }, POLL_MS);
}

export const desktopLauncher = () => process.env.REPLAY_ALTAR_DESKTOP ?? join(homedir(), ".local/bin/replay-altar-desktop");

export function openDesktop(args: string[]) {
  const child = spawn(desktopLauncher(), args, { detached: true, stdio: "ignore" });
  child.on("error", () => {}); // not installed yet: nothing to open
  child.unref();
}

/** Shows a notification; resolves with the action the user clicked, if any. */
export function notify(title: string, body: string, action?: { id: string; label: string }): Promise<string | null> {
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
