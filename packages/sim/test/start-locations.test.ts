// Map entries an older WC3V misread (start locations at (null, null), a spot named "_ENV") are
// repaired from the map's extracted script; entries that were right are left alone.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

// A pretend install: WC3V's folder with three extracted maps, the shared files and the driver.
const install = mkdtempSync(join(tmpdir(), "replay-altar-install-"));
const wc3v = join(install, "vendor/wc3v");
const data = mkdtempSync(join(tmpdir(), "replay-altar-data-"));
process.env.REPLAY_ALTAR_ROOT = install;

const write = (file: string, body: string) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, body);
};
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
mkdirSync(join(install, "packages/sim/driver"), { recursive: true });
copyFileSync(join(import.meta.dirname, "../driver/start-locations.cjs"), join(install, "packages/sim/driver/start-locations.cjs"));
// WC3V's parser as fixed (lib/parsers/LUAJASSFile.js reads each call on its own); a stand-in,
// so this test doesn't depend on the patches being applied to the checkout.
write(
  join(wc3v, "lib/parsers/LUAJASSFile.js"),
  `module.exports = class {
    constructor (file) {
      const script = require("fs").readFileSync(file, "utf8");
      this.startingPositions = {};
      for (const m of script.matchAll(/DefineStartLocation\\(\\s*(\\d+)\\s*,\\s*([-+]?\\s*[\\d.]+)\\s*,\\s*([-+]?\\s*[\\d.]+)\\s*\\)/g))
        this.startingPositions[m[1]] = { x: parseFloat(m[2].replace(/\\s+/g, "")), y: parseFloat(m[3].replace(/\\s+/g, "")) };
    }
  };\n`,
);

const info = (name: string) => ({ bounds: { map: [[-6144, 6144], [6144, -6144]] }, name });
// A hosted copy of a ladder map: minified Lua, read by the old parser as one spot "_ENV".
const hashed = "cd7e4245eccab34c0cc46c9e32ccc049";
const misread = { info: info(hashed), startingPositions: { _ENV: { x: null, y: 1 } } };
write(join(wc3v, "mapdata", hashed, "war3map.lua"), "function config()SetPlayers(2)DefineStartLocation(0,-3328.0,3072.0)DefineStartLocation(1,3392.0,-3584.0)end");
// An optimised JASS map ("- 1280.0"): the spot is there, its x was NaN (null in the JSON).
const atr = { info: info("ShallowGraveATR"), startingPositions: { "0": { x: null, y: 256 }, "1": { x: 1280, y: -256 } } };
write(join(wc3v, "mapdata/ShallowGraveATR/war3map.j"), "call DefineStartLocation(0, - 1280.0, 256.0)\ncall DefineStartLocation(1, 1280.0, - 256.0)\n");
// A map read right: never touched, even though its script says otherwise.
const good = { info: info("EchoIsles"), startingPositions: { "0": { x: 3328, y: 3072 }, " 1": { x: -3392, y: -3584 } } };
write(join(wc3v, "mapdata/EchoIsles/war3map.j"), "call DefineStartLocation(0, 1.0, 2.0)\n");
// A misread map whose script is gone: extracted again when a game needs it.
const noScript = { info: info("Scriptless"), startingPositions: { _ENV: { x: null, y: null } } };
write(join(wc3v, "mapdata/Scriptless/war3map.wpm"), "pathing");

const registry = { [`${hashed}.w3x`]: misread, "ShallowGrave ATR.w3x": atr, "w3c_EchoIsles.w3x": good, "Scriptless.w3x": noScript };
write(join(wc3v, "helpers/mapConfiguration.json"), JSON.stringify({ version: 1, maps: registry }));
write(join(wc3v, "client/js/gameData.json"), JSON.stringify({ maps: {} }));
const CONFIG = join(wc3v, "helpers/mapConfiguration.json");
const ENTRIES = join(data, "sim/maps/entries.json");

const { syncMapCache, ensureMapData, misreadStarts } = await import("../src/maps.ts");
const { CONSTANTS, summarize } = await import("../src/index.ts");

