import type { Config, GameDetail, GameRow, MetricDef, Paths, PerfGame, ReferenceGroup } from "@replay-altar/core/ui";
import type { RefProfile } from "@replay-altar/reference/types";
import type { RulesBook } from "@replay-altar/rules/types";
import type { Principles } from "@replay-altar/rules/principles";
import type { MapMarker } from "../mapOverlay.ts";
import type { MapActivity } from "../mapActivity.ts";

export type GameFindings = { key: string; playedAt: string; result: string; findings: { id: string; headline: string; severity: number; advice: string | null }[] };

/** Replay folders: found by themselves, added by you, and how many folders that can hold replays exist. */
export type Folders = { found: string[]; added: string[]; replayDirs: number };

export type RefGroupInfo = {
  group: ReferenceGroup;
  profile: RefProfile | null;
  state: { lastRefreshAt: string | null; lastResult: { kept: number; stopReason: string | null } | null } | null;
  root: string;
  /** Mined from the pro games (scripts/mine-principles.ts); null until mined. */
  principles: Principles | null;
};

type W3Api = {
  listGames(): Promise<GameRow[]>;
  getGame(key: string): Promise<GameDetail>;
  performance(): Promise<{ games: PerfGame[]; metrics: MetricDef[] }>;
  overrideResult(key: string, result: "win" | "loss" | null): Promise<void>;
  getConfig(): Promise<{ config: Config; configPath: string; paths: Paths }>;
  setConfig(config: Config): Promise<void>;
  collectorStatus(): Promise<string>;
  folders(): Promise<Folders>;
  /** Opens a folder picker; null when cancelled. */
  addFolder(): Promise<Folders | null>;
  removeFolder(folder: string): Promise<Folders>;
  referenceProfiles(): Promise<RefGroupInfo[]>;
  showFile(file: string): Promise<void>;
  openPath(dir: string): Promise<void>;
  refUpdate(): Promise<boolean>;
  refUpdateStatus(): Promise<{ running: boolean; log: string[] }>;
  onRefUpdate(fn: (event: "progress" | "done", value: string | number | null) => void): () => void;
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
  /** Is Warcraft III running (heavy work would slow it down)? */
  warcraftRunning(): Promise<boolean>;
  onDataChanged(fn: () => void): void;
  onNavGame(fn: (key: string) => void): void;
  onNavPage(fn: (page: string) => void): void;
};

declare global {
  interface Window {
    w3: W3Api;
  }
}

export const api = window.w3;
