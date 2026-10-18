import type { Config, GameDetail, GameRow, MetricDef, Paths, PerfGame, ReferenceGroup } from "@replay-altar/core/ui";
import type { RefProfile } from "@replay-altar/reference/types";
import type { AiAnalysis, RulesBook } from "@replay-altar/ai/types";
import type { Principles } from "@replay-altar/ai/principles";
import type { MapMarker } from "../mapOverlay.ts";

export type AiStatus = { problem: string | null; warcraftRunning: boolean; running: string[] };

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
  referenceProfiles(): Promise<RefGroupInfo[]>;
  showFile(file: string): Promise<void>;
  openPath(dir: string): Promise<void>;
  refUpdate(): Promise<boolean>;
  refUpdateStatus(): Promise<{ running: boolean; log: string[] }>;
  onRefUpdate(fn: (event: "progress" | "done", value: string | number | null) => void): () => void;
  aiGet(key: string): Promise<AiAnalysis | null>;
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
  aiStatus(): Promise<AiStatus>;
  aiRun(key: string): Promise<AiAnalysis | null>;
  onAi(fn: (event: "progress" | "done", key: string, stage?: string) => void): () => void;
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
