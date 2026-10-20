import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
  /** "Documents/Warcraft III" folders; replays are found under BattleNet/<account>/Replays. */
  warcraftDocuments: string[];
  /** Show the stats window (without focus) when Warcraft III starts. */
  openWindowOnGameStart: boolean;
  /** Desktop notification after each analyzed game. */
  notifyAfterGame: boolean;
  /** Pro games (warcraft3.info tournament replays) to compare against; updated on request. */
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

/** The game's "Documents/Warcraft III" folders: Windows' own (also under OneDrive), or the Wine prefix Lutris installs Battle.net in. */
const warcraftDocuments = () =>
  windows ? [join(home, "Documents/Warcraft III"), join(home, "OneDrive/Documents/Warcraft III")] : [join(home, "Games/battlenet/drive_c/users/steamuser/Documents/Warcraft III")];

export const DEFAULT_CONFIG: Config = {
  // Found from your replays on the first run (apps/collector/src/firstrun.ts), or set in Settings.
  accounts: [],
  warcraftDocuments: warcraftDocuments(),
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

/** Data folder of a reference group: same layout as yours, separate database. */
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
  return { ...DEFAULT_CONFIG, ...rest };
}

export function saveConfig(config: Config) {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}

/** Every folder under BattleNet/<account>/Replays (recursively) that can hold replays. */
export function replayDirs(config: Config): string[] {
  const dirs: string[] = [];
  const walk = (dir: string) => {
    dirs.push(dir);
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) walk(join(dir, e.name));
  };
  for (const docs of config.warcraftDocuments) {
    const bnet = join(docs, "BattleNet");
    if (!existsSync(bnet)) continue;
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
