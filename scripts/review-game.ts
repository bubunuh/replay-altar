// Prints the rules' report and the fact sheet of any game from one player's side, for reviewing
// the rules by hand (docs/REVIEWS.md):
//
//   node scripts/review-game.ts <group|me> <game-key-prefix> [playerId]
//
// group: a reference folder (pros, pros-orc, review, ...) or "me" for your own games. Without a
// player id: your side in your games, the review subject in "review", else the first player.
import { join } from "node:path";
import { openDb, paths, readRecord, referencePaths, type GameRecord } from "@replay-altar/core";
import { asPlayer, factsRefFor } from "../packages/ai/src/context.ts";
import { gameFacts } from "../packages/ai/src/facts.ts";
import { findings, opponentPlan, strengths } from "../packages/ai/src/findings.ts";
import { recapOf, turningPoint } from "../packages/ai/src/report.ts";

const [group, prefix, pidArg] = process.argv.slice(2);
if (!group || !prefix) throw new Error("usage: <group|me> <game-key-prefix> [playerId]");
const p = group === "me" ? paths() : referencePaths(group);
const db = openDb(p.db);
const key = (db.prepare("SELECT game_key FROM games WHERE game_key LIKE ?").get(`${prefix}%`) as { game_key: string } | undefined)?.game_key;
if (!key) throw new Error(`no game ${prefix} in ${group}`);
const r = readRecord(p, key) as GameRecord;
let pid = pidArg ? Number(pidArg) : r.players.find((x) => x.isMe)?.playerId;
if (pid === undefined) {
  try {
    pid = (db.prepare("SELECT subject_player_id FROM ref_matches WHERE game_key = ?").get(key) as { subject_player_id: number } | undefined)?.subject_player_id;
  } catch {
    // not a reference folder
  }
}
pid ??= r.players[0].playerId;
const meta = (() => {
  try {
    return db.prepare("SELECT subject_name, subject_mmr, opp_name, opp_mmr FROM ref_matches WHERE game_key = ?").get(key) as Record<string, unknown> | undefined;
  } catch {
    return undefined;
  }
})();

// Seen from the subject's side: the fact sheet and the report are written for "you".
const subject = r.players.find((x) => x.playerId === pid)!;
const view = asPlayer(r, pid);
const opp = view.players.find((x) => x.playerId === view.classification.opponentId)!;
const result = subject.result ?? "unknown";
const ref = factsRefFor(view);
const found = findings(view, ref);
const good = strengths(view, ref, found);
console.log(`# ${key.slice(0, 8)} ${subject.name} (${subject.race}) vs ${opp.name} (${opp.race})${meta?.subject_mmr ? ` · MMR ${meta.subject_mmr} vs ${meta.opp_mmr}` : ""} · ${result} · ${r.game.map.file} · ${join(p.root)}`);
console.log(`\n## Report\n${recapOf(view, opp, result, found, good)}`);
found.forEach((f, i) => {
  console.log(`${i + 1}. [${f.id}] ${f.headline}`);
  for (const e of f.evidence) console.log(`   - ${e}`);
  for (const e of f.because ?? []) console.log(`   why: ${e}`);
  if (f.advice) console.log(`   next: ${f.advice}`);
});
console.log(`turning point: ${turningPoint(view, subject, opp, result)?.text ?? "none"}`);
console.log(`strengths: ${good.join(" | ") || "none"}`);
console.log(`opponent: ${opponentPlan(view, ref).join(" ")}`);
console.log(`\n${gameFacts(view, { result, ref }).replace(/\n### Mechanics[\s\S]*$/, "")}`);
