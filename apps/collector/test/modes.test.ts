// When the collector is awake (Settings → Behaviour), modes.ts.
import { describe, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, collectorMode, paths } from "@replay-altar/core";
import { AWAKE_AFTER_MS, backToWaiting, holdSimulations, WAIT_TICK_MS, WAIT_WARCRAFT_EVERY, waitForWake, wanted } from "../src/modes.ts";
import { SimQueue } from "../src/simqueue.ts";

describe("collector modes", () => {
  test("default: only while Warcraft III runs, for new installs and updates alike; unknown values too", () => {
    expect(collectorMode({ ...DEFAULT_CONFIG })).toBe("game");
    expect(collectorMode({ ...DEFAULT_CONFIG, collectorMode: "always" })).toBe("always");
    expect(collectorMode({ ...DEFAULT_CONFIG, collectorMode: "off" })).toBe("off");
    expect(collectorMode({ ...DEFAULT_CONFIG, collectorMode: "sometimes" as never })).toBe("game");
  });

  test("awake: always and off whenever they run; game only for the game or the window", () => {
    const none = { warcraft: false, window: false };
    expect(wanted("always", none)).toBe(true);
    expect(wanted("off", none)).toBe(true);
    expect(wanted("game", none)).toBe(false);
    expect(wanted("game", { warcraft: true, window: false })).toBe(true);
    expect(wanted("game", { warcraft: false, window: true })).toBe(true);
  });

  test("simulations wait for the match to end only in game mode", () => {
    expect(holdSimulations("game", true)).toBe(true);
    expect(holdSimulations("game", false)).toBe(false);
    expect(holdSimulations("always", true)).toBe(false);
    expect(holdSimulations("off", true)).toBe(false);
  });

  test("back to waiting a few minutes after the game closed, once the work is done", () => {
    const closed = 1_000_000;
    expect(backToWaiting("game", closed + AWAKE_AFTER_MS - 1, closed, false)).toBe(false);
    expect(backToWaiting("game", closed + AWAKE_AFTER_MS, closed, false)).toBe(true);
    expect(backToWaiting("game", closed + 10 * AWAKE_AFTER_MS, closed, true)).toBe(false); // still simulating
    expect(backToWaiting("always", closed + 10 * AWAKE_AFTER_MS, closed, false)).toBe(false);
    expect(backToWaiting("off", closed + 10 * AWAKE_AFTER_MS, closed, false)).toBe(false);
  });
});

describe("waiting, light", () => {
  /** Runs waitForWake against a timeline: what is seen at each tick. */
  async function wait(timeline: (tick: number) => { warcraft: boolean; window: boolean }) {
    let tick = 0;
    let warcraftLooks = 0;
    const wake = await waitForWake(
      (warcraftToo) => {
        if (warcraftToo) warcraftLooks++;
        const seen = timeline(tick);
        return { warcraft: warcraftToo && seen.warcraft, window: seen.window };
      },
      async (ms) => {
        expect(ms).toBe(WAIT_TICK_MS);
        tick++;
      },
    );
    return { wake, tick, warcraftLooks };
  }

  test("the game appears: awake within a few ticks, looking at the process list only every few", async () => {
    const r = await wait((t) => ({ warcraft: t >= 7, window: false }));
    expect(r.wake).toBe("warcraft started");
    expect(r.tick).toBe(2 * WAIT_WARCRAFT_EVERY); // the next look after it appeared
    expect(r.warcraftLooks).toBe(3);
    expect(r.tick * WAIT_TICK_MS).toBeLessThanOrEqual(20_000);
  });

  test("the game already ran at login: awake, without opening the window", async () => {
    expect((await wait(() => ({ warcraft: true, window: false }))).wake).toBe("warcraft running");
  });

  test("the window opens: awake at the next tick", async () => {
    const r = await wait((t) => ({ warcraft: false, window: t >= 3 }));
    expect(r).toMatchObject({ wake: "window", tick: 3 });
  });
});

describe("simulations held during a match", () => {
  test("queued while held, taken up after resume()", async () => {
    let held = true;
    // Games without a record on disk: the queue takes them and skips them, never running WC3V.
    const q = new SimQueue({ paths: paths(mkdtempSync(join(tmpdir(), "ra-held-"))) } as never, () => {}, () => held);
    q.add("a");
    q.add("b");
    await new Promise((r) => setTimeout(r, 10));
    expect(q.pending).toBe(2);
    expect(q.progress).toBe(null); // no progress bar during the match
    held = false;
    q.resume();
    await new Promise((r) => setTimeout(r, 10));
    expect(q.pending).toBe(0);
  });
});
