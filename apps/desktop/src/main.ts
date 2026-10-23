// Electron main process: one window, read-mostly access to the Replay Altar database.
import { freshCopy, pruneOldCopies } from "./appimage.ts";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir, release as osRelease, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from "electron";
import { loadRefGroups, rulesBook } from "@replay-altar/rules";
import { mapDataName } from "@replay-altar/sim/mapname";
import { mapMarkers } from "./mapOverlay.ts";
import { mapActivity } from "./mapActivity.ts";
import { updater } from "./updates.ts";
import type { RulesBook } from "@replay-altar/rules/types";
import {
  addAnnotation,
  collectorState,
  configPath,
  dataDir,
  detectedWarcraftDocuments,
  countMaps,
  mapFolders,
  folderToAdd,
  replayDirs,
  getGame,
  projectRoot,
  isInstalled,
  collectorFiles,
  enableCollector,
  linuxUnit,
  windowsLauncher,
  language,
  listGames,
  loadConfig,
  openDb,
  paths,
  performanceData,
  restartCollectorIfRunning,
  resolveLanguage,
  saveConfig,
  setLanguage,
  tr,
  type Config,
} from "@replay-altar/core/ui";

app.setName("replay-altar");

// A Linux AppImage's collector and command line: `ReplayAltar.AppImage --cli <command…>` runs the
// CLI on this executable as Node (the systemd unit runs `--cli collector`). The AppImage's files
// only exist while it runs, so this process stays, without a window, until the CLI is done.
const cliAt = process.argv.indexOf("--cli");
if (cliAt >= 0) {
  const child = spawn(process.execPath, [join(projectRoot(), "collector/collector.mjs"), ...process.argv.slice(cliAt + 1)], {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  child.on("exit", (code, signal) => app.exit(code ?? (signal ? 1 : 0)));
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => child.kill(sig));
}

/**
 * An installed copy on Windows sets up its own collector: started now and at every login, on this
 * executable as Node (the launcher is rewritten when an update moves the executable).
 */
function ensureWindowsCollector() {
  if (process.platform !== "win32" || !isInstalled()) return;
  const files = collectorFiles();
  const launcher = windowsLauncher([process.execPath, join(projectRoot(), "collector/collector.mjs"), "collector"], { ELECTRON_RUN_AS_NODE: "1" });
  const changed = !existsSync(files.launcher) || readFileSync(files.launcher, "utf8") !== launcher;
  if (changed) {
    mkdirSync(dirname(files.launcher), { recursive: true });
    mkdirSync(dirname(files.log), { recursive: true });
    writeFileSync(files.launcher, launcher);
    restartCollectorIfRunning();
  }
  enableCollector();
}

/** A desktop entry's Exec word: quoted, with ", `, $ and \ escaped. */
const execWord = (s: string) => `"${s.replace(/(["`$\\])/g, "\\$1")}"`;
/** A word for /bin/sh: single quotes, with any ' closed and reopened. */
const shWord = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

/**
 * A Linux AppImage sets up what `replay-altar install` sets up for a checkout: the collector as a
 * systemd user service (started now and at every login) running through this AppImage file, the
 * `replay-altar` command and a menu entry with its icon. Rewritten when the AppImage moves (an
 * update may rename it).
 */
