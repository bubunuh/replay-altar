import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Config = {
  /** Battletags that are you. Games where none of them played are archived as "observed". */
  accounts: string[];
  /** "Documents/Warcraft III" folders; replays are found under BattleNet/<account>/Replays. */
  warcraftDocuments: string[];
  /** Show the stats window (without focus) when Warcraft III starts. */
  openWindowOnGameStart: boolean;
  /** Desktop notification after each analyzed game. */
  notifyAfterGame: boolean;
};

const home = homedir();

export const DEFAULT_CONFIG: Config = {
  accounts: ["Pedrovisk#1486"],
  warcraftDocuments: [join(home, "Games/battlenet/drive_c/users/steamuser/Documents/Warcraft III")],
  openWindowOnGameStart: true,
  notifyAfterGame: true,
};

// W3STATS_DATA / W3STATS_CONFIG let tests and dry runs use throwaway locations.
export const dataDir = () =>
  process.env.W3STATS_DATA ?? join(process.env.XDG_DATA_HOME ?? join(home, ".local/share"), "w3stats");
export const configPath = () =>
  process.env.W3STATS_CONFIG ?? join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "w3stats/config.json");

export const paths = () => {
  const root = dataDir();
  return {
    root,
    db: join(root, "w3stats.sqlite"),
    archive: join(root, "archive"),
    superseded: join(root, "archive/superseded"),
    games: join(root, "games"),
    raw: join(root, "raw"),
    events: join(root, "events.jsonl"),
  };
};

export function loadConfig(): Config {
  const file = configPath();
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    return { ...DEFAULT_CONFIG };
  }
  return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(file, "utf8")) };
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
