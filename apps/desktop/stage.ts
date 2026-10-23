// The app staged for packaging (dist/stage), the same for the Windows installer and the Linux
// AppImage: the window (out/), the collector bundled into one file that runs on the app's own
// executable as Node (resources/collector/collector.mjs), the WC3V simulation engine with its map
// library, the game-data extractor for that system and the shipped data (data/: pro statistics,
// build orders, the win-chance model). Game data (unit tables, crests, portraits, font) is
// extracted on the player's computer from their own install, never shipped. Research scripts,
// docs and experiment data are not part of it.
import { execFileSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import * as esbuild from "esbuild";

export const desktop = import.meta.dirname;
export const root = join(desktop, "../..");
export const stage = join(root, "dist/stage");
export const app = join(stage, "app");
export const res = join(stage, "resources");
export const version = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")).version as string;

/** Stages everything for `platform`; `extractor` is that system's built casc-extract (scripts/casc/bin). */
export async function stageApp(extractor: string, platform: "win32" | "linux") {
  rmSync(stage, { recursive: true, force: true });
  // Replay Altar's fixes to WC3V (patches/wc3v), so this build simulates like every other copy.
  execFileSync(process.execPath, [join(root, "scripts/patch-wc3v.ts")], { stdio: "inherit" });
  execFileSync(process.execPath, [join(desktop, "build.ts")], { stdio: "inherit" });

  // The app: built window and its assets, with a package.json of its own (nothing to install).
  cpSync(join(desktop, "out"), join(app, "out"), { recursive: true });
  cpSync(join(desktop, "assets"), join(app, "assets"), { recursive: true });
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "replay-altar", productName: "Replay Altar", version, description: "Warcraft III replay coach", author: "Replay Altar", main: "out/main.cjs" }, null, 2));

  // The collector as one ES module; CommonJS dependencies get a require of their own.
  await esbuild.build({
    entryPoints: [join(root, "apps/collector/src/cli.ts")],
    outfile: join(res, "collector/collector.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
    define: {
      "process.env.REPLAY_ALTAR_W3GJS_VERSION": JSON.stringify(JSON.parse(readFileSync(join(root, "node_modules/w3gjs/package.json"), "utf8")).version),
      "process.env.REPLAY_ALTAR_VERSION": JSON.stringify(version),
    },
    logLevel: "warning",
  });

  // WC3V (GPL-3.0): what the simulation reads at run time, without its site, docs and tests, and
  // as published: never the unit tables or map data this PC made from its own game and maps (each
  // install makes them from its own, the first time a game on that map is simulated). The same
  // on this PC and on GitHub's build machines.
  const wc3v = join(root, "vendor/wc3v");
  const SKIP = new Set(["marketing", "docs", "tests", "debug", "desktop", "replays", "mapdata", ".git", ".github"]);
  const LOCAL = [join("helpers", "UnitBalance.json"), join("client", "maps")];
  for (const e of readdirSync(wc3v, { withFileTypes: true })) {
    if (SKIP.has(e.name) || (e.isFile() && /\.(png|gif|webm|ya?ml)$/.test(e.name))) continue;
    cpSync(join(wc3v, e.name), join(res, "vendor/wc3v", e.name), { recursive: true, filter: (src) => !LOCAL.some((l) => src.endsWith(l)) });
  }
  // Files the map extraction adds this PC's maps to: shipped as they are in WC3V's repository.
  for (const f of ["client/js/gameData.js", "client/js/gameData.json", "helpers/mapConfiguration.json"]) {
    writeFileSync(join(res, "vendor/wc3v", f), execFileSync("git", ["-C", wc3v, "show", `HEAD:${f}`], { maxBuffer: 64 * 1024 * 1024 }));
  }
  // canvas (WC3V's map pictures) is native code, and the copy npm installed is for this PC's
  // system: a Windows build gets canvas's own Windows prebuild instead (Node-API, so it loads in
  // any Node or Electron). Without it every map extraction, and so every simulation, fails.
  if (platform !== process.platform) {
    const canvas = join(res, "vendor/wc3v/node_modules/canvas");
    rmSync(join(canvas, "build"), { recursive: true, force: true });
    execFileSync(process.execPath, [join(wc3v, "node_modules/prebuild-install/bin.js"), "--runtime", "napi", "--platform", platform, "--arch", "x64"], { cwd: canvas, stdio: "inherit" });
  }
  cpSync(join(root, "packages/sim/driver"), join(res, "packages/sim/driver"), { recursive: true });
  cpSync(extractor, join(res, "scripts/casc/bin", basename(extractor)));
  cpSync(join(root, "data"), join(res, "data"), { recursive: true });
  // GPL-3.0: the license travels with the program.
  cpSync(join(root, "LICENSE"), join(res, "LICENSE.txt"));
}
