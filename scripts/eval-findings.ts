// Scores the AI-analysis rules (packages/rules/src/findings.ts) on the pro games, from every
// perspective of your groups' races: a useful rule fires more in losses than in wins ("lift").
// Then lists the top findings for each of your games. Run it when reviewing the rules:
//
//   node scripts/eval-findings.ts
//   node scripts/eval-findings.ts --holdout   (thresholds mined from half the games, scored on the other half)
//   node scripts/eval-findings.ts --holdout --pool validation   (the same, with the validation games
//                                                pooled into the mining and the scoring, as shipped)
//   node scripts/eval-findings.ts --validation   (the shipped thresholds, scored on the validation set's
//                                                tournament games, 2022 to today: scripts/download-validation.ts)
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { openDb, paths, referencePaths, readRecord, listGames, type GameRecord } from "@replay-altar/core";
import { loadRefGroups, refFor as refForPlayers } from "../packages/rules/src/context.ts";
import { allFindings, SHOWN_RULES } from "../packages/rules/src/findings.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

// --holdout: mine thresholds from the even half of the pro games, score the rules on the odd half.
const HOLDOUT_DIR = process.argv.includes("--holdout") ? mkdtempSync(join(tmpdir(), "replay-altar-holdout-")) : null;
const POOL = process.argv.includes("--pool") ? process.argv[process.argv.indexOf("--pool") + 1] : null;
if (HOLDOUT_DIR) execFileSync(process.execPath, [join(import.meta.dirname, "mine-principles.ts"), "--sample", "even", "--out", HOLDOUT_DIR, ...(POOL ? ["--pool", POOL] : [])], { stdio: "ignore" });
const scored = (gameKey: string) => !HOLDOUT_DIR || parseInt(gameKey.at(-1)!, 16) % 2 === 1;

const groups = loadRefGroups(HOLDOUT_DIR ?? undefined);
const refFor = (r: GameRecord, pid: number) => {
  const me = r.players.find((p) => p.playerId === pid)!;
  return refForPlayers(groups, me, r.players.find((p) => p.playerId !== pid)!);
};

type Row = { game: string; race: string; win: boolean; ids: string[]; top: string[] };
const rows: Row[] = [];
// --validation: every player of every validation game, against the pros of their race.
const VALIDATION = process.argv.includes("--validation");
if (VALIDATION || POOL) {
  const rp = referencePaths(POOL ?? "validation");
  for (const f of readdirSync(rp.games)) {
    const r = readRecord(rp, f.replace(/\.json$/, "")) as GameRecord;
    if (r?.sim?.status !== "ok" || r.players.length !== 2 || !scored(r.gameKey)) continue;
    for (const p of r.players.filter((x) => x.result === "win" || x.result === "loss")) {
      let found;
      try {
        found = allFindings(r, refFor(r, p.playerId), p.playerId, { all: true });
      } catch {
        continue; // a broken simulation
      }
      rows.push({ game: r.gameKey, race: p.race, win: p.result === "win", ids: found.map((x) => x.id), top: found.filter((x) => SHOWN_RULES.has(x.id)).slice(0, 3).map((x) => x.id) });
    }
  }
}
for (const { group, profile } of VALIDATION ? [] : groups) {
  if (!profile) continue;
  const rp = referencePaths(group.id);
  for (const f of readdirSync(rp.games)) {
    const r = readRecord(rp, f.replace(/\.json$/, "")) as GameRecord;
    if (r.sim?.status !== "ok" || r.players.length !== 2 || !scored(r.gameKey)) continue;
    // Both players of the group's race (the profile is for that race).
    for (const p of r.players.filter((x) => x.race === group.race && (x.result === "win" || x.result === "loss"))) {
      const found = allFindings(r, refFor(r, p.playerId), p.playerId, { all: true });
      rows.push({ game: r.gameKey, race: p.race, win: p.result === "win", ids: found.map((x) => x.id), top: found.filter((x) => SHOWN_RULES.has(x.id)).slice(0, 3).map((x) => x.id) });
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
// 95% range of each lift, resampling whole games (both players of a game stay together).
const byGame = [...Map.groupBy(rows, (r) => r.game).values()];
let seed = 11;
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed / 4294967296);
const resamples = Array.from({ length: 400 }, () => Array.from({ length: byGame.length }, () => byGame[Math.floor(rand() * byGame.length)]).flat());
const liftRange = (id: string) => {
  const ls = resamples.map((rs) => {
    const w = rate(rs.filter((r) => r.win), id), l = rate(rs.filter((r) => !r.win), id);
    return w > 0 ? l / w : l > 0 ? Infinity : 1;
  }).sort((a, b) => a - b);
  return `${ls[10].toFixed(1)}–${Number.isFinite(ls[389]) ? ls[389].toFixed(1) : "inf"}`;
};
console.log("rule".padEnd(22), "| wins  losses | lift | 95% range | lift by race (" + races.join(" ") + ")");
for (const id of ids) {
  const [w, l] = [rate(wins, id), rate(losses, id)];
  const byRace = races.map((race) => lift(rate(wins.filter((r) => r.race === race), id), rate(losses.filter((r) => r.race === race), id)).padStart(4));
  console.log(id.padEnd(22), `| ${pct(w)}   ${pct(l)}  | ${lift(w, l).padStart(4)} | ${liftRange(id).padStart(9)} | ${byRace.join(" ")}`);
}
const avg = (set: Row[]) => (set.reduce((n, r) => n + r.top.length, 0) / Math.max(1, set.length)).toFixed(2);
console.log(`\nshown findings per game (top 3 of the shown rules): wins ${avg(wins)}, losses ${avg(losses)}`);

if (VALIDATION) process.exit(0);
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
