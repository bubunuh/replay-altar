// install / suspend / resume / uninstall: everything this app puts outside its project folder.
// Linux: launchers in ~/.local/bin, menu and desktop entries, a systemd user service. Windows:
// command shims in the data folder's bin, Start menu and desktop shortcuts, and the collector
// started at login from the Run key (packages/core/src/service.ts).
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectorFiles, collectorMode, configPath, dataDir, disableCollector, linuxUnit, loadConfig, projectRoot, SERVICE, startCollector, windowsLauncher } from "@replay-altar/core";

const home = homedir();
const windows = process.platform === "win32";
export const PROJECT = projectRoot();
const CLI = join(PROJECT, "apps/collector/src/cli.ts");

export const INSTALLED = {
  cli: join(home, ".local/bin/replay-altar"),
  cliAlias: join(home, ".local/bin/altar"),
  desktopLauncher: join(home, ".local/bin/replay-altar-desktop"),
  service: join(home, ".config/systemd/user", SERVICE),
  menuEntry: join(home, ".local/share/applications/replay-altar.desktop"),
  desktopIcon: join(home, "Desktop/replay-altar.desktop"),
  icon: join(home, ".local/share/icons/hicolor/scalable/apps/replay-altar.svg"),
};

/** What install writes on Windows (the Start menu and desktop shortcuts are found by PowerShell). */
const WINDOWS = {
  cli: () => join(dataDir(), "bin/replay-altar.cmd"),
  cliAlias: () => join(dataDir(), "bin/altar.cmd"),
};
/** The desktop app in this checkout, as Windows starts it: Electron with the app folder. */
export const windowsDesktop = () => ({ exe: join(PROJECT, "node_modules/electron/dist/electron.exe"), args: [join(PROJECT, "apps/desktop")] });
const SHORTCUT = "Replay Altar.lnk";

/** Settings → Behaviour: the collector starts at login unless it should run only with the window ("off"). */
const atLogin = () => collectorMode(loadConfig()) !== "off";

const runningNote = (login: boolean) =>
  login
    ? `Collector is running and starts at login${collectorMode(loadConfig()) === "game" ? " (it only wakes up while Warcraft III or Replay Altar's window is open)" : ""}`
    : "Collector is running; it doesn't start at login and closing Replay Altar's window stops it (Settings → Behaviour changes that)";

function write(path: string, content: string, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, mode);
  console.log(`  wrote ${path}`);
}

/** First `node` on PATH, unresolved: Homebrew's bin/node survives upgrades, the Cellar path it links to doesn't. */
export function findNode(): string {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(dir, windows ? "node.exe" : "node");
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
  if (existsSync(join(home, ".config/systemd/user", LEGACY.service))) {
    try {
      execFileSync("systemctl", ["--user", "disable", "--now", LEGACY.service], { stdio: "inherit" });
    } catch {
      // already stopped
    }
  }
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

function ensureDesktopBuilt(node: string) {
  if (existsSync(join(PROJECT, "apps/desktop/out/main.cjs"))) return;
  console.log("  building the desktop app…");
  execFileSync(node, [join(PROJECT, "apps/desktop/build.ts")], { stdio: "inherit" });
}

/** Creates (or with `remove`, deletes) the Start menu and desktop shortcuts, through PowerShell's WScript.Shell. */
function windowsShortcuts(remove = false) {
  if (process.env.REPLAY_ALTAR_NO_SYSTEMD) return console.log(`  (skipped) ${remove ? "remove" : "create"} shortcuts`);
  const app = windowsDesktop();
  const script = [
    "$sh = New-Object -ComObject WScript.Shell",
    "foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {",
    "  $lnk = Join-Path $dir $env:RA_NAME",
    remove
      ? "  if (Test-Path $lnk) { Remove-Item $lnk; Write-Output \"  removed $lnk\" }"
      : "  $s = $sh.CreateShortcut($lnk); $s.TargetPath = $env:RA_EXE; $s.Arguments = $env:RA_ARGS; $s.Description = 'Warcraft III replay stats'; $s.IconLocation = $env:RA_ICON; $s.Save(); Write-Output \"  wrote $lnk\"",
    "}",
  ].join("\n");
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, RA_NAME: SHORTCUT, RA_EXE: app.exe, RA_ARGS: app.args.map((a) => `"${a}"`).join(" "), RA_ICON: join(PROJECT, "apps/desktop/assets/replay-altar.ico") },
  });
  process.stdout.write(out);
}

