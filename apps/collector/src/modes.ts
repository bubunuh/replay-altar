// When the collector is awake, by Settings → Behaviour (Config.collectorMode):
// - "always": all the time (watching the replay folders, simulating as games come in);
// - "off": the window starts it and stops it when it closes, so it is awake whenever it runs;
// - "game": started at login, it waits, light (no database, no folder watching: a look at the
//   process list every few seconds), until Warcraft III runs or the window opens. Once the game
//   has closed and nothing has been left to do for a few minutes, it goes back to waiting.
// In every mode, while Warcraft III runs each game is imported as it ends but the simulations
// wait: they would slow the next match down. They run once the game has closed.
import type { CollectorMode } from "@replay-altar/core";

/** While waiting: how often the window's mark is looked at, and Warcraft III every few looks. */
export const WAIT_TICK_MS = 2_000;
export const WAIT_WARCRAFT_EVERY = 5;
/** How long a "game" collector stays awake after Warcraft III closed and the window too. */
export const AWAKE_AFTER_MS = 5 * 60_000;

export type Seen = { warcraft: boolean; window: boolean };

/** Does the collector have a reason to be awake? */
export const wanted = (mode: CollectorMode, seen: Seen) => mode !== "game" || seen.warcraft || seen.window;

/**
 * Hold simulations back while Warcraft III runs (the next match may be on), whatever the mode: a
 * simulation takes a CPU core and hundreds of MB for a minute or more.
 */
export const holdSimulations = (warcraft: boolean) => warcraft;

/**
 * Back to waiting: a "game" collector, nothing wanted it for AWAKE_AFTER_MS (the last replay is
 * written as the match ends, the W3Champions statistics are asked for 90 s later), and nothing
 * left to import or simulate.
 */
export const backToWaiting = (mode: CollectorMode, now: number, lastWanted: number, busy: boolean) => mode === "game" && !busy && now - lastWanted >= AWAKE_AFTER_MS;

export type Wake = "warcraft started" | "warcraft running" | "window";

/**
 * Waits, light, until there is a reason to be awake. `check` looks at the system (Warcraft III
 * only when asked, every WAIT_WARCRAFT_EVERY ticks: tasklist costs more than reading a file).
 * "warcraft started": the game appeared while we waited (so it may open the window); "warcraft
 * running": it already ran when we began.
 */
export async function waitForWake(check: (warcraftToo: boolean) => Seen, sleep: (ms: number) => Promise<unknown>): Promise<Wake> {
  for (let tick = 0; ; tick++) {
    const seen = check(tick % WAIT_WARCRAFT_EVERY === 0);
    if (seen.warcraft) return tick === 0 ? "warcraft running" : "warcraft started";
    if (seen.window) return "window";
    await sleep(WAIT_TICK_MS);
  }
}
