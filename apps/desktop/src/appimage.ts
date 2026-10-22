// An AppImage's own files are read-only (a squashfs mounted only while it runs), but the simulation
// writes into WC3V's folder (the game's unit tables, each map it extracts). So an AppImage copies
// its resources (all but the window, which stays in app.asar) once per version into the data folder
// and runs from there (REPLAY_ALTAR_ROOT, for this process and the collector it starts). Imported
// first by main.ts, before anything asks where Replay Altar's files are.
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { dataDir } from "@replay-altar/core/ui";

const copies = () => join(dataDir(), "app");

/** True when this start made the copy (a new version): the running collector should restart. */
export let freshCopy = false;

if (process.platform === "linux" && process.env.APPIMAGE && !process.env.REPLAY_ALTAR_ROOT) {
  const root = join(copies(), app.getVersion());
  if (!existsSync(root)) {
    // Copied aside, then moved into place, so a collector starting at the same time never sees half a copy.
    const tmp = `${root}.tmp-${process.pid}`;
    mkdirSync(tmp, { recursive: true });
    for (const name of readdirSync(process.resourcesPath)) if (!name.startsWith("app.asar")) cpSync(join(process.resourcesPath, name), join(tmp, name), { recursive: true });
    try {
      renameSync(tmp, root);
      freshCopy = true;
    } catch {
      rmSync(tmp, { recursive: true, force: true }); // another process got there first
    }
  }
  process.env.REPLAY_ALTAR_ROOT = root;
}

/** Removes other versions' copies (once the collector runs on this one). */
export function pruneOldCopies() {
  for (const name of existsSync(copies()) ? readdirSync(copies()) : []) if (name !== app.getVersion()) rmSync(join(copies(), name), { recursive: true, force: true });
}
