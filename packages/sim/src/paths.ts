import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const PROJECT_DIR = resolve(import.meta.dirname, "../../..");
export const WC3V_DIR = join(PROJECT_DIR, "vendor/wc3v");
export const DRIVER = join(PROJECT_DIR, "packages/sim/driver/wc3v-driver.cjs");

export const gamedataDir = (dataRoot: string) => join(dataRoot, "sim/gamedata/current");
export const simOutputPath = (dataRoot: string, gameKey: string) => join(dataRoot, "sim/out", `${gameKey}.wc3v.gz`);

export function wc3vCommit(): string {
  try {
    return execFileSync("git", ["-C", WC3V_DIR, "rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Why the simulation can't run yet, or null when it can. */
export function simNotReady(dataRoot: string): string | null {
  if (!existsSync(join(WC3V_DIR, "wc3v.js"))) return "WC3V is not checked out (run `w3stats setup-sim`)";
  if (!existsSync(join(WC3V_DIR, "node_modules/w3gjs"))) return "WC3V dependencies are not installed (run `w3stats setup-sim`)";
  if (!existsSync(join(WC3V_DIR, "helpers/UnitBalance.json"))) return "game data has not been extracted (run `w3stats setup-sim`)";
  if (!existsSync(join(gamedataDir(dataRoot), "manifest.json"))) return "game data manifest missing (run `w3stats setup-sim`)";
  return null;
}