function installWindows(node: string) {
  write(WINDOWS.cli(), `@"${node}" "${CLI}" %*\r\n`);
  write(WINDOWS.cliAlias(), `@call "${WINDOWS.cli()}" %*\r\n`);
  if (existsSync(join(PROJECT, "apps/desktop"))) {
    ensureDesktopBuilt(node);
    windowsShortcuts();
  }
  mkdirSync(dirname(collectorFiles().log), { recursive: true });
  write(collectorFiles().launcher, windowsLauncher([node, CLI, "collector"]));
  const login = atLogin();
  startCollector(login);
  console.log(`\nDone. ${runningNote(login)}; Replay Altar is in the Start menu and on your desktop.`);
  console.log(`For the command line, add ${dirname(WINDOWS.cli())} to your PATH (or run ${WINDOWS.cli()}).`);
}

export function install() {
  const node = findNode();
  console.log("Installing Replay Altar:");
  if (windows) return installWindows(node);
  migrateLegacy();
  write(INSTALLED.cli, `#!/bin/sh\nexec "${node}" "${PROJECT}/apps/collector/src/cli.ts" "$@"\n`, 0o755);
  write(INSTALLED.cliAlias, `#!/bin/sh\nexec "${INSTALLED.cli}" "$@"\n`, 0o755);

  const desktopApp = join(PROJECT, "apps/desktop/bin/replay-altar-desktop");
  const hasDesktop = existsSync(desktopApp);
  if (hasDesktop) ensureDesktopBuilt(node);
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

  write(INSTALLED.service, linuxUnit([node, `${PROJECT}/apps/collector/src/cli.ts`, "collector"]));
  const login = atLogin();
  startCollector(login);
  console.log(`\nDone. ${runningNote(login)}${hasDesktop ? "; Replay Altar is on your desktop and in the app menu" : " (desktop app not built yet)"}.`);
}

export function suspend() {
  disableCollector();
  console.log("Collector stopped and won't start at login. New replays are not archived until `replay-altar resume`.");
}

export function resume() {
  const login = atLogin();
  startCollector(login);
  console.log(`${login ? "Collector running again and at login" : "Collector running again (not at login: Settings → Behaviour says only with the window)"}; it will pick up replays played while suspended (except overwritten LastReplay.w3g).`);
}

export function uninstall(purge: boolean) {
  disableCollector();
  const files = windows ? [WINDOWS.cli(), WINDOWS.cliAlias(), collectorFiles().launcher] : Object.values(INSTALLED);
  for (const f of files) {
    if (existsSync(f)) {
      rmSync(f);
      console.log(`  removed ${f}`);
    }
  }
  if (windows) windowsShortcuts(true);
  else if (!process.env.REPLAY_ALTAR_NO_SYSTEMD) execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
  if (purge) {
    for (const d of [dataDir(), dirname(configPath())]) {
      rmSync(d, { recursive: true, force: true });
      console.log(`  removed ${d}`);
    }
    // The game-data extractor's container image (scripts/casc, Linux), if it was ever built.
    if (!windows) {
      try {
        execFileSync("podman", ["rmi", "-f", "localhost/replay-altar-casc:latest"], { stdio: "ignore" });
        console.log("  removed podman image localhost/replay-altar-casc");
      } catch {
        // podman missing or image never built
      }
    }
  } else {
    console.log(`Kept your archive and stats in ${dataDir()} and settings in ${configPath()} (use --purge to delete them).`);
  }
  console.log(`The source code in ${PROJECT} was not touched; delete that folder to remove everything.`);
}
