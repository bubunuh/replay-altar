// When the collector runs (Settings → Behaviour): what the window does to the collector service. Dry run (REPLAY_ALTAR_NO_SYSTEMD): the commands are printed, never run.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { collectorForWindow, isWindowOpen, loginCommand, markWindowClosed, markWindowOpen, SERVICE } from "../src/service.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const linux = process.platform === "linux";
const darwin = process.platform === "darwin";
let printed: string[] = [];
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.REPLAY_ALTAR_NO_SYSTEMD;
  process.env.REPLAY_ALTAR_NO_SYSTEMD = "1";
  printed = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void printed.push(line.trim()));
});
afterEach(() => {
  vi.restoreAllMocks();
  if (saved === undefined) delete process.env.REPLAY_ALTAR_NO_SYSTEMD;
  else process.env.REPLAY_ALTAR_NO_SYSTEMD = saved;
});

describe.skipIf(!linux)("the collector service and the window (Linux)", () => {
  const run = (...args: string[]) => `(skipped) systemctl --user ${args.join(" ")}`;

  test("off: the window starts it, takes it out of the login, and stops it when it closes", () => {
    collectorForWindow("opened", "off");
    expect(printed).toEqual([run("daemon-reload"), run("disable", SERVICE), run("start", SERVICE)]);
    printed = [];
    collectorForWindow("closed", "off");
    expect(printed).toEqual([run("stop", SERVICE)]);
  });

  test.each(["game", "always"] as const)("%s: running and at login, and left running when the window closes", (mode) => {
    collectorForWindow("opened", mode);
    expect(printed).toEqual([run("daemon-reload"), run("enable", SERVICE), run("start", SERVICE)]);
    printed = [];
    collectorForWindow("closed", mode);
    expect(printed).toEqual([]);
  });

  test("changed to off in Settings: no longer at login, but runs until the window closes", () => {
    collectorForWindow("setting changed", "off");
    expect(printed).toContain(run("disable", SERVICE));
    expect(printed).not.toContain(run("stop", SERVICE));
  });
});

describe.skipIf(!darwin)("the collector service and the window (macOS)", () => {
  test("off: the window disables the LaunchAgent and stops the collector when the window closes", () => {
    collectorForWindow("opened", "off");
    expect(printed.some((line) => line.startsWith("(skipped) launchctl unload "))).toBe(true);
    printed = [];
    collectorForWindow("closed", "off");
    expect(printed.some((line) => line.startsWith("(skipped) systemctl --user stop "))).toBe(false);
  });

  test.each(["game", "always"] as const)("%s: the LaunchAgent loads and stays active while the window is open", (mode) => {
    collectorForWindow("opened", mode);
    expect(printed.some((line) => line.startsWith("(skipped) launchctl load "))).toBe(true);
    printed = [];
    collectorForWindow("closed", mode);
    expect(printed).toEqual([]);
  });

  test("changed to off in Settings: unloads the LaunchAgent without stopping immediately", () => {
    collectorForWindow("setting changed", "off");
    expect(printed.some((line) => line.startsWith("(skipped) launchctl unload "))).toBe(true);
    expect(printed.some((line) => line.startsWith("(skipped) systemctl --user stop "))).toBe(false);
  });
});

describe("start at login, per system", () => {
  test("Linux: the systemd user unit enabled or disabled", () => {
    expect(loginCommand(true, "linux")).toEqual(["systemctl", "--user", "enable", SERVICE]);
    expect(loginCommand(false, "linux")).toEqual(["systemctl", "--user", "disable", SERVICE]);
  });
  test("Windows: the launcher in the user's Run key, or no entry", () => {
    const on = loginCommand(true, "win32");
    expect(on.slice(0, 5)).toEqual(["reg", "add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "ReplayAltarCollector"]);
    expect(on.at(-2)).toMatch(/^wscript\.exe ".*collector\.vbs"$/);
    expect(loginCommand(false, "win32")).toEqual(["reg", "delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "ReplayAltarCollector", "/f"]);
  });
});

describe("the window's mark, for a collector waiting for Warcraft III", () => {
  test("open while the window's process runs; gone when it closes or died", () => {
    const before = process.env.REPLAY_ALTAR_DATA;
    process.env.REPLAY_ALTAR_DATA = mkdtempSync(join(tmpdir(), "ra-window-"));
    try {
      expect(isWindowOpen()).toBe(false);
      markWindowOpen();
      expect(isWindowOpen()).toBe(true);
      markWindowClosed();
      expect(isWindowOpen()).toBe(false);
      writeFileSync(join(process.env.REPLAY_ALTAR_DATA, "window.pid"), "999999999"); // a window that crashed
      expect(isWindowOpen()).toBe(false);
    } finally {
      if (before === undefined) delete process.env.REPLAY_ALTAR_DATA;
      else process.env.REPLAY_ALTAR_DATA = before;
    }
  });
});
