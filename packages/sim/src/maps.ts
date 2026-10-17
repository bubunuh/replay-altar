// Makes sure WC3V has map data for a replay's map, extracting it from the local Maps folder.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WC3V_DIR } from "./paths.ts";

/** WC3V's folder name for a map: "(2)EchoIsles_S2_v2.2.w3x" -> "EchoIsles_S2_v2.2". */
export function mapDataName(file: string) {
  return file
    .replace(/\.w3[xm]$/i, "")
    .replace(/^\(\d+\)/, "")
    .replace(/^\d+_w3c_\d+_\d+_/, "");
}

function findMapFile(warcraftDocuments: string[], file: string): string | null {
  const walk = (dir: string): string | null => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        const hit = walk(p);
        if (hit) return hit;
      } else if (e.name === file) return p;
    }
    return null;
  };
  for (const docs of warcraftDocuments) {
    const maps = join(docs, "Maps");
    if (existsSync(maps)) {
      const hit = walk(maps);
      if (hit) return hit;
    }
  }
  return null;
}

/** Returns null when ready, or the reason the map can't be prepared. */
export function ensureMapData(mapFile: string, warcraftDocuments: string[]): string | null {
  const name = mapDataName(mapFile);
  if (existsSync(join(WC3V_DIR, "mapdata", name))) return null;
  const source = findMapFile(warcraftDocuments, mapFile);
  if (!source) return `map file ${mapFile} not found under Documents/Warcraft III/Maps`;
  const tmp = mkdtempSync(join(tmpdir(), "w3stats-map-"));
  try {
    copyFileSync(source, join(tmp, mapFile));
    mkdirSync(join(WC3V_DIR, "mapdata"), { recursive: true });
    mkdirSync(join(WC3V_DIR, "client/maps"), { recursive: true });
    const prefix = /^\d+_w3c_/.test(mapFile) ? [] : ["--prefix="];
    execFileSync(process.execPath, [join(WC3V_DIR, "tools/data-tool.js"), `--source=${tmp}`, ...prefix], {
      cwd: WC3V_DIR,
      stdio: "ignore",
      timeout: 120_000,
    });
  } catch (e) {
    return `map extraction failed: ${(e as Error).message}`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return existsSync(join(WC3V_DIR, "mapdata", name)) ? null : `map extraction produced no data for ${name}`;
}
