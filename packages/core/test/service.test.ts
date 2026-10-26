// "Keep Replay Altar running after closing the window": what the window does to the collector
// service. Dry run (REPLAY_ALTAR_NO_SYSTEMD): the commands are printed, never run.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { collectorForWindow, loginCommand, SERVICE } from "../src/service.ts";

const linux = process.platform !== "win32";
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
    collectorForWindow("opened", false);
    expect(printed).toEqual([run("daemon-reload"), run("disable", SERVICE), run("start", SERVICE)]);
    printed = [];
    collectorForWindow("closed", false);
    expect(printed).toEqual([run("stop", SERVICE)]);
  });

  test("on: running and at login, and left running when the window closes", () => {
    collectorForWindow("opened", true);
    expect(printed).toEqual([run("daemon-reload"), run("enable", SERVICE), run("start", SERVICE)]);
    printed = [];
    collectorForWindow("closed", true);
    expect(printed).toEqual([]);
  });

  test("turned off in Settings: no longer at login, but runs until the window closes", () => {
    collectorForWindow("setting changed", false);
    expect(printed).toContain(run("disable", SERVICE));
    expect(printed).not.toContain(run("stop", SERVICE));
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
