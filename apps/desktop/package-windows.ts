// Builds the Windows installer (dist/ReplayAltar-Setup-<version>.exe) on Linux:
//
//   node apps/desktop/package-windows.ts
//
// The installed app is self-contained (stage.ts), with the Windows game-data extractor
// (scripts/casc/build-windows.sh).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Arch, build, Platform } from "electron-builder";
import { app, desktop, res, root, stageApp } from "./stage.ts";

const casc = join(root, "scripts/casc/bin/casc-extract.exe");
if (!existsSync(casc)) execFileSync(join(root, "scripts/casc/build-windows.sh"), { stdio: "inherit" });

await stageApp(casc, "win32");

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
      // What the app does on your computer (privacy, what runs in the background), shown before installing
      // and skipped on updates.
      license: join(desktop, "build-resources/installer-notice.txt"),
      artifactName: "ReplayAltar-Setup-${version}.exe",
      deleteAppDataOnUninstall: false,
    },
  },
});
mkdirSync(join(root, "dist"), { recursive: true });
console.log(`installer in ${join(root, "dist")}`);
