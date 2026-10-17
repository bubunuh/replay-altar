// install / suspend / resume / uninstall: everything this app puts outside its project folder.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { configPath, dataDir } from "@w3stats/core";

const home = homedir();
const PROJECT = resolve(import.meta.dirname, "../../..");
const SERVICE = "w3stats-collector.service";

export const INSTALLED = {
  cli: join(home, ".local/bin/w3stats"),
  desktopLauncher: join(home, ".local/bin/w3stats-desktop"),
  service: join(home, ".config/systemd/user", SERVICE),
  menuEntry: join(home, ".local/share/applications/w3stats.desktop"),
  desktopIcon: join(home, "Desktop/w3stats.desktop"),
  icon: join(home, ".local/share/icons/hicolor/scalable/apps/w3stats.svg"),
};

// W3STATS_NO_SYSTEMD=1 (tests): write files only, never touch the running user session.
const systemctl = (...args: string[]) => {
  if (process.env.W3STATS_NO_SYSTEMD) return console.log(`  (skipped) systemctl --user ${args.join(" ")}`);
  try {
    execFileSync("systemctl", ["--user", ...args], { stdio: "inherit" });
  } catch {
    // e.g. stopping a unit that is not loaded
  }
};

function write(path: string, content: string, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, mode);
  console.log(`  wrote ${path}`);
}

/** First `node` on PATH, unresolved: Homebrew's bin/node survives upgrades, the Cellar path it links to doesn't. */
function findNode(): string {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const candidate = join(dir, "node");
    if (dir && existsSync(candidate)) return candidate;
  }
  return process.execPath;
}

export function install() {
  const node = findNode();
  console.log("Installing W3Stats:");
  write(INSTALLED.cli, `#!/bin/sh\nexec "${node}" "${PROJECT}/apps/collector/src/cli.ts" "$@"\n`, 0o755);

  const desktopApp = join(PROJECT, "apps/desktop/bin/w3stats-desktop");
  const hasDesktop = existsSync(desktopApp);
  if (hasDesktop && !existsSync(join(PROJECT, "apps/desktop/out/main.cjs"))) {
    console.log("  building the desktop app…");
    execFileSync(node, [join(PROJECT, "apps/desktop/build.ts")], { stdio: "inherit" });
  }
  if (hasDesktop) {
    write(INSTALLED.desktopLauncher, `#!/bin/sh\nexec "${desktopApp}" "$@"\n`, 0o755);
    mkdirSync(dirname(INSTALLED.icon), { recursive: true });
    copyFileSync(join(PROJECT, "apps/desktop/assets/w3stats.svg"), INSTALLED.icon);
    console.log(`  wrote ${INSTALLED.icon}`);
    const entry = [
      "[Desktop Entry]",
      "Type=Application",
      "Name=W3Stats",
      "Comment=Warcraft III replay stats",
      `Exec=${INSTALLED.desktopLauncher}`,
      "Icon=w3stats",
      "Categories=Game;",
      "StartupWMClass=w3stats",
      "",
    ].join("\n");
    write(INSTALLED.menuEntry, entry, 0o755);
    write(INSTALLED.desktopIcon, entry, 0o755);
  }

  write(
    INSTALLED.service,
    [
      "[Unit]",
      "Description=W3Stats replay collector (archives and analyzes Warcraft III replays)",
      "After=graphical-session.target",
      "",
      "[Service]",
      `ExecStart="${node}" "${PROJECT}/apps/collector/src/cli.ts" collector`,
      "Restart=on-failure",
      "RestartSec=10",
      "Nice=10",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n"),
  );
  systemctl("daemon-reload");
  systemctl("enable", "--now", SERVICE);
  console.log(`\nDone. Collector is running${hasDesktop ? "; W3Stats is on your desktop and in the app menu" : " (desktop app not built yet)"}.`);
}

export function suspend() {
  systemctl("disable", "--now", SERVICE);
  console.log("Collector stopped and won't start at login. New replays are not archived until `w3stats resume`.");
}

export function resume() {
  systemctl("enable", "--now", SERVICE);
  console.log("Collector running again; it will pick up replays played while suspended (except overwritten LastReplay.w3g).");
}

export function uninstall(purge: boolean) {
  systemctl("disable", "--now", SERVICE);
  for (const f of Object.values(INSTALLED)) {
    if (existsSync(f)) {
      rmSync(f);
      console.log(`  removed ${f}`);
    }
  }
  systemctl("daemon-reload");
  if (purge) {
    for (const d of [dataDir(), dirname(configPath())]) {
      rmSync(d, { recursive: true, force: true });
      console.log(`  removed ${d}`);
    }
    // The game-data extractor's container image (scripts/casc), if it was ever built.
    try {
      execFileSync("podman", ["rmi", "-f", "localhost/w3stats-casc:latest"], { stdio: "ignore" });
      console.log("  removed podman image localhost/w3stats-casc");
    } catch {
      // podman missing or image never built
    }
  } else {
    console.log(`Kept your archive and stats in ${dataDir()} and settings in ${configPath()} (use --purge to delete them).`);
  }
  console.log(`The source code in ${PROJECT} was not touched; delete that folder to remove everything.`);
}
