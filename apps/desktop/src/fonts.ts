// Linux: the window's own font settings. Electron's copy of fontconfig reads the font cache every
// program shares (~/.cache/fontconfig), and a cache another program had rewritten made the window
// crash at every start ("Could not find any font", 2026-11-04). So the window runs with a font
// setup of its own: the system's fonts and rules, and a cache only Replay Altar writes. Fontconfig
// takes its setup only when the process starts, so a start without it (FONTCONFIG_FILE unset)
// starts the window again with it and stays, without a window, until it ends (an AppImage's files
// exist only while its first process runs). If that window crashes within its first seconds, its
// cache may be the cause (half written): it is dropped and the window started once more. Imported
// first by main.ts, before anything else runs; `--cli` runs no window, so it is left alone.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The setup: the folders and rules of the system's /etc/fonts/fonts.conf, without its cache folders. */
export const fontsConf = (cache: string) =>
  [
    `<?xml version="1.0"?>`,
    `<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">`,
    `<fontconfig>`,
    `  <dir>/usr/share/fonts</dir>`,
    `  <dir>/usr/local/share/fonts</dir>`,
    `  <dir prefix="xdg">fonts</dir>`,
    `  <dir>~/.fonts</dir>`,
    `  <include ignore_missing="yes">/etc/fonts/conf.d</include>`,
    `  <cachedir>${xml(cache)}</cachedir>`,
    `</fontconfig>`,
    ``,
  ].join("\n");

/** True in the process that started the window again (main.ts then does nothing else). */
export const fontRestart = process.platform === "linux" && !process.argv.includes("--cli") && !process.env.FONTCONFIG_FILE;

if (fontRestart) {
  // Outside the AppImage's files, so a window started by this one (after an update) still finds it.
  const dir = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "replay-altar");
  const cache = join(dir, "fontconfig");
  const conf = join(dir, "fonts.conf");
  mkdirSync(dir, { recursive: true });
  const text = fontsConf(cache);
  let old = "";
  try {
    old = readFileSync(conf, "utf8");
  } catch {
    // first start
  }
  if (old !== text) writeFileSync(conf, text);

  app.disableHardwareAcceleration(); // no window here, so no GPU process
  const crashes = new Set(["SIGTRAP", "SIGSEGV", "SIGABRT", "SIGILL", "SIGBUS"]);
  let stopping = false;
  let child: ReturnType<typeof spawn>;
  const start = (retry: boolean) => {
    const at = Date.now();
    child = spawn(process.execPath, process.argv.slice(1), { stdio: "inherit", env: { ...process.env, FONTCONFIG_FILE: conf } });
    child.on("exit", (code, signal) => {
      if (retry && !stopping && signal && crashes.has(signal) && Date.now() - at < 20_000) {
        rmSync(cache, { recursive: true, force: true });
        return start(false);
      }
      app.exit(code ?? (signal ? 1 : 0));
    });
  };
  start(true);
  for (const sig of ["SIGTERM", "SIGINT"] as const)
    process.on(sig, () => {
      stopping = true;
      child.kill(sig);
    });
}
