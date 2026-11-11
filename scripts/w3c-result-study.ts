// Study for 0.3.0: can a W3Champions game's result be read from the replay's leave records?
// Step 1 (this script): dump the leave records, with their order and game time, of every replay
// under the given folders, one JSON line per file. Read-only on the folders.
//
//   nice node scripts/w3c-result-study.ts dump <out.jsonl> <folder-or-file>...
//   node scripts/w3c-result-study.ts report <dump.jsonl>... [--truth=<truth.json>]
//
// `report` reads the dumps, applies the rule Replay Altar used up to 0.2.5 and the 0.3.0 rule
// (packages/core/src/result.ts) and lists every file where they differ; with a truth file
// ({ "<gameName or sha256>": "<winner's name>" }) it also scores each rule.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import W3GReplay from "w3gjs";
import { classify, parseReplay, readLeaves, type LeaveRecord } from "@replay-altar/core";

type Row = {
  file: string;
  sha256: string;
  error?: string;
  gameName?: string;
  source?: string;
  build?: number;
  durationMs?: number;
  seats?: { playerId: number; name: string; teamId: number; isObserver: boolean; isComputer: boolean }[];
  /** In file order; atMs is the game time of the record (sum of the time slots before it). */
  leaves?: { playerId: number; reason: string; result: string; atMs: number }[];
  w3gjsWinner?: number;
};

function walk(p: string, out: string[]) {
  const st = statSync(p);
  if (st.isDirectory()) for (const e of readdirSync(p)) walk(join(p, e), out);
  else if (p.toLowerCase().endsWith(".w3g")) out.push(p);
}

/** Game time of each leave record: w3gjs gives the records without it. */
async function leaveTimes(buffer: Buffer): Promise<number[]> {
  const replay = new W3GReplay();
  const times: number[] = [];
  let t = 0;
  replay.on("gamedatablock", (b: { id: number; timeIncrement?: number }) => {
    if (b.id === 0x1f || b.id === 0x1e) t += b.timeIncrement ?? 0;
    else if (b.id === 0x17) times.push(t);
  });
  try {
    await replay.parse(buffer);
  } catch {
    // a cut file: the times read so far are kept
  }
  return times;
}

async function dump(out: string, roots: string[]) {
  const files: string[] = [];
  for (const r of roots) if (existsSync(r)) walk(r, files);
  writeFileSync(out, "");
  let n = 0;
  for (const file of files) {
    const buffer = readFileSync(file);
    const row: Row = { file, sha256: createHash("sha256").update(buffer).digest("hex") };
    try {
      const raw = await parseReplay(buffer);
      const c = classify(raw, []);
      const times = await leaveTimes(buffer);
      row.gameName = raw.meta.gameName;
      row.source = c.source;
      row.build = raw.subheader.buildNo;
      row.durationMs = raw.output.duration;
      row.seats = c.seats.map((s) => ({ playerId: s.playerId, name: s.name, teamId: s.teamId, isObserver: s.isObserver, isComputer: s.isComputer }));
      row.leaves = raw.leaveEvents.map((e, i) => ({ playerId: e.playerId, reason: e.reason, result: e.result, atMs: times[i] ?? -1 }));
      row.w3gjsWinner = raw.output.winningTeamId;
    } catch (e) {
      row.error = (e as Error).message;
    }
    appendFileSync(out, JSON.stringify(row) + "\n");
    if (++n % 200 === 0) console.error(`${n}/${files.length}`);
  }
  console.error(`${n} files -> ${out}`);
}

/** The dump's row as the part of a RawReplay that readLeaves needs. */
function decide(row: Row, flo: boolean) {
  const players = row.seats!.filter((s) => !s.isObserver);
  const leaves: LeaveRecord[] = row.leaves!.map((e) => ({ playerId: e.playerId, reason: e.reason, result: e.result }));
  return readLeaves(leaves, players, flo);
}

function report(args: string[]) {
  const truthArg = args.find((a) => a.startsWith("--truth="));
  const truth: Record<string, string> = truthArg ? JSON.parse(readFileSync(truthArg.slice(8), "utf8")) : {};
  const rows: Row[] = [];
  for (const f of args.filter((a) => !a.startsWith("--"))) for (const line of readFileSync(f, "utf8").split("\n")) if (line) rows.push(JSON.parse(line));
  const seen = new Set<string>();
  const score = { old: { right: 0, wrong: 0, undecided: 0 }, new: { right: 0, wrong: 0, undecided: 0 } };
  let files = 0, changed = 0, labelled = 0;
  for (const row of rows) {
    if (row.error || seen.has(row.sha256)) continue;
    seen.add(row.sha256);
    files++;
    const w3c = row.seats!.some((s) => s.isObserver && s.name === "FLO");
    const before = decide(row, false);
    const after = decide(row, w3c);
    const name = (team: number | null) => (team === null ? "?" : row.seats!.filter((s) => !s.isObserver && s.teamId === team).map((s) => s.name).join("+"));
    const winner = truth[row.sha256] ?? truth[row.gameName ?? ""];
    const hasLeaves = row.leaves!.some((e) => row.seats!.some((s) => !s.isObserver && s.playerId === e.playerId));
    if (winner && hasLeaves) {
      labelled++;
      for (const [k, r] of [["old", before], ["new", after]] as const) {
        if (r.winnerTeamId === null) score[k].undecided++;
        else if (name(r.winnerTeamId).split("+").includes(winner)) score[k].right++;
        else score[k].wrong++;
      }
    }
    if (before.winnerTeamId !== after.winnerTeamId || before.confidence !== after.confidence) {
      changed++;
      console.log(`${w3c ? "W3C" : "OTHER"} ${row.file}\n  ${row.gameName}: ${name(before.winnerTeamId)} (${before.method}, ${before.confidence}) -> ${name(after.winnerTeamId)} (${after.method}, ${after.confidence})${winner ? `; truth: ${winner}` : ""}\n  ${row.leaves!.map((e) => `${e.playerId}:${e.reason.slice(0, 2)}/${e.result.slice(0, 2)}@${e.atMs}`).join(" ")}`);
    }
  }
  console.log(`${files} different files, ${changed} with another result or confidence`);
  if (truthArg) console.log(`labelled files with leave records: ${labelled}\n  rule up to 0.2.5: ${JSON.stringify(score.old)}\n  0.3.0 rule:       ${JSON.stringify(score.new)}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "dump" && rest.length >= 2) await dump(rest[0], rest.slice(1));
else if (cmd === "report" && rest.length >= 1) report(rest);
else throw new Error("usage: w3c-result-study.ts dump <out.jsonl> <folder>... | report <dump.jsonl>... [--truth=<truth.json>]");
