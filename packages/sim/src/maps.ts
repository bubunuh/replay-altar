// Makes sure WC3V has map data for a replay's map, extracting it from the local Maps folder
// (or extra folders, e.g. maps Replay Altar downloaded for tournament games).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { WC3V_DIR } from "./paths.ts";

/**
 * WC3V's folder name for a map, as its data-tool names it (normalizeW3xFilename there):
 * "(2)EchoIsles_S2_v2.2.w3x" -> "EchoIsles_S2_v2.2", "59_w3c_251104_0950_X_v2.4" -> "X_v2.4",
 * "w3c_260816_0950_FairyTale_v1.3.1" -> "260816_0950_FairyTale_v1.3.1".
 */
export function mapDataName(file: string) {
  const sanitize = (n: string) => n.replace(/\s+/g, "").replace(/[^A-Za-z0-9_\-.']/g, "").trim();
  const name = basename(file).replace(/\.w3[xm]$/i, "").replace(/^\(\d+\)/, "");
  const match = name.match(/^1v1_(.+?)_w3c_\d+_\d+_\d+$/) ?? name.match(/^\d+_w3c_\d+_\d+_(.+)$/) ?? name.match(/^w3c_s\d+(?:\.\d+)?_(.+)$/);
  if (match) return sanitize(match[1]);
  return sanitize(name.startsWith("w3c_") ? name.slice(4) : name);
}

function findMapFile(warcraftDocuments: string[], file: string, extraDirs: string[] = []): string | null {
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
  for (const maps of [...warcraftDocuments.map((d) => join(d, "Maps")), ...extraDirs]) {
    if (existsSync(maps)) {
      const hit = walk(maps);
      if (hit) return hit;
    }
  }
  return null;
}

/** Returns null when ready, or the reason the map can't be prepared. */
export function ensureMapData(mapFile: string, warcraftDocuments: string[], extraDirs: string[] = []): string | null {
  const name = mapDataName(mapFile);
  if (existsSync(join(WC3V_DIR, "mapdata", name))) return null;
  const source = findMapFile(warcraftDocuments, mapFile, extraDirs);
  if (!source) return `map file ${mapFile} not found under Documents/Warcraft III/Maps`;
  const tmp = mkdtempSync(join(tmpdir(), "replay-altar-map-"));
  try {
    // The data-tool only reads .w3x; a .w3m (classic-format map) is the same kind of archive.
    copyFileSync(source, join(tmp, mapFile.replace(/\.w3m$/i, ".w3x")));
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
