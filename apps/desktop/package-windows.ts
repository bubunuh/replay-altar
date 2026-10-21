// Builds the Windows installer (dist/ReplayAltar-Setup-<version>.exe) on Linux:
//
//   node apps/desktop/package-windows.ts
//
// The installed app is self-contained: the window (out/), the collector bundled into one file
// that runs on the app's own executable as Node (resources/collector/collector.mjs), the WC3V
// simulation engine with its map library, the Windows game-data extractor
// (scripts/casc/build-windows.sh) and the shipped pro statistics (data/reference). Game data (unit tables, crests, portraits, font) is extracted on the tester's PC from
// their own install, never shipped.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as esbuild from "esbuild";
import { Arch, build, Platform } from "electron-builder";

const desktop = import.meta.dirname;
const root = join(desktop, "../..");
const stage = join(root, "dist/stage");
const res = join(stage, "resources");
const version = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")).version as string;

const casc = join(root, "scripts/casc/bin/casc-extract.exe");
if (!existsSync(casc)) execFileSync(join(root, "scripts/casc/build-windows.sh"), { stdio: "inherit" });

rmSync(stage, { recursive: true, force: true });
execFileSync(process.execPath, [join(desktop, "build.ts")], { stdio: "inherit" });

// The app: built window and its assets, with a package.json of its own (nothing to install).
const app = join(stage, "app");
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
  define: { "process.env.REPLAY_ALTAR_W3GJS_VERSION": JSON.stringify(JSON.parse(readFileSync(join(root, "node_modules/w3gjs/package.json"), "utf8")).version) },
  logLevel: "warning",
});

// WC3V (GPL-3.0): what the simulation reads at run time, without its site, docs and tests, and
// without unit tables extracted from this PC's game.
const wc3v = join(root, "vendor/wc3v");
const SKIP = new Set(["marketing", "docs", "tests", "debug", "desktop", "replays", ".git", ".github"]);
for (const e of readdirSync(wc3v, { withFileTypes: true })) {
  if (SKIP.has(e.name) || (e.isFile() && /\.(png|gif|webm|ya?ml)$/.test(e.name))) continue;
  cpSync(join(wc3v, e.name), join(res, "vendor/wc3v", e.name), { recursive: true, filter: (src) => !src.endsWith(join("helpers", "UnitBalance.json")) });
}
cpSync(join(root, "packages/sim/driver"), join(res, "packages/sim/driver"), { recursive: true });
cpSync(casc, join(res, "scripts/casc/bin/casc-extract.exe"));
cpSync(join(root, "data"), join(res, "data"), { recursive: true });
// GPL-3.0: the license travels with the program.
cpSync(join(root, "LICENSE"), join(res, "LICENSE.txt"));

await build({
  projectDir: app,
  targets: Platform.WINDOWS.createTarget("nsis", Arch.x64),
  // Uploading is done by hand or by the release workflow; this only writes latest.yml (the
  // release's checksum, read by the Update button) and the app's app-update.yml.
  publish: "never",
  config: {
    publish: [{ provider: "github", owner: "bubunuh", repo: "replay-altar" }],
    appId: "app.replayaltar",
    productName: "Replay Altar",
    executableName: "ReplayAltar",
    electronVersion: JSON.parse(readFileSync(join(root, "node_modules/electron/package.json"), "utf8")).version,
    directories: { output: join(root, "dist"), buildResources: join(desktop, "build-resources") },
    files: ["out/**/*", "assets/**/*", "package.json"],
    extraResources: [{ from: relative(app, res), to: ".", filter: ["**/*"] }],
    asar: true,
    npmRebuild: false,
    win: { target: "nsis", icon: join(desktop, "assets/replay-altar.ico"), signExecutable: false },
    nsis: {
      oneClick: true,
      perMachine: false,
      runAfterFinish: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: "Replay Altar",
      installerIcon: join(desktop, "assets/replay-altar.ico"),
      uninstallerIcon: join(desktop, "assets/replay-altar.ico"),
      include: join(desktop, "build-resources/installer.nsh"),
      artifactName: "ReplayAltar-Setup-${version}.exe",
      deleteAppDataOnUninstall: false,
    },
  },
});
mkdirSync(join(root, "dist"), { recursive: true });
console.log(`installer in ${join(root, "dist")}`);