function ensureAppImageCollector() {
  const appImage = process.env.APPIMAGE;
  if (process.platform !== "linux" || !appImage) return;
  const home = homedir();
  const headless = "--ozone-platform=headless";
  const files: [string, string, number][] = [
    [join(home, ".config/systemd/user/replay-altar-collector.service"), linuxUnit([appImage, headless, "--cli", "collector"]), 0o644],
    [join(home, ".local/bin/replay-altar"), `#!/bin/sh\nexec ${shWord(appImage)} ${headless} --cli "$@"\n`, 0o755],
    [
      join(home, ".local/share/applications/replay-altar.desktop"),
      ["[Desktop Entry]", "Type=Application", "Name=Replay Altar", "Comment=Warcraft III replay stats", `Exec=${execWord(appImage)}`, "Icon=replay-altar", "Categories=Game;", "StartupWMClass=replay-altar", ""].join("\n"),
      0o755,
    ],
  ];
  let unitChanged = false;
  for (const [file, content, mode] of files) {
    if (existsSync(file) && readFileSync(file, "utf8") === content) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, { mode });
    if (file.endsWith(".service")) unitChanged = true;
  }
  const icon = join(home, ".local/share/icons/hicolor/scalable/apps/replay-altar.svg");
  if (!existsSync(icon)) {
    mkdirSync(dirname(icon), { recursive: true });
    writeFileSync(icon, readFileSync(join(import.meta.dirname, "../assets/replay-altar.svg")));
  }
  enableCollector();
  // A new unit or a new version: the running collector must move to it before old copies go.
  if (unitChanged || freshCopy) restartCollectorIfRunning();
  pruneOldCopies();
} // window class, so the .desktop entry's StartupWMClass matches