describe("map entries with misread start locations", () => {
  afterAll(() => {
    rmSync(install, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  });

  test("misread entries are told from right ones", () => {
    expect([misread, atr, noScript].map(misreadStarts)).toEqual([true, true, true]);
    expect(misreadStarts(good)).toBe(false);
  });

  test("at start, a misread entry is read again from its script, in WC3V's registry and the saved entries; a right one is untouched", () => {
    expect(syncMapCache(data)).toEqual({ restored: 0, saved: 3, repaired: 2 });
    for (const maps of [readJson(CONFIG).maps, readJson(ENTRIES).mapConfiguration]) {
      expect(maps[`${hashed}.w3x`]).toEqual({ info: info(hashed), startingPositions: { "0": { x: -3328, y: 3072 }, "1": { x: 3392, y: -3584 } } });
      expect(maps["ShallowGrave ATR.w3x"]).toEqual({ info: info("ShallowGraveATR"), startingPositions: { "0": { x: -1280, y: 256 }, "1": { x: 1280, y: -256 } } });
      expect(maps["w3c_EchoIsles.w3x"]).toEqual(good);
      // Dropped with its extracted data: the next game on it extracts it again.
      expect(maps["Scriptless.w3x"]).toBeUndefined();
    }
    expect(existsSync(join(wc3v, "mapdata/Scriptless"))).toBe(false);
    expect(ensureMapData("Scriptless.w3x", [join(data, "no-such-folder")], data)).toMatch(/not found in your map folders/);
  });

  test("nothing misread: nothing is written", () => {
    const before = [statSync(CONFIG).mtimeMs, statSync(ENTRIES).mtimeMs];
    expect(syncMapCache(data)).toEqual({ restored: 0, saved: 0, repaired: 0 });
    expect([statSync(CONFIG).mtimeMs, statSync(ENTRIES).mtimeMs]).toEqual(before);
  });

  test("an entry restored later, after an update, comes back repaired", () => {
    // An update: WC3V's folder as shipped, and saved entries made by the older version.
    rmSync(join(wc3v, "mapdata"), { recursive: true });
    write(CONFIG, JSON.stringify({ version: 1, maps: {} }));
    const saved = readJson(ENTRIES);
    saved.mapConfiguration[`${hashed}.w3x`] = misread;
    write(ENTRIES, JSON.stringify(saved));
    // A simulation needing the map before the collector's start (the command line, say).
    expect(ensureMapData(`Maps/dz/versus_reforged/${hashed}.w3x`, [], data)).toBeNull();
    expect(readJson(CONFIG).maps[`${hashed}.w3x`].startingPositions).toEqual({ "0": { x: -3328, y: 3072 }, "1": { x: 3392, y: -3584 } });
    expect(readJson(ENTRIES).mapConfiguration[`${hashed}.w3x`].startingPositions).toEqual({ "0": { x: -3328, y: 3072 }, "1": { x: 3392, y: -3584 } });
    expect(readJson(CONFIG).maps["w3c_EchoIsles.w3x"]).toEqual(good);
  });

  test("a map whose start positions still can't be read says so, as a map problem", () => {
    const cut = (cause: string) => ({ validation: { warnings: [{ type: "PARSE_TRUNCATED", missingMs: 725_070, lastActionGameTimeMs: 1155, details: `Action stream ends at 0:01 of 12:06 (12:05 missing). Every stat is computed over a partial game. Cause: ${cause}` }] } });
    const reason = (cause: string) => {
      const s = summarize({} as never, cut(cause) as never, {} as never, CONSTANTS, { ranAt: "", runMs: 0, outputPath: "" });
      return s.status === "failed" ? s.reason : null;
    };
    expect(reason(`map has no usable start positions: ${hashed}.w3x`)).toBe("map start positions couldn't be read from this map's script, so the simulation stopped at 0:01");
    expect(reason("Cannot read properties of null (reading 'toFixed')")).toBe("the simulation could read the replay only up to 0:01 (WC3V parse truncated)");
  });
});
