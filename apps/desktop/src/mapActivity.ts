// What happened where in one game, for the expanded map: fights between the players (where,
// how big, who came out ahead) and the creep camps each player cleared, in order. Positions
// come from the game's WC3V output (battle centres, camp bounds); losses from the same
// series-based count the report uses (packages/rules fightLosses), so the map agrees with it.
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { GameRecord } from "@replay-altar/core/ui";
import { fightLabel, fightLosses } from "@replay-altar/rules/series";
import { projectionFor } from "./mapOverlay.ts";

export type MapFight = { x: number; y: number; start: number; end: number; label: string; you: number; them: number };
export type MapCamp = { x: number; y: number; at: number; level: number; by: "me" | "opp"; order: number };
export type MapActivity = { fights: MapFight[]; camps: MapCamp[] };

type Battle = { startTime: number; category: string; campUuid?: string | null; summary?: { center?: { x: number; y: number } }; outerBbox?: { minX: number; minY: number; maxX: number; maxY: number } };
type Unit = { isUnit?: boolean; lastPosition?: { x: number; y: number }; lostState?: { state: string; since: number } };
type Group = { bounds?: { minX: number; minY: number; maxX: number; maxY: number }; totalLevel?: number; claimOwnerId?: number | null; clearedTime?: number | null };

/** `mapDir`: the map's extracted data (see mapOverlay.ts). */
export function mapActivity(mapDir: string | null, r: GameRecord): MapActivity | null {
  if (r.sim?.status !== "ok" || !r.sim.outputPath || !existsSync(r.sim.outputPath)) return null;
  const at = projectionFor(mapDir);
  const me = r.players.find((p) => p.isMe);
  const opp = r.players.find((p) => p.playerId === r.classification.opponentId);
  if (!at || !me || !opp) return null;
  const out = JSON.parse(gunzipSync(readFileSync(r.sim.outputPath)).toString("utf8")) as {
    battles?: Battle[];
    world?: { neutralGroups?: Record<string, Group> };
    players?: Record<string, { units?: Unit[] }>;
  };
  // Fights only inferred from losses have no battle: place them where the units lost then were last seen.
  const lost = [me, opp].flatMap((p) => (out.players?.[String(p.playerId)]?.units ?? []).filter((u) => u.isUnit && u.lastPosition && u.lostState && u.lostState.state !== "active"));
  const lostAround = (from: number, to: number) => {
    const near = lost.filter((u) => u.lostState!.since >= from && u.lostState!.since <= to);
    if (!near.length) return null;
    return { x: near.reduce((n, u) => n + u.lastPosition!.x, 0) / near.length, y: near.reduce((n, u) => n + u.lastPosition!.y, 0) / near.length };
  };

  const centre = (b: Battle) =>
    b.summary?.center ?? (b.outerBbox ? { x: (b.outerBbox.minX + b.outerBbox.maxX) / 2, y: (b.outerBbox.minY + b.outerBbox.maxY) / 2 } : null);
  const battles = out.battles ?? [];
  const fights: MapFight[] = [];
  for (const x of fightLosses(r, me, opp)) {
    if (x.f.category === "creep-fight" || !x.f.playerIds.includes(opp.playerId) || x.me + x.opp === 0) continue;
    const b = battles.find((b) => b.startTime === x.f.start);
    const c = (b && centre(b)) ?? lostAround(x.f.start - 10_000, x.f.end + 10_000);
    if (!c) continue;
    fights.push({ ...at(c.x, c.y), start: x.f.start, end: x.f.end, label: fightLabel(x.f.category), you: x.me, them: x.opp });
  }

  const camps: MapCamp[] = [];
  for (const g of Object.values(out.world?.neutralGroups ?? {})) {
    if (!g.bounds || g.clearedTime == null || g.claimOwnerId == null) continue;
    // WC3V credits a camp to a team.
    const by = g.claimOwnerId === me.teamId ? "me" : g.claimOwnerId === opp.teamId ? "opp" : null;
    if (!by) continue;
    camps.push({ ...at((g.bounds.minX + g.bounds.maxX) / 2, (g.bounds.minY + g.bounds.maxY) / 2), at: g.clearedTime, level: g.totalLevel ?? 0, by, order: 0 });
  }
  camps.sort((a, b) => a.at - b.at);
  for (const side of ["me", "opp"] as const) camps.filter((c) => c.by === side).forEach((c, i) => (c.order = i + 1));
  return { fights, camps };
}
