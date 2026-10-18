// Scores the AI-analysis rules (packages/ai/src/findings.ts) on the pro games, from every
// perspective of your groups' races: a useful rule fires more in losses than in wins ("lift").
// Then lists the top findings for each of your games. Run it when reviewing the rules:
//
//   node scripts/eval-findings.ts
//   node scripts/eval-findings.ts --holdout   (thresholds mined from half the games, scored on the other half)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, openDb, paths, referencePaths, readRecord, listGames, type GameRecord } from "@replay-altar/core";
import { groupForRace, pickProfile } from "@replay-altar/reference/compare";
import type { RefProfile } from "@replay-altar/reference/types";
import { allFindings } from "../packages/ai/src/findings.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

// --holdout: mine thresholds from the even half of the pro games, score the rules on the odd half.
const HOLDOUT_DIR = process.argv.includes("--holdout") ? mkdtempSync(join(tmpdir(), "replay-altar-holdout-")) : null;
if (HOLDOUT_DIR) execFileSync(process.execPath, [join(import.meta.dirname, "mine-principles.ts"), "--sample", "even", "--out", HOLDOUT_DIR], { stdio: "ignore" });
const scored = (gameKey: string) => !HOLDOUT_DIR || parseInt(gameKey.at(-1)!, 16) % 2 === 1;

const groups = loadConfig().reference.groups.map((group) => {
  const f = join(referencePaths(group.id).root, "profile.json");
  try { return { group, profile: JSON.parse(readFileSync(f, "utf8")) as RefProfile }; } catch { return { group, profile: null }; }
});
const refFor = (r: GameRecord, pid: number) => {
  const me = r.players.find((p) => p.playerId === pid)!;
  const opp = r.players.find((p) => p.playerId !== pid)!;
  const g = groupForRace(groups, me.race);
  const picked = pickProfile(g?.profile, `${me.race}v${opp.race}`);
  if (!g || !picked) return null;
  let principles = null;
  const file = HOLDOUT_DIR ? join(HOLDOUT_DIR, `principles-${g.group.id}.json`) : join(referencePaths(g.group.id).root, "principles.json");
  try { principles = JSON.parse(readFileSync(file, "utf8")); } catch {}
  return { label: g.group.label, ...picked, principles };
};

type Row = { race: string; win: boolean; ids: string[]; top: string[] };
const rows: Row[] = [];
for (const { group, profile } of groups) {
  if (!profile) continue;
  const rp = referencePaths(group.id);
  for (const f of readdirSync(rp.games)) {
    const r = readRecord(rp, f.replace(/\.json$/, "")) as GameRecord;
    if (r.sim?.status !== "ok" || r.players.length !== 2 || !scored(r.gameKey)) continue;
    // Both players of the group's race (the profile is for that race).
    for (const p of r.players.filter((x) => x.race === group.race && (x.result === "win" || x.result === "loss"))) {
      const found = allFindings(r, refFor(r, p.playerId), p.playerId);
      rows.push({ race: p.race, win: p.result === "win", ids: found.map((x) => x.id), top: found.slice(0, 3).map((x) => x.id) });
    }
  }
}
const wins = rows.filter((r) => r.win), losses = rows.filter((r) => !r.win);
console.log(`pro perspectives: ${rows.length} (${wins.length} wins, ${losses.length} losses)\n`);
const ids = [...new Set(rows.flatMap((r) => r.ids))];
const rate = (set: Row[], id: string) => set.filter((r) => r.ids.includes(id)).length / Math.max(1, set.length);
const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
const lift = (w: number, l: number) => (w > 0 ? (l / w).toFixed(1) : l > 0 ? "inf" : "-");
const races = [...new Set(rows.map((r) => r.race))];
console.log("rule".padEnd(22), "| wins  losses | lift | lift by race (" + races.join(" ") + ")");
for (const id of ids) {
  const [w, l] = [rate(wins, id), rate(losses, id)];
  const byRace = races.map((race) => lift(rate(wins.filter((r) => r.race === race), id), rate(losses.filter((r) => r.race === race), id)).padStart(4));
  console.log(id.padEnd(22), `| ${pct(w)}   ${pct(l)}  | ${lift(w, l).padStart(4)} | ${byRace.join(" ")}`);
}
const avg = (set: Row[]) => (set.reduce((n, r) => n + r.top.length, 0) / Math.max(1, set.length)).toFixed(2);
console.log(`\nshown findings per game (top 3): wins ${avg(wins)}, losses ${avg(losses)}`);

console.log("\n== your games: top 3 (+ the rest)");
const p = paths();
const db = openDb(p.db);
for (const g of listGames(db).filter((x) => x.analyzed === 1)) {
  const r = readRecord(p, g.game_key) as GameRecord;
  const me = r.players.find((x) => x.isMe)!;
  const ref = refFor(r, me.playerId);
  const b = allFindings(r, ref, me.playerId);
  console.log(`${g.game_key.slice(0, 8)} ${g.result.padEnd(4)} ${g.matchup} ${(g.user_label ?? "").padEnd(26)} ${Math.round(r.game.durationMs / 60000)}m  ${b.slice(0, 3).map((x) => `${x.id} ${x.severity.toFixed(2)}`).join(", ") || "-"}${b.length > 3 ? `   (+ ${b.slice(3).map((x) => x.id).join(", ")})` : ""}`);
}
