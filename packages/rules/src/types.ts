// Shapes of the rules' report (browser-safe: the window imports these).
import type { Finding } from "./findings.ts";

export type { Finding };

/** The rules' output for one game; problem says why there is none. */
export type RulesBook = {
  problem: string | null;
  /** Result, main problem and its cause, in a sentence or two. */
  recap: string;
  findings: Finding[];
  /** The fight that swung the game, with a time to rewatch; null when none stood out. */
  turningPoint: string | null;
  /** The top finding's advice. */
  oneThing: string | null;
  strengths: string[];
  opponentPlan: string[];
  facts: string;
};
