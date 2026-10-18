// Shapes of a stored AI analysis (browser-safe: the window imports these).
import type { Finding } from "./findings.ts";

export type { Finding };

/** The rules' output for one game, without the model; problem says why there is none. */
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

export type ReviewedFinding = { title: string; explanation: string; next_time: string };

/** What the model writes (its JSON is constrained to this shape while it is generated). */
export type Review = {
  recap: string;
  opponent_strategy: string;
  findings: Record<string, ReviewedFinding>;
  strengths: string;
  one_thing: string;
};

export type AiAnalysis = {
  version: 1;
  promptVersion: number;
  gameKey: string;
  createdAt: string;
  model: { file: string; draft: string | null; chatTemplate: string | null };
  timings: { totalMs: number; promptTokens: number | null; outputTokens: number | null; tokensPerSecond: number | null };
  /** Decided by rules (packages/ai/src/findings.ts), not by the model. */
  findings: Finding[];
  strengths: string[];
  /** Exactly what the model was given. */
  facts: string;
  review: Review | null;
  /** Numbers and times in the review that appear nowhere in what the model was given. */
  unverified: string[];
  error?: string;
};
