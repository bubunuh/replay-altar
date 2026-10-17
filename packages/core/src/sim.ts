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
};

export type SimPlayer = {
  playerId: number;
  parseConfidence: number;
  validationWarnings: string[];
  series: SimSample[];
  metrics: Metrics;
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
      /** Sanity checks that failed, e.g. spending more than the model says was mined. */
      warnings: string[];
    }
  | { status: "failed"; engine: { name: "wc3v"; commit: string }; ranAt: string; reason: string };
