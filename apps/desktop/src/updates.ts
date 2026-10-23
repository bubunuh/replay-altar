// Is there a newer Replay Altar? The window asks GitHub's public list of releases once at start
// and then once a day: one small request that sends nothing about you. Installing is always your
// choice. An installed Windows copy downloads the new installer with electron-updater (which
// checks it against the checksum published with the release) and restarts into it; a copy run
// from a checkout gets the git commands instead.
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { newestRelease, type GithubRelease, type Release } from "./releases.ts";

const REPO = "bubunuh/replay-altar";
/** Testing: a local JSON in the GitHub API's shape, and a generic electron-updater feed. */
const RELEASES_API = process.env.REPLAY_ALTAR_RELEASES_URL ?? `https://api.github.com/repos/${REPO}/releases?per_page=10`;
const TEST_FEED = process.env.REPLAY_ALTAR_UPDATE_FEED;
const DAY_MS = 24 * 60 * 60_000;

export type UpdateState = {
  current: string;
  /** The newest release above the running version, if any. */
  latest: Release | null;
  checkedAt: string | null;
  /** Can the app install it by itself (installed Windows copy), or is it a checkout? */
  installable: boolean;
  download: "idle" | "downloading" | "ready" | "failed";
  percent: number;
  error: string | null;
};

export function updater(opts: { installable: boolean; enabled: () => boolean; onChange: (s: UpdateState) => void; log: (m: string) => void }) {
  const state: UpdateState = { current: app.getVersion(), latest: null, checkedAt: null, installable: opts.installable, download: "idle", percent: 0, error: null };
  const changed = () => opts.onChange({ ...state });

  if (opts.installable) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // Every release so far is marked as a pre-release.
    autoUpdater.allowPrerelease = true;
    if (TEST_FEED) autoUpdater.setFeedURL({ provider: "generic", url: TEST_FEED });
    autoUpdater.on("download-progress", (p) => {
      state.percent = Math.round(p.percent);
      changed();
    });
    autoUpdater.on("update-downloaded", () => {
      state.download = "ready";
      changed();
    });
    autoUpdater.on("error", (e) => {
      if (state.download !== "downloading") return;
      state.download = "failed";
      state.error = e.message;
      changed();
    });
  }

  async function check(force = false) {
    if (!force && !opts.enabled()) return state;
    try {
      const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json", "User-Agent": `replay-altar/${state.current}` } });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      state.latest = newestRelease((await res.json()) as GithubRelease[], state.current);
      state.checkedAt = new Date().toISOString();
      state.error = null;
    } catch (e) {
      state.error = (e as Error).message;
      opts.log(`update check failed: ${state.error}`);
    }
    changed();
    return { ...state };
  }

  async function download() {
    if (!opts.installable || !state.latest || state.download === "downloading" || state.download === "ready") return;
    state.download = "downloading";
    state.percent = 0;
    state.error = null;
    changed();
    try {
      await autoUpdater.checkForUpdates();
      await autoUpdater.downloadUpdate();
    } catch (e) {
      state.download = "failed";
      state.error = (e as Error).message;
      changed();
    }
  }

  /**
   * Quits, runs the new installer (it stops the collector) and starts the new version. Not
   * silently: its small progress window is what you see while nothing else is on screen (an
   * update skips the installer's notice page).
   */
  function install() {
    if (state.download === "ready") autoUpdater.quitAndInstall(false, true);
  }

  setTimeout(() => void check(), process.env.REPLAY_ALTAR_RELEASES_URL ? 0 : 10_000);
  setInterval(() => void check(), DAY_MS);
  return { state: () => ({ ...state }), check, download, install };
}