type Launch = { background: boolean; game: string | null; page: string | null; screenshot: string | null };
const arg = (argv: string[], name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const parseArgs = (argv: string[]): Launch => ({
  background: argv.includes("--background"),
  game: arg(argv, "game"),
  page: arg(argv, "page"),
  // Dev/test: render without ever showing a window (pair with --ozone-platform=headless), save a PNG, quit.
  screenshot: arg(argv, "screenshot"),
});

// A screenshot run (dev/test) gets its own profile, and so its own single-instance lock:
// it must never hand its arguments to, resize, or quit the real Replay Altar window.
if (parseArgs(process.argv).screenshot) {
  app.setPath("userData", mkdtempSync(join(tmpdir(), "replay-altar-shot-")));
}

if (cliAt >= 0) {
  // The CLI only (above).
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win: BrowserWindow | null = null;
  const p = paths();
  // The language of the reports and the window (the preload asks for it before the page loads).
  const applyLanguage = () => setLanguage(resolveLanguage(loadConfig().language, app.getLocale()));
  const db = openDb(p.db);
  // Rules reports by game, kept until the data or a result changes.
  // An analyzed replay's own database (the Analyzer page), opened on first use.
  const storeDbs = new Map<string, ReturnType<typeof openDb>>();
  const storeDb = (id: string) => {
    if (!storeDbs.has(id)) storeDbs.set(id, openDb(paths(join(dataDir(), "analyzer", id)).db));
    return storeDbs.get(id)!;
  };
  /** Your games by their key; an analyzed replay by "analyzer:<folder>:<key>". */
  const route = (key: string) => {
    const m = /^analyzer:([0-9a-f]{16}-p\d+):(.+)$/.exec(key);
    if (!m) return { db, p, key, store: null as string | null };
    const store = join(dataDir(), "analyzer", m[1]);
    return { db: storeDb(m[1]), p: paths(store), key: m[2], store };
  };
  const books = new Map<string, RulesBook>();
  const bookOf = (key: string) => {
    if (!books.has(key)) {
      const at = route(key);
      books.set(key, rulesBook(at.db, at.p, at.key));
    }
    return books.get(key)!;
  };

  // Where a launch asked to go, until the page has asked for it: the page may still be starting
  // when the message is sent, and would miss it.
  let pendingNav: { game: string | null; page: string | null } | null = null;
  const show = (launch: Launch) => {
    if (!win) return;
    if (launch.game || launch.page) pendingNav = { game: launch.game, page: launch.page };
    if (launch.game) win.webContents.send("nav:game", launch.game);
    if (launch.page) win.webContents.send("nav:page", launch.page);
    if (launch.screenshot) {
      const file = launch.screenshot;
      setTimeout(async () => {
        // Dev/test: click something first (a CSS selector), e.g. to open the map.
        const click = process.env.REPLAY_ALTAR_SHOT_CLICK;
        if (click) {
          await win!.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(click)})?.click()`);
          await new Promise((r) => setTimeout(r, 1500));
        }
        // Dev/test: zoom in (e.g. 1.4) so text reads on a phone when the picture is shrunk to fit;
        // the page then lays out about 1280 / zoom pixels wide.
        const zoom = Number(process.env.REPLAY_ALTAR_SHOT_ZOOM) || 1;
        if (zoom !== 1) {
          win!.webContents.setZoomFactor(zoom);
          await new Promise((r) => setTimeout(r, 800));
        }
        const height = await win!.webContents.executeJavaScript("document.querySelector('main').scrollHeight + 52");
        win!.setContentSize(1280, Math.min(Math.max(860, Math.ceil(height * zoom)), 8000));
        await new Promise((r) => setTimeout(r, 800));
        // Dev/test: a script run on the page just before the capture, e.g. to hide player names.
        const script = process.env.REPLAY_ALTAR_SHOT_JS;
        if (script) {
          await win!.webContents.executeJavaScript(readFileSync(script, "utf8"));
          // An offscreen page paints the change on its next frame.
          await new Promise((r) => setTimeout(r, 800));
        }
        writeFileSync(file, (await win!.webContents.capturePage()).toPNG());
        app.quit();
      }, 1500);
      return;
    }
    if (launch.background) {
      // Opened because Warcraft III started: be there, but never steal focus from the game.
      if (!win.isVisible()) win.showInactive();
    } else {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  };

  app.on("second-instance", (_e, argv) => show({ ...parseArgs(argv), screenshot: null }));

  let updates: ReturnType<typeof updater> | null = null;

  app.whenReady().then(() => {
    applyLanguage();
    const launch = parseArgs(process.argv);
    if (!launch.screenshot) {
      ensureWindowsCollector();
      ensureAppImageCollector();
    }
    // Screenshot runs stay offline unless pointed at a test list of releases.
    if (!launch.screenshot || process.env.REPLAY_ALTAR_RELEASES_URL) {
      updates = updater({
        // electron-updater replaces an AppImage in place, like the Windows installer.
        installable: (process.platform === "win32" && isInstalled()) || !!process.env.APPIMAGE,
        enabled: () => loadConfig().checkUpdates !== false,
        onChange: (s) => win?.webContents.send("update:state", s),
        log: (m) => console.log(m),
      });
    }
    // Light or dark: the setting, or the system's; --theme forces one (dev/test).
    const theme = arg(process.argv, "theme") ?? loadConfig().theme;
    nativeTheme.themeSource = theme === "light" || theme === "dark" ? theme : "system";
    win = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: "Replay Altar",
      // Taskbar and window icon (scripts/icon.py): Windows takes the .ico with all its sizes.
      icon: join(import.meta.dirname, process.platform === "win32" ? "../assets/replay-altar.ico" : "../assets/icons/512.png"),
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d0d0d" : "#f9f9f7",
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(import.meta.dirname, "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        offscreen: launch.screenshot !== null,
      },
    });
    win.removeMenu();
    // Links in the UI open in the system browser, never inside the app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: "deny" };
    });
    win.loadFile(join(import.meta.dirname, "renderer/index.html"));
    win.once("ready-to-show", () => show(launch));

    // The collector appends to events.jsonl after every ingest; tell the UI to refresh.
    let timer: NodeJS.Timeout | undefined;
    // On a first start the collector may not have made the folder yet.
    mkdirSync(p.root, { recursive: true });
    watch(p.root, (_ev, name) => {
      if (name !== "events.jsonl") return;
      books.clear();
      clearTimeout(timer);
      timer = setTimeout(() => win?.webContents.send("data:changed"), 500);
    });
  });

  app.on("window-all-closed", () => app.quit());

  ipcMain.handle("rules:get", (_e, key: string) => bookOf(key));
  // Every analyzed game's findings, newest first: for recurring problems and the match list.
  ipcMain.handle("findings:summary", () =>
    listGames(db)
      .filter((g) => g.analyzed === 1)
      .map((g) => ({ key: g.game_key, playedAt: g.played_at, result: g.result, findings: bookOf(g.game_key).findings.map((f) => ({ id: f.id, headline: f.headline, severity: f.severity, advice: f.advice ?? null })) })),
  );
  // A map's extracted data: in WC3V's folder, or its copy in the data folder (packages/sim/src/maps.ts).
  const mapDir = (mapFile: string) => {
    const name = mapDataName(mapFile);
    return [join(projectRoot(), "vendor/wc3v/client/maps", name), join(dataDir(), "sim/maps", name, "client")].find((d) => existsSync(d)) ?? null;
  };
  ipcMain.handle("map:activity", (_e, key: string) => {
    const at = route(key);
    const r = getGame(at.db, at.p, at.key)?.record;
    try {
      return r ? mapActivity(mapDir(r.game.map.file), r) : null;
    } catch {
      return null;
    }
  });
  // The map's minimap, as WC3V's data tool extracts it when a game on that map is first simulated.
  ipcMain.handle("map:markers", (_e, mapFile: string) => mapMarkers(join(projectRoot(), "vendor/wc3v"), mapDir(mapFile)));
  // Race crests from the game's own menu art, copied out of the install by
  // scripts/extract-gamedata.ts (never shipped in the repo).
  ipcMain.handle("race:icons", () => {
    const dir = join(dataDir(), "ui/races");
    const files: Record<string, string> = { H: "human", O: "orc", U: "undead", N: "nightelf", R: "random" };
    return Object.fromEntries(
      Object.entries(files)
        .map(([code, name]) => [code, join(dir, `${name}-resting.png`)] as const)
        .filter(([, f]) => existsSync(f))
        .map(([code, f]) => [code, `data:image/png;base64,${readFileSync(f).toString("base64")}`]),
    );
  });
  // Hero portraits (the game's command-card icons), by hero code.
  ipcMain.handle("hero:icons", () => {
    const dir = join(dataDir(), "ui/heroes");
    if (!existsSync(dir)) return {};
    return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".png")).map((f) => [f.slice(0, -4), `data:image/png;base64,${readFileSync(join(dir, f)).toString("base64")}`]));
  });
  // The game's UI font (Friz Quadrata), copied out of the install like the crests.
  ipcMain.handle("ui:font", () => {
    const f = join(dataDir(), "ui/fonts/frizqt__.ttf");
    return existsSync(f) ? `data:font/ttf;base64,${readFileSync(f).toString("base64")}` : null;
  });
  ipcMain.handle("map:image", (_e, mapFile: string) => {
    const dir = mapDir(mapFile);
    const file = dir && join(dir, "map.jpg");
    return file && existsSync(file) ? `data:image/jpeg;base64,${readFileSync(file).toString("base64")}` : null;
  });
  ipcMain.handle("games:list", () => listGames(db));
  ipcMain.handle("games:get", (_e, key: string) => {
    const at = route(key);
    const detail = getGame(at.db, at.p, at.key);
    // The page knows a game by the key it asked with.
    return detail && at.store ? { ...detail, record: { ...detail.record, gameKey: key } } : detail;
  });
  ipcMain.handle("perf:data", () => performanceData(db));
  ipcMain.handle("games:override", (_e, key: string, result: "win" | "loss" | null) => {
    books.delete(key);
    // result null = back to the detected result (the view takes the latest override).
    const at = route(key);
    addAnnotation(at.db, { gameKey: at.key, kind: "result_override", source: "user", author: "desktop", body: { result } });
  });
  ipcMain.handle("config:get", () => ({ config: loadConfig(), configPath: configPath(), paths: p }));
  ipcMain.handle("config:set", (_e, config: Config) => {
    const before = loadConfig().language;
    saveConfig(config);
    // The page reloads after a theme change (charts take their colours when drawn).
    if (!arg(process.argv, "theme")) nativeTheme.themeSource = config.theme === "light" || config.theme === "dark" ? config.theme : "system";
    if (config.language !== before) {
      applyLanguage();
      books.clear(); // reports are written in the language
    }
    restartCollectorIfRunning();
  });
  ipcMain.on("lang:get", (e) => {
    e.returnValue = language();
  });
  ipcMain.handle("collector:status", () => collectorState());
  // Replay folders: the ones found by themselves, the ones you added, and how many hold replays.
  const folders = () => {
    const config = loadConfig();
    return { found: detectedWarcraftDocuments(), added: config.warcraftDocuments, replayDirs: replayDirs(config).length };
  };
  ipcMain.handle("folders:get", () => folders());
  ipcMain.handle("folders:add", async () => {
    const pick = await dialog.showOpenDialog(win!, { properties: ["openDirectory"], title: tr("Your replays folder", "Sua pasta de replays", "Tu carpeta de replays", "Votre dossier de replays") });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const config = loadConfig();
    const folder = folderToAdd(pick.filePaths[0]);
    if (!config.warcraftDocuments.includes(folder)) {
      saveConfig({ ...config, warcraftDocuments: [...config.warcraftDocuments, folder] });
      restartCollectorIfRunning();
    }
    return folders();
  });
  ipcMain.handle("folders:remove", (_e, folder: string) => {
    const config = loadConfig();
    saveConfig({ ...config, warcraftDocuments: config.warcraftDocuments.filter((d) => d !== folder) });
    restartCollectorIfRunning();
    return folders();
  });
  // Map folders: each Warcraft III folder's Maps (found), the ones you added, and the maps
  // extracted so far (kept in the data folder).
  const mapFolderInfo = () => {
    const config = loadConfig();
    const added = config.mapFolders ?? [];
    const found = mapFolders(config).filter((d) => !added.includes(d) && existsSync(d));
    const saved = join(dataDir(), "sim/maps");
    return {
      found,
      added,
      maps: [...found, ...added].reduce((n, d) => n + countMaps(d), 0),
      saved: existsSync(saved) ? readdirSync(saved).filter((d) => existsSync(join(saved, d, "mapdata"))).length : 0,
      savedDir: saved,
    };
  };
  ipcMain.handle("maps:get", () => mapFolderInfo());
  ipcMain.handle("maps:add", async () => {
    const pick = await dialog.showOpenDialog(win!, { properties: ["openDirectory"], title: tr("Your maps folder", "Sua pasta de mapas", "Tu carpeta de mapas", "Votre dossier de cartes") });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const config = loadConfig();
    const folder = pick.filePaths[0];
    if (!(config.mapFolders ?? []).includes(folder)) {
      saveConfig({ ...config, mapFolders: [...(config.mapFolders ?? []), folder] });
      restartCollectorIfRunning();
    }
    return mapFolderInfo();
  });
  ipcMain.handle("maps:remove", (_e, folder: string) => {
    const config = loadConfig();
    saveConfig({ ...config, mapFolders: (config.mapFolders ?? []).filter((d) => d !== folder) });
    restartCollectorIfRunning();
    return mapFolderInfo();
  });
  // The CLI in its own process, for slow work (simulations run WC3V). Installed: the bundled CLI
  // on this executable, as Node. Linux: the launcher `install` wrote. Otherwise: node with this
  // checkout's CLI.
  const runCli = (cliArgs: string[], timeoutMs = 15 * 60_000) => {
    const linuxLauncher = join(homedir(), ".local/bin/replay-altar");
    const [cli, ...base] = isInstalled()
      ? [process.execPath, join(projectRoot(), "collector/collector.mjs")]
      : process.platform !== "win32" && existsSync(linuxLauncher)
        ? [linuxLauncher]
        : ["node", join(app.getAppPath(), "../collector/src/cli.ts")];
    const env = isInstalled() ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : process.env;
    return new Promise<{ stdout: string; error: string | null }>((resolve) =>
      execFile(cli, [...base, ...cliArgs], { env, windowsHide: true, timeout: timeoutMs, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
        resolve({ stdout: `${stdout}`.trim(), error: err ? `${stderr || err.message}`.trim().split("\n").at(-1)! : null }),
      ),
    );
  };
  const lastLine = (s: string) => s.split("\n").at(-1) ?? "";

  // "Simulate again" on a match: `replay-altar sim <game>`; it extracts the map again when its
  // data is missing.
  const resimulating = new Set<string>();
  ipcMain.handle("sim:rerun", async (_e, key: string) => {
    if (resimulating.has(key)) return { ok: false, message: tr("Already simulating this game.", "Esta partida já está sendo simulada.", "Esta partida ya se está simulando.", "Cette partie est déjà en cours de simulation.") };
    resimulating.add(key);
    const at = route(key);
    const res = await runCli(["sim", at.key, ...(at.store ? ["--store", at.store] : [])]);
    resimulating.delete(key);
    books.delete(key);
    const line = lastLine(res.stdout);
    const failed = /failed: (.*)$/.exec(line)?.[1];
    win?.webContents.send("data:changed");
    if (/ ok in /.test(line)) return { ok: true, message: "" };
    return { ok: false, message: failed ?? res.error ?? line };
  });

  // The Analyzer page: replays that aren't yours (a pro game, a friend's), each analyzed from one
  // player's side in a folder of its own under <data>/analyzer/, never in your stats. Their keys
  // are "analyzer:<folder>:<game key>" (route() below).
  const analyzerRoot = join(dataDir(), "analyzer");
  ipcMain.handle("analyzer:pick", async () => {
    // Dev/test: a replay without the dialog.
    if (process.env.REPLAY_ALTAR_PICK_FILE) return inspectReplay(process.env.REPLAY_ALTAR_PICK_FILE);
    const pick = await dialog.showOpenDialog(win!, {
      properties: ["openFile"],
      filters: [{ name: tr("Warcraft III replays", "Replays do Warcraft III", "Replays de Warcraft III", "Replays de Warcraft III"), extensions: ["w3g"] }],
      title: tr("A replay to analyze", "Um replay para analisar", "Un replay para analizar", "Un replay à analyser"),
    });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const file = pick.filePaths[0];
    return inspectReplay(file);
  });
  const inspectReplay = async (file: string) => {
    const res = await runCli(["inspect", file], 60_000);
    let info: { version: string; build: number; durationMs: number; map: string; players: { playerId: number; name: string; race: string | null; teamId: number; isComputer: boolean; isObserver: boolean }[] };
    try {
      info = JSON.parse(lastLine(res.stdout));
    } catch {
      return { file, error: res.error ?? res.stdout };
    }
    if ("error" in info) return { file, error: String((info as { error: unknown }).error) };
    // The current game: your latest game, or the pro statistics', whichever is newer.
    const latest = (db.prepare("SELECT MAX(build) b FROM games").get() as { b: number | null }).b ?? 0;
    const proBuild = Math.max(0, ...loadRefGroups().map((g) => g.profile?.replayBuild ?? 0));
    return { file, ...info, currentBuild: Math.max(latest, proBuild) || null, accounts: loadConfig().accounts };
  };
  ipcMain.handle("analyzer:run", async (_e, file: string, player: { playerId: number; name: string }) => {
    const id = `${createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16)}-p${player.playerId}`;
    const store = join(analyzerRoot, id);
    mkdirSync(store, { recursive: true });
    const res = await runCli(["analyze", file, "--player", player.name, "--store", store]);
    let out: { ok: boolean; key?: string; sim?: string; reason?: string | null };
    try {
      out = JSON.parse(lastLine(res.stdout));
    } catch {
      out = { ok: false, reason: res.error ?? res.stdout };
    }
    if (!out.ok || !out.key) {
      rmSync(store, { recursive: true, force: true });
      return { ok: false, reason: out.reason ?? "?" };
    }
    writeFileSync(join(store, "analyzed.json"), JSON.stringify({ file, player: player.name, key: out.key, at: new Date().toISOString() }));
    return { ok: true, key: `analyzer:${id}:${out.key}`, sim: out.sim, reason: out.reason ?? null };
  });
  ipcMain.handle("analyzer:list", () => {
    if (!existsSync(analyzerRoot)) return [];
    return readdirSync(analyzerRoot)
      .flatMap((id) => {
        const meta = join(analyzerRoot, id, "analyzed.json");
        if (!existsSync(meta)) return [];
        const m = JSON.parse(readFileSync(meta, "utf8")) as { file: string; player: string; key: string; at: string };
        const row = listGames(storeDb(id)).find((g) => g.game_key === m.key);
        return row ? [{ id, key: `analyzer:${id}:${m.key}`, file: m.file, player: m.player, addedAt: m.at, row }] : [];
      })
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  });
  ipcMain.handle("analyzer:remove", (_e, id: string) => {
    if (!/^[0-9a-f]{16}-p\d+$/.test(id)) return;
    storeDbs.get(id)?.close();
    storeDbs.delete(id);
    rmSync(join(analyzerRoot, id), { recursive: true, force: true });
  });
  // The pro statistics shipped with this version (data/reference).
  ipcMain.handle("ref:profiles", () => loadRefGroups());
  // The win-chance model shipped in data/ (scripts/win-chance.ts); null when missing.
  let winModel: unknown;
  ipcMain.handle("winchance:model", () => {
    if (winModel === undefined) {
      const file = join(projectRoot(), "data", "winchance.json");
      winModel = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    }
    return winModel;
  });
  ipcMain.handle("shell:showFile", (_e, file: string) => shell.showItemInFolder(file));
  ipcMain.handle("shell:openPath", (_e, dir: string) => shell.openPath(dir));
  ipcMain.handle("shell:openUrl", (_e, url: string) => {
    if (!/^https:\/\/github\.com\/bubunuh\/replay-altar\b/.test(url)) return;
    // Dev/test: write the address down instead of opening the browser.
    if (process.env.REPLAY_ALTAR_OPENED_URLS) return writeFileSync(process.env.REPLAY_ALTAR_OPENED_URLS, url + "\n", { flag: "a" });
    return shell.openExternal(url);
  });
  ipcMain.handle("progress:get", () => {
    const file = join(p.root, "progress.json");
    try {
      return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    } catch {
      return null; // being rewritten
    }
  });
  ipcMain.handle("share:copyText", (_e, text: string) => clipboard.writeText(text));
  // Share → Save as PDF: the page as it is now (the page has laid itself out for paper), A4,
  // scaled so the paper is about as wide as the window.
  ipcMain.handle("share:pdf", async (e, name: string) => {
    const page = BrowserWindow.fromWebContents(e.sender);
    if (!page) return false;
    const width = page.getContentSize()[0];
    // No paper margins: they would print white around the window's colours; the page pads itself.
    const pdf = await e.sender.printToPDF({ pageSize: "A4", printBackground: true, scale: Math.min(1, Math.max(0.3, 794 / width)), margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    const options = { defaultPath: join(app.getPath("documents"), name), filters: [{ name: "PDF", extensions: ["pdf"] }] };
    // Dev/test: save without the dialog.
    const testFile = process.env.REPLAY_ALTAR_SAVE_TO;
    const picked = testFile ? { canceled: false, filePath: testFile } : await dialog.showSaveDialog(page, options);
    if (picked.canceled || !picked.filePath) return false;
    writeFileSync(picked.filePath, pdf);
    return true;
  });
  ipcMain.handle("nav:pending", () => {
    const nav = pendingNav;
    pendingNav = null;
    return nav;
  });
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    system: `${process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux"} ${osRelease()} (${process.arch})${isInstalled() ? "" : ", from a checkout"}`,
    logDir: process.platform === "win32" && isInstalled() ? dirname(collectorFiles().log) : null,
  }));
  ipcMain.handle("update:get", () => updates?.state() ?? null);
  ipcMain.handle("update:check", () => updates?.check(true) ?? null);
  ipcMain.handle("update:download", () => updates?.download());
  ipcMain.handle("update:install", () => updates?.install());
}
