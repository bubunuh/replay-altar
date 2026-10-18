// Shapes of reference/<group>/principles.json (written by scripts/mine-principles.ts). Browser-safe.
import { deviationsFromPros, type Match } from "./builds.ts";

export type ProStep = { step: string; guideFood: number; proFood: number | null; share: number };
export type ProBuild = { id: string; name: string; players: number; winRate: number; matchScore: number | null; steps: ProStep[] };
export type ProPlan = { plan: string; players: number; winRate: number; food: (number | null)[] };
export type Principles = {
  race: string;
  players: number;
  library: ProBuild[];
  plans: ProPlan[];
  features: Record<string, { label: string; unit: string; all: { p25: number; p50: number; p75: number; p10: number; p90: number; n: number } | null }>;
};

export const proBuildOf = (p: Principles | null | undefined, m: Match | undefined) => (p && m ? (p.library.find((b) => b.id === m.build.id) ?? null) : null);
export { deviationsFromPros };
