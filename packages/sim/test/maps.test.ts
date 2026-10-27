// The map cache in the data folder: extracted maps survive an update that replaces WC3V's folder.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

// A pretend install: WC3V's folder with one extracted map and the two shared files.
const install = mkdtempSync(join(tmpdir(), "replay-altar-install-"));
const wc3v = join(install, "vendor/wc3v");
const data = mkdtempSync(join(tmpdir(), "replay-altar-data-"));
process.env.REPLAY_ALTAR_ROOT = install;

const write = (file: string, body: string) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, body);
};
write(join(wc3v, "mapdata/EchoIsles_S2_v2.2/war3map.wpm"), "pathing");
write(join(wc3v, "client/maps/EchoIsles_S2_v2.2/map.jpg"), "picture");
write(join(wc3v, "helpers/mapConfiguration.json"), JSON.stringify({ version: 1, maps: { "EchoIsles_S2_v2.2.w3x": { info: { name: "EchoIsles" } } } }));
write(join(wc3v, "client/js/gameData.json"), JSON.stringify({ maps: { "EchoIsles_S2_v2.2.w3x": { name: "EchoIsles" } } }));

const { syncMapCache, ensureMapData, mapClientDir } = await import("../src/maps.ts");

describe("extracted maps are kept in the data folder", () => {
  afterAll(() => {
    rmSync(install, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  });

  test("a map WC3V already has is copied to the data folder", () => {
    expect(syncMapCache(data)).toEqual({ restored: 0, saved: 1, repaired: 0 });
    expect(readFileSync(join(data, "sim/maps/EchoIsles_S2_v2.2/mapdata/war3map.wpm"), "utf8")).toBe("pathing");
    expect(existsSync(join(data, "sim/maps/EchoIsles_S2_v2.2/client/map.jpg"))).toBe(true);
    expect(syncMapCache(data)).toEqual({ restored: 0, saved: 0, repaired: 0 });
  });

  test("after an update wipes WC3V's copy, the map and its shared entries come back", () => {
    rmSync(join(wc3v, "mapdata"), { recursive: true });
    rmSync(join(wc3v, "client/maps"), { recursive: true });
    write(join(wc3v, "helpers/mapConfiguration.json"), JSON.stringify({ version: 1, maps: {} }));
    write(join(wc3v, "client/js/gameData.json"), JSON.stringify({ maps: {} }));
    expect(mapClientDir(data, "(2)EchoIsles_S2_v2.2.w3x")).toBe(join(data, "sim/maps/EchoIsles_S2_v2.2/client"));

    expect(syncMapCache(data)).toEqual({ restored: 1, saved: 0, repaired: 0 });
    expect(readFileSync(join(wc3v, "mapdata/EchoIsles_S2_v2.2/war3map.wpm"), "utf8")).toBe("pathing");
    expect(JSON.parse(readFileSync(join(wc3v, "helpers/mapConfiguration.json"), "utf8")).maps["EchoIsles_S2_v2.2.w3x"]).toEqual({ info: { name: "EchoIsles" } });
    expect(JSON.parse(readFileSync(join(wc3v, "client/js/gameData.json"), "utf8")).maps["EchoIsles_S2_v2.2.w3x"]).toEqual({ name: "EchoIsles" });
    expect(readFileSync(join(wc3v, "client/js/gameData.js"), "utf8")).toContain("window.gameData = gameData");
    expect(mapClientDir(data, "(2)EchoIsles_S2_v2.2.w3x")).toBe(join(wc3v, "client/maps/EchoIsles_S2_v2.2"));
  });

  test("a simulation needing a map WC3V lost takes it from the data folder", () => {
    rmSync(join(wc3v, "mapdata"), { recursive: true });
    expect(ensureMapData("(2)EchoIsles_S2_v2.2.w3x", [], data)).toBeNull();
    expect(existsSync(join(wc3v, "mapdata/EchoIsles_S2_v2.2/war3map.wpm"))).toBe(true);
  });

  test("a map nobody has extracted and that isn't in the map folders says where to add it", () => {
    expect(ensureMapData("(2)Nowhere.w3x", [join(data, "no-such-folder")], data)).toMatch(/not found in your map folders or the game/);
  });
});
