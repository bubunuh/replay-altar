// Shapes of the simulation layer's results, stored in GameRecord.sim.
// Produced by packages/sim from WC3V's output plus our own cost accounting and income model.
import type { Metrics } from "./metrics.ts";

/** One 10-second sample. Cumulative values count from the start of the game. */
export type SimSample = {
  t: number;
  goldSpent: number;
  lumberSpent: number;
  goldLost: number;
  lumberLost: number;
  foodUsed: number;
  foodMax: number;
  workers: number;
  /** Estimates from the income model (see docs/DATA.md). */
  estGoldMined: number;
  estLumberMined: number;
  estGoldBank: number;
  estLumberBank: number;
  /** WC3V dominance score (0–100, 50 = even); null when WC3V had none. */
  dominance: number | null;
  /** Food in army units (food used minus workers and heroes). */
  armyFood?: number;
  /** Estimated resource value of that army (see packages/sim/src/army.ts). */
  armyValue?: number;
};

/** A hero's life in the game: when it appeared, levelled, died (approximate) and was revived. */
export type HeroTimeline = {
  code: string;
  name: string;
  appearAt: number | null;
  levelUps: number[];
  deaths: { diedAt: number; revivedAt: number | null }[];
};

/** A fight WC3V detected (times only: its own loss tracking is unreliable, use the series). */
export type SimFight = {
  start: number;
  end: number;
  /** WC3V category: pitched-battle, tower-dive, creep-fight, harass, engagement, expansion-fight, base-defense, ... */
  category: string;
  /** Player who started it, when WC3V could tell. */
  initiatorId: number | null;
  playerIds: number[];
  involvesHero: boolean;
  involvesAir: boolean;
  /** WC3V's battle summary per player id: resources lost and heroes killed (missing in older summaries). */
  losses?: Record<string, { value: number; heroes: string[] }>;
};

export type SimPlayer = {
  playerId: number;
  parseConfidence: number;
  validationWarnings: string[];
  series: SimSample[];
  metrics: Metrics;
  heroes?: HeroTimeline[];
};

export type SimSummary =
  | {
      status: "ok";
      engine: { name: "wc3v"; commit: string };
      gameData: { version: string; manifestSha256: string };
      model: { version: number; constants: Record<string, unknown> };
      ranAt: string;
      runMs: number;
      outputPath: string;
      players: SimPlayer[];
      fights?: SimFight[];
      /** Sanity checks that failed, e.g. spending more than the model says was mined. */
      warnings: string[];
    }
  | { status: "failed"; engine: { name: "wc3v"; commit: string }; ranAt: string; reason: string };
