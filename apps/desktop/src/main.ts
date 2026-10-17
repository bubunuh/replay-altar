// Electron main process: one window, read-mostly access to the W3Stats database.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import { aiNotReady, analyzeGame, ModelServer, readAnalysis } from "@w3stats/ai";
import {
  addAnnotation,
  configPath,
  getGame,
  isWarcraftRunning,
  listGames,
  loadConfig,
  openDb,
  paths,
  performanceData,
  referencePaths,
  saveConfig,
  type Config,
} from "@w3stats/core/ui";

app.setName("w3stats"); // window class, so the .desktop entry's StartupWMClass matches

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
// it must never hand its arguments to, resize, or quit the real W3Stats window.
if (parseArgs(process.argv).screenshot) {
  app.setPath("userData", mkdtempSync(join(tmpdir(), "w3stats-shot-")));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win: BrowserWindow | null = null;
  const p = paths();
  const db = openDb(p.db);

  const show = (launch: Launch) => {
    if (!win) return;
    if (launch.game) win.webContents.send("nav:game", launch.game);
    if (launch.page) win.webContents.send("nav:page", launch.page);
    if (launch.screenshot) {
      const file = launch.screenshot;
      setTimeout(async () => {
        const height = await win!.webContents.executeJavaScript("document.querySelector('main').scrollHeight + 52");
        win!.setContentSize(1280, Math.min(Math.max(860, height), 6000));
        await new Promise((r) => setTimeout(r, 800));
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
    const launch = parseArgs(process.argv);
    const theme = arg(process.argv, "theme"); // dev/test: force light or dark
    if (theme === "light" || theme === "dark") nativeTheme.themeSource = theme;
    win = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: "W3Stats",
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
        clearTimeout(timer);
        timer = setTimeout(() => win?.webContents.send("data:changed"), 500);
      });
    }
  });

  app.on("window-all-closed", () => app.quit());

  // AI analysis: one game at a time; the model server is started on demand and stopped when idle
  // or when the app quits.
  let model: { key: string; server: ModelServer } | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const runningAi = new Set<string>();
  app.on("will-quit", () => model?.server.stop());
  ipcMain.handle("ai:get", (_e, key: string) => readAnalysis(p, key));
  ipcMain.handle("ai:status", () => ({ problem: aiNotReady(loadConfig().ai), warcraftRunning: isWarcraftRunning(), running: [...runningAi] }));
  ipcMain.handle("ai:run", (e, key: string) => {
    if (runningAi.has(key)) return null;
    runningAi.add(key);
    const send = (channel: string, ...args: unknown[]) => {
      if (!e.sender.isDestroyed()) e.sender.send(channel, ...args);
    };
    send("ai:progress", key, "Waiting for another analysis to finish");
    const job = queue.then(async () => {
      const cfg = loadConfig().ai;
      // A settings change gets a fresh server; the old one stops.
      if (!model || model.key !== JSON.stringify(cfg)) {
        model?.server.stop();
        model = { key: JSON.stringify(cfg), server: new ModelServer(cfg, p.ai) };
      }
      try {
        return await analyzeGame(db, p, cfg, model.server, key, (stage) => send("ai:progress", key, stage));
      } finally {
        runningAi.delete(key);
        send("ai:done", key);
      }
    });
    queue = job.catch(() => {});
    return job;
  });

  ipcMain.handle("games:list", () => listGames(db));
  ipcMain.handle("games:get", (_e, key: string) => getGame(db, p, key));
  ipcMain.handle("perf:data", () => performanceData(db));
  ipcMain.handle("games:override", (_e, key: string, result: "win" | "loss" | null) => {
    // result null = back to the detected result (the view takes the latest override).
    addAnnotation(db, { gameKey: key, kind: "result_override", source: "user", author: "desktop", body: { result } });
  });
  ipcMain.handle("config:get", () => ({ config: loadConfig(), configPath: configPath(), paths: p }));
  ipcMain.handle("config:set", (_e, config: Config) => {
    saveConfig(config);
    // The collector reads its settings at start.
    execFile("systemctl", ["--user", "try-restart", "w3stats-collector.service"], () => {});
  });
  ipcMain.handle("collector:status", () =>
    new Promise<string>((resolve) =>
      execFile("systemctl", ["--user", "is-active", "w3stats-collector.service"], (_err, out) => resolve(out.trim() || "not installed")),
    ),
  );
  ipcMain.handle("ref:profiles", () => {
    // profile.json of each configured reference group (missing until the first refresh).
    return loadConfig().reference.groups.map((g) => {
      const file = join(referencePaths(g.id).root, "profile.json");
      const state = join(referencePaths(g.id).root, "state.json");
      return {
        group: g,
        profile: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null,
        state: existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) : null,
        root: referencePaths(g.id).root,
      };
    });
  });
  ipcMain.handle("shell:showFile", (_e, file: string) => shell.showItemInFolder(file));
  ipcMain.handle("shell:openPath", (_e, dir: string) => shell.openPath(dir));
}
