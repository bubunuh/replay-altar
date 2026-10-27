import type { CollectorMode, Config, GameDetail, GameRow, MetricDef, Paths, PerfGame, Progress, ReferenceGroup } from "@replay-altar/core/ui";
import type { RefProfile } from "@replay-altar/reference/types";
import type { RulesBook } from "@replay-altar/rules/types";
import type { Principles } from "@replay-altar/rules/principles";
import type { WinModel } from "@replay-altar/rules/winchance";
import type { MapMarker } from "../mapOverlay.ts";
import type { MapActivity } from "../mapActivity.ts";
import type { UpdateState } from "../updates.ts";

export type { UpdateState };

/** For bug reports: this version, the system, and where the collector's log is (Windows). */
export type AppInfo = { version: string; system: string; logDir: string | null };

export type GameFindings = { key: string; playedAt: string; result: string; findings: { id: string; headline: string; severity: number; advice: string | null }[] };

/** Replay folders: found by themselves, added by you, and how many folders that can hold replays exist. */
export type Folders = { found: string[]; added: string[]; replayDirs: number };

/** A replay picked on the Analyzer page: what it holds, or why it couldn't be read. */
export type PickedReplay = {
  file: string;
  error?: string;
  version?: string;
  build?: number;
  durationMs?: number;
  map?: string;
  players?: { playerId: number; name: string; race: string | null; teamId: number; isComputer: boolean; isObserver: boolean }[];
  /** The newest game build known here (your games, the pro statistics). */
  currentBuild?: number | null;
  accounts?: string[];
};
/** A replay analyzed on the Analyzer page (never in your stats). */
export type AnalyzedReplay = { id: string; key: string; file: string; player: string; addedAt: string; row: GameRow };

/** Map folders: found by themselves, added by you; maps in them, and maps extracted so far. */
export type MapFolders = { found: string[]; added: string[]; maps: number; saved: number; savedDir: string };

export type RefGroupInfo = {
  group: ReferenceGroup;
  profile: RefProfile | null;
  /** Mined from the pro games (scripts/mine-principles.ts); null until mined. */
  principles: Principles | null;
};

type W3Api = {
  listGames(): Promise<GameRow[]>;
  getGame(key: string): Promise<GameDetail>;
  performance(): Promise<{ games: PerfGame[]; metrics: MetricDef[] }>;
  overrideResult(key: string, result: "win" | "loss" | null): Promise<void>;
  /** `collectorMode`: when the collector runs, as it applies now (config.collectorMode, or the default). */
  getConfig(): Promise<{ config: Config; configPath: string; paths: Paths; collectorMode: CollectorMode }>;
  setConfig(config: Config): Promise<void>;
  collectorStatus(): Promise<string>;
  folders(): Promise<Folders>;
  /** Opens a folder picker; null when cancelled. */
  addFolder(): Promise<Folders | null>;
  removeFolder(folder: string): Promise<Folders>;
  mapFolders(): Promise<MapFolders>;
  /** Opens a folder picker; null when cancelled. */
  addMapFolder(): Promise<MapFolders | null>;
  removeMapFolder(folder: string): Promise<MapFolders>;
  /** Simulates a game again (extracting its map again when needed); the result once it's done. */
  resimulate(key: string): Promise<{ ok: boolean; message: string }>;
  /** Opens a file picker for a replay and reads what it holds; null when cancelled. */
  analyzerPick(): Promise<PickedReplay | null>;
  /** Analyzes a replay from one player's side; the key opens its report. */
  analyzerRun(file: string, player: { playerId: number; name: string }): Promise<{ ok: boolean; key?: string; sim?: string; reason: string | null }>;
  analyzerList(): Promise<AnalyzedReplay[]>;
  analyzerRemove(id: string): Promise<void>;
  referenceProfiles(): Promise<RefGroupInfo[]>;
  /** The win-chance model (data/winchance.json); null when the app has none. */
  winModel(): Promise<WinModel | null>;
  showFile(file: string): Promise<void>;
  openPath(dir: string): Promise<void>;
  /** Opens a page of the project on GitHub in the browser (other addresses are ignored). */
  openUrl(url: string): Promise<void>;
  /** Null in screenshot runs. */
  updateState(): Promise<UpdateState | null>;
  checkUpdate(): Promise<UpdateState | null>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateState(fn: (s: UpdateState) => void): void;
  appInfo(): Promise<AppInfo>;
  /** Where the launch asked to go, if the page missed the message (once). */
  /** What the collector is busy with (null: nothing written yet). */
  progress(): Promise<Progress | null>;
  copyText(text: string): Promise<void>;
  /** Prints the page as it is to a PDF and asks where to save it; false when cancelled. */
  savePdf(name: string): Promise<boolean>;
  pendingNav(): Promise<{ game: string | null; page: string | null } | null>;
  rules(key: string): Promise<RulesBook>;
  /** The map's minimap as a data URL, or null when there is none yet. */
  mapImage(mapFile: string): Promise<string | null>;
  /** Gold mines, shops, start locations and creep camps over the minimap (0-1 coordinates). */
  mapMarkers(mapFile: string): Promise<MapMarker[] | null>;
  /** Race crests as data URLs by race code (empty until extracted from the game). */
  raceIcons(): Promise<Record<string, string>>;
  /** The game's UI font as a data URL, or null until extracted. */
  uiFont(): Promise<string | null>;
  /** Hero portraits as data URLs by hero code (empty until extracted). */
  heroIcons(): Promise<Record<string, string>>;
  /** Every analyzed game's findings (most important first), newest game first. */
  findingsSummary(): Promise<GameFindings[]>;
  /** Fights and creep camps cleared, positioned on the map; null without a simulation or map data. */
  mapActivity(key: string): Promise<MapActivity | null>;
  /**
   * Replays in your folders not imported yet, as the collector's last scan counted them; `asked`:
   * some of the older ones were imported already (nothing is until you ask on a new install).
   */
  replaysScan(): Promise<{ found: number; older: number; asked: boolean } | null>;
  /** Imports the next IMPORT_STEP older replays, or all of them. */
  importMore(all: boolean): Promise<void>;
  logError(message: string): void;
  /** The games that changed, or null when everything may have (e.g. re-sorted by battletag). */
  onDataChanged(fn: (keys: string[] | null) => void): void;
  onNavGame(fn: (key: string) => void): void;
  onNavPage(fn: (page: string) => void): void;
};

declare global {
  interface Window {
    w3: W3Api;
  }
}

export const api = window.w3;
