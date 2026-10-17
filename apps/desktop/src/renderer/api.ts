import type { Config, GameDetail, GameRow, MetricDef, Paths, PerfGame } from "@w3stats/core/ui";

type W3Api = {
  listGames(): Promise<GameRow[]>;
  getGame(key: string): Promise<GameDetail>;
  performance(): Promise<{ games: PerfGame[]; metrics: MetricDef[] }>;
  overrideResult(key: string, result: "win" | "loss" | null): Promise<void>;
  getConfig(): Promise<{ config: Config; configPath: string; paths: Paths }>;
  setConfig(config: Config): Promise<void>;
  collectorStatus(): Promise<string>;
  showFile(file: string): Promise<void>;
  openPath(dir: string): Promise<void>;
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
