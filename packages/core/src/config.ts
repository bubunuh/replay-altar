import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, sep } from "node:path";
import type { Language } from "./i18n.ts";
import { projectRoot } from "./root.ts";

export type ReferenceGroup = {
  id: string;
  label: string;
  /** Unused since the source is warcraft3.info (tournament players); kept for old settings files. */
  minMmr: number;
  /** Race of the subject player (the one compared with you). */
  race: "H" | "O" | "U" | "N";
  /** How many current-patch games to keep. */
  target: number;
  /** Unused since the source is warcraft3.info; kept for old settings files. */
  gateways: number[];
  /** Only download for this group once you have played a game as its race. */
  onlyIfPlayed?: boolean;
};

export type Config = {
  /** Battletags that are you. Games where none of them played are archived as "observed". */
  accounts: string[];
  /**
   * Folders you added on top of the ones found by themselves (warcraftFolders): a
   * "Documents/Warcraft III" folder (replays under BattleNet/<account>/Replays), or any folder of replays.
   */
  warcraftDocuments: string[];
  /** The app's language; unset: the system's (resolveLanguage). */
  language?: Language;
  /** Show the stats window (without focus) when Warcraft III starts. */
  openWindowOnGameStart: boolean;
  /** Desktop notification after each analyzed game. */
  notifyAfterGame: boolean;
  /** Light or dark window (unset: follow the system's setting). */
  theme?: "system" | "light" | "dark";
  /** Ask GitHub once a day whether a newer Replay Altar was released (unset: yes). */
  checkUpdates?: boolean;
  /** After each W3Champions game, fetch its end-of-game statistics from W3Champions (unset: yes). */
  fetchOfficialStats?: boolean;
  /**
   * Map folders you added on top of the ones found by themselves (the Maps folder of each
   * Warcraft III folder): the simulation reads each game's map from them.
   */
  mapFolders?: string[];
  /** Pro games (warcraft3.info tournament replays) the shipped statistics come from (maintainers). */
  reference: { groups: ReferenceGroup[] };
};

const home = homedir();
const windows = process.platform === "win32";

/**
 * Where the app keeps its data and settings: XDG folders on Linux; on Windows %LOCALAPPDATA%
 * for data (large, machine-specific) and %APPDATA% for settings.
 */
export const appDirs = () =>
  windows
    ? { data: process.env.LOCALAPPDATA ?? join(home, "AppData/Local"), config: process.env.APPDATA ?? join(home, "AppData/Roaming") }
    : { data: process.env.XDG_DATA_HOME ?? join(home, ".local/share"), config: process.env.XDG_CONFIG_HOME ?? join(home, ".config") };

/** What the settings file got by default before folders were found at run time; dropped on load. */
const OLD_DEFAULTS = windows
  ? [join(home, "Documents/Warcraft III"), join(home, "OneDrive/Documents/Warcraft III")]
  : [join(home, "Games/battlenet/drive_c/users/steamuser/Documents/Warcraft III")];

/** Windows' own Documents folder from the registry: it may be moved (D:\Documentos) or kept by OneDrive. */
function windowsDocuments(): string | null {
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "/v", "Personal"], { encoding: "utf8", windowsHide: true });
    const raw = out.match(/Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/)?.[1]?.trim();
    return raw ? raw.replace(/%([^%]+)%/g, (m, name: string) => process.env[name] ?? m) : null;
  } catch {
    return null;
  }
}

let detected: string[] | null = null;

/**
 * The game's "Documents/Warcraft III" folders that exist on this computer. Windows: the
 * registry's Documents folder, the usual one, and OneDrive's (whose folder name follows the
 * language, e.g. "OneDrive\Documentos"). Linux: the Wine prefix Lutris installs Battle.net in.
 */
export function detectedWarcraftDocuments(): string[] {
  if (detected) return detected;
  const docs = windows ? [windowsDocuments(), join(home, "Documents")] : [join(home, "Games/battlenet/drive_c/users/steamuser/Documents")];
  if (windows) {
    for (const onedrive of safeList(home).filter((d) => d.startsWith("OneDrive"))) {
      for (const name of ["Documents", "Documentos"]) docs.push(join(home, onedrive, name));
    }
  }
  detected = unique(docs.filter((d): d is string => !!d).map((d) => join(d, "Warcraft III"))).filter((d) => existsSync(d));
  return detected;
}

const safeList = (dir: string) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};
/** Without repeats; Windows paths compare case-insensitively. */
const unique = (dirs: string[]) => {
  const key = (d: string) => (windows ? d.toLowerCase() : d).replace(/[\\/]+$/, "");
  return dirs.filter((d, i) => dirs.findIndex((e) => key(e) === key(d)) === i);
};

/** Every folder the app reads replays (and maps) from: the ones found, then the ones you added. */
export const warcraftFolders = (config: Config) => unique([...detectedWarcraftDocuments(), ...config.warcraftDocuments]);

/** Folders the simulation looks for maps in: each Warcraft III folder's Maps, then the ones you added. */
export const mapFolders = (config: Config) => unique([...warcraftFolders(config).map((d) => join(d, "Maps")), ...(config.mapFolders ?? [])]);

