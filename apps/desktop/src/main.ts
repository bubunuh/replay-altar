// Electron main process: one window, read-mostly access to the Replay Altar database.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { loadRefGroups, rulesBook } from "@replay-altar/rules";
import { mapDataName } from "@replay-altar/sim/mapname";
import { mapMarkers } from "./mapOverlay.ts";
import { mapActivity } from "./mapActivity.ts";
import type { RulesBook } from "@replay-altar/rules/types";
import {
  addAnnotation,
  collectorState,
  configPath,
  dataDir,
  detectedWarcraftDocuments,
  folderToAdd,
  replayDirs,
  getGame,
  projectRoot,
  isInstalled,
  collectorFiles,
  enableCollector,
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win: BrowserWindow | null = null;
  const p = paths();
  // The language of the reports and the window (the preload asks for it before the page loads).
  const applyLanguage = () => setLanguage(resolveLanguage(loadConfig().language, app.getLocale()));
  const db = openDb(p.db);
  // Rules reports by game, kept until the data or a result changes.
  const books = new Map<string, RulesBook>();
  const bookOf = (key: string) => {
    if (!books.has(key)) books.set(key, rulesBook(db, p, key));
    return books.get(key)!;
  };

  const show = (launch: Launch) => {
    if (!win) return;
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
        const height = await win!.webContents.executeJavaScript("document.querySelector('main').scrollHeight + 52");
        win!.setContentSize(1280, Math.min(Math.max(860, height), 6000));
        await new Promise((r) => setTimeout(r, 800));
        // Dev/test: a script run on the page just before the capture, e.g. to hide player names.
        const script = process.env.REPLAY_ALTAR_SHOT_JS;
        if (script) await win!.webContents.executeJavaScript(readFileSync(script, "utf8"));
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

  app.whenReady().then(() => {
    applyLanguage();
    const launch = parseArgs(process.argv);
    if (!launch.screenshot) ensureWindowsCollector();
    const theme = arg(process.argv, "theme"); // dev/test: force light or dark
    if (theme === "light" || theme === "dark") nativeTheme.themeSource = theme;
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
    if (existsSync(p.root)) {
      watch(p.root, (_ev, name) => {
        if (name !== "events.jsonl") return;
        books.clear();
        clearTimeout(timer);
        timer = setTimeout(() => win?.webContents.send("data:changed"), 500);
      });
    }
  });

  app.on("window-all-closed", () => app.quit());

  ipcMain.handle("rules:get", (_e, key: string) => bookOf(key));
  // Every analyzed game's findings, newest first: for recurring problems and the match list.
  ipcMain.handle("findings:summary", () =>
    listGames(db)
      .filter((g) => g.analyzed === 1)
      .map((g) => ({ key: g.game_key, playedAt: g.played_at, result: g.result, findings: bookOf(g.game_key).findings.map((f) => ({ id: f.id, headline: f.headline, severity: f.severity, advice: f.advice ?? null })) })),
  );
  ipcMain.handle("map:activity", (_e, key: string) => {
    const r = getGame(db, p, key)?.record;
    try {
      return r ? mapActivity(join(projectRoot(), "vendor/wc3v"), r) : null;
    } catch {
      return null;
    }
  });
  // The map's minimap, as WC3V's data tool extracts it when a game on that map is first simulated.
  ipcMain.handle("map:markers", (_e, mapFile: string) => mapMarkers(join(projectRoot(), "vendor/wc3v"), mapDataName(mapFile)));
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
    const file = join(projectRoot(), "vendor/wc3v/client/maps", mapDataName(mapFile), "map.jpg");
    return existsSync(file) ? `data:image/jpeg;base64,${readFileSync(file).toString("base64")}` : null;
  });
  ipcMain.handle("games:list", () => listGames(db));
  ipcMain.handle("games:get", (_e, key: string) => getGame(db, p, key));
  ipcMain.handle("perf:data", () => performanceData(db));
  ipcMain.handle("games:override", (_e, key: string, result: "win" | "loss" | null) => {
    books.delete(key);
    // result null = back to the detected result (the view takes the latest override).
    addAnnotation(db, { gameKey: key, kind: "result_override", source: "user", author: "desktop", body: { result } });
  });
  ipcMain.handle("config:get", () => ({ config: loadConfig(), configPath: configPath(), paths: p }));
  ipcMain.handle("config:set", (_e, config: Config) => {
    const before = loadConfig().language;
    saveConfig(config);
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
    const pick = await dialog.showOpenDialog(win!, { properties: ["openDirectory"], title: tr("Your replays folder", "Sua pasta de replays") });
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
  // The pro statistics shipped with this version (data/reference).
  ipcMain.handle("ref:profiles", () => loadRefGroups());
  ipcMain.handle("shell:showFile", (_e, file: string) => shell.showItemInFolder(file));
  ipcMain.handle("shell:openPath", (_e, dir: string) => shell.openPath(dir));
}
