import type { Config, GameDetail, GameRow, MetricDef, Paths, PerfGame, ReferenceGroup } from "@w3stats/core/ui";
import type { RefProfile } from "@w3stats/reference/types";
import type { AiAnalysis } from "@w3stats/ai/types";
import type { Principles } from "@w3stats/ai/principles";

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