/** The maps found in a folder you picked (any depth, .w3x and .w3m), to tell you it holds some. */
export function countMaps(dir: string, limit = 5000): number {
  let n = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 6 || n >= limit) return;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(join(d, e.name), depth + 1);
      else if (/\.w3[xm]$/i.test(e.name)) n++;
    }
  };
  walk(dir, 0);
  return n;
}

/**
 * The folder to keep for one you picked: the "Warcraft III" folder when the pick is it or
 * anything inside its BattleNet folder (so its Maps are found too); otherwise the pick itself.
 */
export function folderToAdd(picked: string): string {
  const parts = picked.split(/[\\/]+/);
  const i = parts.findIndex((p) => p.toLowerCase() === "battlenet");
  if (i > 0) return parts.slice(0, i).join(sep) || parse(picked).root;
  return picked;
}

export const DEFAULT_CONFIG: Config = {
  // Found from your replays on the first run (apps/collector/src/firstrun.ts), or set in Settings.
  accounts: [],
  warcraftDocuments: [],
  openWindowOnGameStart: true,
  notifyAfterGame: true,
  reference: {
    groups: [
      { id: "pros", label: "Human pros", minMmr: 2400, race: "H", target: 200, gateways: [20, 10] },
      { id: "pros-orc", label: "Orc pros", minMmr: 2400, race: "O", target: 200, gateways: [20, 10], onlyIfPlayed: true },
      { id: "pros-undead", label: "Undead pros", minMmr: 2400, race: "U", target: 200, gateways: [20, 10], onlyIfPlayed: true },
      { id: "pros-nightelf", label: "Night Elf pros", minMmr: 2400, race: "N", target: 200, gateways: [20, 10], onlyIfPlayed: true },
    ],
  },
};

// REPLAY_ALTAR_DATA / REPLAY_ALTAR_CONFIG let tests and dry runs use throwaway locations.
export const dataDir = () => process.env.REPLAY_ALTAR_DATA ?? join(appDirs().data, "replay-altar");
export const configPath = () => process.env.REPLAY_ALTAR_CONFIG ?? join(appDirs().config, "replay-altar/config.json");

export const paths = (root = dataDir()) => {
  return {
    root,
    db: join(root, "replay-altar.sqlite"),
    archive: join(root, "archive"),
    superseded: join(root, "archive/superseded"),
    games: join(root, "games"),
    raw: join(root, "raw"),
    events: join(root, "events.jsonl"),
    /** Maps Replay Altar downloaded (tournament versions you don't have); never the game's folder. */
    maps: join(root, "maps"),
  };
};

/**
 * The pro statistics Replay Altar ships (data/reference/<group>: profile.json, principles.json).
 * The maintainers build them from the reference groups' games and publish them with each version
 * (scripts/publish-pro-data.ts); the app never downloads pro games itself.
 */
export const proDataDir = (groupId: string) => join(projectRoot(), "data", "reference", groupId);

/**
 * The collector's progress.json: what it is busy with (apps/collector/src/progress.ts). `setup`:
 * a first-start step that takes a while; `import`: the replays found at start, `done` of
 * `total`; `sims`: games simulated since the queue was last empty, with the average time.
 */
export type Progress = {
  at: string;
  setup: "gamedata" | null;
  import: { done: number; total: number } | null;
  sims: { done: number; total: number; avgMs: number | null } | null;
};

/** Data folder of a reference group (maintainers): same layout as yours, separate database. */
export const referencePaths = (groupId: string) => {
  const p = paths(join(dataDir(), "reference", groupId));
  return { ...p, db: join(p.root, "reference.sqlite") };
};

export function loadConfig(): Config {
  const file = configPath();
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    return { ...DEFAULT_CONFIG };
  }
  const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<Config>;
  // Settings from before the language model was removed (2026-10-20) still carry an "ai" section.
  const { ai: _model, ...rest } = saved as Partial<Config> & { ai?: unknown };
  const config = { ...DEFAULT_CONFIG, ...rest };
  return { ...config, warcraftDocuments: config.warcraftDocuments.filter((d) => !OLD_DEFAULTS.includes(d)) };
}

export function saveConfig(config: Config) {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}

/**
 * Every folder that can hold replays: under each "Warcraft III" folder, BattleNet/<account>/Replays
 * (recursively); any other folder you added, as a whole.
 */
export function replayDirs(config: Config): string[] {
  const dirs: string[] = [];
  const walk = (dir: string) => {
    dirs.push(dir);
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) walk(join(dir, e.name));
  };
  for (const docs of warcraftFolders(config)) {
    const bnet = join(docs, "BattleNet");
    if (!existsSync(bnet)) {
      if (existsSync(docs) && statSync(docs).isDirectory() && basename(docs).toLowerCase() !== "warcraft iii") walk(docs);
      continue;
    }
    for (const account of readdirSync(bnet)) {
      const replays = join(bnet, account, "Replays");
      if (existsSync(replays) && statSync(replays).isDirectory()) walk(replays);
    }
  }
  return dirs;
}

/** Reference groups worth keeping stocked: always-on ones, and races you have played. */
export function activeReferenceGroups(config: Config, racesPlayed: Set<string>): ReferenceGroup[] {
  return config.reference.groups.filter((g) => !g.onlyIfPlayed || racesPlayed.has(g.race));
}
