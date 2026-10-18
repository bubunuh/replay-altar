// install / suspend / resume / uninstall: everything this app puts outside its project folder.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { configPath, dataDir } from "@replay-altar/core";

const home = homedir();
const PROJECT = resolve(import.meta.dirname, "../../..");
const SERVICE = "replay-altar-collector.service";

export const INSTALLED = {
  cli: join(home, ".local/bin/replay-altar"),
  cliAlias: join(home, ".local/bin/altar"),
  desktopLauncher: join(home, ".local/bin/replay-altar-desktop"),
  service: join(home, ".config/systemd/user", SERVICE),
  menuEntry: join(home, ".local/share/applications/replay-altar.desktop"),
  desktopIcon: join(home, "Desktop/replay-altar.desktop"),
  icon: join(home, ".local/share/icons/hicolor/scalable/apps/replay-altar.svg"),
};

// REPLAY_ALTAR_NO_SYSTEMD=1 (tests): write files only, never touch the running user session.
const systemctl = (...args: string[]) => {
  if (process.env.REPLAY_ALTAR_NO_SYSTEMD) return console.log(`  (skipped) systemctl --user ${args.join(" ")}`);
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

/** What the app installed while it was called W3Stats (before 2026-10-18). */
const LEGACY = {
  service: "w3stats-collector.service",
  files: [".local/bin/w3stats", ".local/bin/w3stats-desktop", ".config/systemd/user/w3stats-collector.service", ".local/share/applications/w3stats.desktop", "Desktop/w3stats.desktop", ".local/share/icons/hicolor/scalable/apps/w3stats.svg"].map((f) => join(home, f)),
  dataDir: join(process.env.XDG_DATA_HOME ?? join(home, ".local/share"), "w3stats"),
  configDir: join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "w3stats"),
};

/** Files under `dir` (recursively) with one of these extensions, listed before any is touched. */
function filesUnder(dir: string, exts: string[]): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => exts.some((e) => name.endsWith(e)))
    .map((name) => join(dir, name))
    .filter((f) => statSync(f, { throwIfNoEntry: false })?.isFile());
}

/**
 * An install from when the app was called W3Stats: stop and remove its service and launchers,
 * then move its data and settings to the new folders. Records and databases store absolute
 * paths (archive copies, simulation output), so those are rewritten too.
 */
function migrateLegacy() {
  if (existsSync(join(home, ".config/systemd/user", LEGACY.service))) systemctl("disable", "--now", LEGACY.service);
  for (const f of LEGACY.files) {
    if (existsSync(f)) {
      rmSync(f);
      console.log(`  removed old ${f}`);
    }
  }
  const newData = dataDir();
  if (existsSync(LEGACY.dataDir) && !existsSync(newData)) {
    renameSync(LEGACY.dataDir, newData);
    for (const ext of ["", "-wal", "-shm"]) {
      if (existsSync(join(newData, `w3stats.sqlite${ext}`))) renameSync(join(newData, `w3stats.sqlite${ext}`), join(newData, `replay-altar.sqlite${ext}`));
    }
    console.log(`  moved ${LEGACY.dataDir} to ${newData}`);
  }
  // Also on a later run, in case an earlier one stopped half way: the rewrite is idempotent.
  if (existsSync(newData)) {
    const from = LEGACY.dataDir + "/";
    const to = newData + "/";
    for (const f of filesUnder(newData, [".sqlite"])) {
      const db = new DatabaseSync(f);
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]) {
        for (const col of ["archive_path", "path"]) {
          const has = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).some((c) => c.name === col);
          if (has) db.prepare(`UPDATE ${name} SET ${col} = replace(${col}, ?, ?) WHERE ${col} LIKE ?`).run(from, to, `${from}%`);
        }
      }
      db.close();
    }
    for (const f of filesUnder(newData, [".json"])) {
      const text = readFileSync(f, "utf8");
      if (text.includes(from)) writeFileSync(f, text.replaceAll(from, to));
    }
  }
  const newConfig = dirname(configPath());
  if (existsSync(LEGACY.configDir) && !existsSync(newConfig)) {
    renameSync(LEGACY.configDir, newConfig);
    console.log(`  moved ${LEGACY.configDir} to ${newConfig}`);
  }
}

export function install() {
  const node = findNode();
  console.log("Installing Replay Altar:");
  migrateLegacy();
  write(INSTALLED.cli, `#!/bin/sh\nexec "${node}" "${PROJECT}/apps/collector/src/cli.ts" "$@"\n`, 0o755);
  write(INSTALLED.cliAlias, `#!/bin/sh\nexec "${INSTALLED.cli}" "$@"\n`, 0o755);

  const desktopApp = join(PROJECT, "apps/desktop/bin/replay-altar-desktop");
  const hasDesktop = existsSync(desktopApp);
  if (hasDesktop && !existsSync(join(PROJECT, "apps/desktop/out/main.cjs"))) {
    console.log("  building the desktop app…");
    execFileSync(node, [join(PROJECT, "apps/desktop/build.ts")], { stdio: "inherit" });
  }
  if (hasDesktop) {
    write(INSTALLED.desktopLauncher, `#!/bin/sh\nexec "${desktopApp}" "$@"\n`, 0o755);
    mkdirSync(dirname(INSTALLED.icon), { recursive: true });
    copyFileSync(join(PROJECT, "apps/desktop/assets/replay-altar.svg"), INSTALLED.icon);
    console.log(`  wrote ${INSTALLED.icon}`);
    const entry = [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Replay Altar",
      "Comment=Warcraft III replay stats",
      `Exec=${INSTALLED.desktopLauncher}`,
      "Icon=replay-altar",
      "Categories=Game;",
      "StartupWMClass=replay-altar",
      "",
    ].join("\n");
    write(INSTALLED.menuEntry, entry, 0o755);
    write(INSTALLED.desktopIcon, entry, 0o755);
  }

  write(
    INSTALLED.service,
    [
      "[Unit]",
      "Description=Replay Altar replay collector (archives and analyzes Warcraft III replays)",
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
  console.log(`\nDone. Collector is running${hasDesktop ? "; Replay Altar is on your desktop and in the app menu" : " (desktop app not built yet)"}.`);
}

export function suspend() {
  systemctl("disable", "--now", SERVICE);
  console.log("Collector stopped and won't start at login. New replays are not archived until `replay-altar resume`.");
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
      execFileSync("podman", ["rmi", "-f", "localhost/replay-altar-casc:latest"], { stdio: "ignore" });
      console.log("  removed podman image localhost/replay-altar-casc");
    } catch {
      // podman missing or image never built
    }
  } else {
    console.log(`Kept your archive and stats in ${dataDir()} and settings in ${configPath()} (use --purge to delete them).`);
  }
  console.log(`The source code in ${PROJECT} was not touched; delete that folder to remove everything.`);
}
