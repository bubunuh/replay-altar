// Where Replay Altar's own files are (vendor/wc3v, the simulation driver, the game-data
// extractor, the shipped data/ with the pro statistics): the project checkout when run from source, the install's
// resources folder when installed. REPLAY_ALTAR_ROOT overrides it.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

let cached: string | null = null;

export function projectRoot(): string {
  if (process.env.REPLAY_ALTAR_ROOT) return process.env.REPLAY_ALTAR_ROOT;
  if (cached) return cached;
  // From source: packages/<pkg>/src or apps/<app>/out (bundles). Installed: resources/app.asar/out
  // (the window) or resources/collector (the collector), with vendor/ next to them.
  const here = import.meta.dirname;
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  const candidates = [resolve(here, "../../.."), resolve(here, ".."), ...(here.includes("app.asar") ? [resolve(here.slice(0, here.indexOf("app.asar")))] : []), ...(resources ? [resources] : [])];
  cached = candidates.find((d) => existsSync(join(d, "vendor/wc3v"))) ?? candidates[0];
  return cached;
}

/** True in an installed copy (no project checkout around it). */
export const isInstalled = () => existsSync(join(projectRoot(), "collector/collector.mjs"));
