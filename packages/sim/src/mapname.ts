// WC3V's folder name for a map: kept apart from maps.ts (no import.meta paths), so the desktop main process can bundle it.
import { basename } from "node:path";

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
