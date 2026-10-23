// Builds the Linux AppImage (dist/ReplayAltar-<version>.AppImage):
//
//   node apps/desktop/package-linux.ts
//
// Self-contained like the Windows installer (stage.ts), with the Linux game-data extractor
// (scripts/casc/build-linux.sh), so it needs neither Node nor podman. On first start it sets up
// the collector as a systemd user service running through the AppImage file, the `replay-altar`
// command and a menu entry (apps/desktop/src/main.ts).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Arch, build, Platform } from "electron-builder";
import { app, desktop, res, root, stageApp } from "./stage.ts";

const casc = join(root, "scripts/casc/bin/casc-extract");
if (!existsSync(casc)) execFileSync(join(root, "scripts/casc/build-linux.sh"), { stdio: "inherit" });

await stageApp(casc, "linux");

await build({
  projectDir: app,
  targets: Platform.LINUX.createTarget("AppImage", Arch.x64),
  // Uploading is done by hand or by the release workflow; this only writes latest-linux.yml (read
  // by the Update button, which replaces the AppImage in place).
  publish: "never",
  config: {
    publish: [{ provider: "github", owner: "bubunuh", repo: "replay-altar" }],
    appId: "app.replayaltar",
    productName: "Replay Altar",
    executableName: "replay-altar",
    electronVersion: JSON.parse(readFileSync(join(root, "node_modules/electron/package.json"), "utf8")).version,
    directories: { output: join(root, "dist"), buildResources: join(desktop, "build-resources") },
    files: ["out/**/*", "assets/**/*", "package.json"],
    extraResources: [{ from: relative(app, res), to: ".", filter: ["**/*"] }],
    asar: true,
    npmRebuild: false,
    linux: {
      target: "AppImage",
      icon: join(desktop, "assets/icons"),
      category: "Game",
      synopsis: "Warcraft III replay coach",
      artifactName: "ReplayAltar-${version}.AppImage",
    },
  },
});
console.log(`AppImage in ${join(root, "dist")}`);
