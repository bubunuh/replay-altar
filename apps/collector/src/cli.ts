#!/usr/bin/env node
import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addAnnotation,
  exportJsonl,
  exportMarkdown,
  ingestFile,
  loadConfig,
  mmss,
  openDb,
  paths,
  reingestAll,
  replayDirs,
} from "@w3stats/core";
import { runCollector } from "./collector.ts";
import { isReplayFile } from "./watcher.ts";
import { install, resume, suspend, uninstall } from "./install.ts";

const HELP = `w3stats — Warcraft III replay archive & stats

  w3stats install             set up the background collector, launchers and desktop icon
  w3stats suspend             stop the collector and keep it from starting at login
  w3stats resume              start it again
  w3stats uninstall [--purge] remove service, launchers and icons (--purge also deletes archive, stats, settings)
  w3stats status              collector state and recent games
  w3stats scan                ingest every replay in your replay folders now
  w3stats ingest <file.w3g>…  ingest specific files
  w3stats reingest            rebuild all stats from the archived replays
  w3stats override <game> win|loss   correct a detected result (kept as an annotation)
  w3stats export --jsonl [--out f]   one JSON line per analyzed game (for LLMs/scripts)
  w3stats export --md <game|latest>  one game as Markdown
  w3stats collector           run the collector in the foreground (what the service runs)
`;

const [cmd, ...args] = process.argv.slice(2);
const ctx = () => ({ db: openDb(paths().db), config: loadConfig(), paths: paths() });
const resolveKey = (db: ReturnType<typeof openDb>, ref: string) => {
  const row = (ref === "latest"
    ? db.prepare("SELECT game_key FROM games ORDER BY played_at DESC LIMIT 1").get()
    : db.prepare("SELECT game_key FROM games WHERE game_key LIKE ? || '%'").get(ref)) as { game_key: string } | undefined;
  if (!row) throw new Error(`no game matches ${ref}`);
  return row.game_key;
};

switch (cmd) {
  case "collector":
    await runCollector();
    break;
  case "install":
    install();
    break;
  case "suspend":
    suspend();
    break;
  case "resume":
    resume();
    break;
  case "uninstall":
    uninstall(args.includes("--purge"));
    break;
  case "scan":
  case "ingest": {
    const c = ctx();
    const files =
      cmd === "ingest"
        ? args.map((a) => resolve(a))
        : replayDirs(c.config).flatMap((d) =>
            readdirSync(d).filter(isReplayFile).map((f) => `${d}/${f}`),
          );
    const counts: Record<string, number> = {};
    for (const f of files) {
      const out = await ingestFile(c, f);
      counts[out.status] = (counts[out.status] ?? 0) + 1;
      if (out.status === "error") console.error(`${f}: ${out.error}`);
    }
    console.log(Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "no replays found");
    break;
  }
  case "reingest": {
    const out = await reingestAll(ctx());
    console.log(`rebuilt ${out.games} games`);
    for (const e of out.errors) console.error(e);
    break;
  }
  case "override": {
    const [ref, result] = args;
    if (!ref || !["win", "loss"].includes(result)) throw new Error("usage: w3stats override <game> win|loss");
    const { db } = ctx();
    const key = resolveKey(db, ref);
    addAnnotation(db, { gameKey: key, kind: "result_override", source: "user", author: "cli", body: { result } });
    console.log(`${key.slice(0, 8)} is now a ${result}`);
    break;
  }
  case "export": {
    const c = ctx();
    if (args[0] === "--md") {
      const md = exportMarkdown(c.db, c.paths, resolveKey(c.db, args[1] ?? "latest"));
      console.log(md);
    } else {
      const out = exportJsonl(c.db, c.paths);
      const i = args.indexOf("--out");
      if (i >= 0) writeFileSync(args[i + 1], out + "\n");
      else console.log(out);
    }
    break;
  }
  case "status": {
    const { db } = ctx();
    const { execFileSync } = await import("node:child_process");
    let state = "not installed";
    try {
      state = execFileSync("systemctl", ["--user", "is-active", "w3stats-collector.service"], { encoding: "utf8" }).trim();
    } catch (e) {
      state = ((e as { stdout?: string }).stdout ?? "").trim() || state;
    }
    const totals = db.prepare("SELECT COUNT(*) total, SUM(analyzed) analyzed FROM games").get() as { total: number; analyzed: number };
    console.log(`collector: ${state}\ndata: ${paths().root}\ngames: ${totals.total} archived, ${totals.analyzed ?? 0} analyzed\n`);
    const recent = db.prepare("SELECT played_at, result, matchup, map_name, opp_name, duration_ms, source, analyzed, skip_reason FROM v_games ORDER BY played_at DESC LIMIT 10").all() as Record<string, string | number>[];
    for (const g of recent) {
      console.log(
        `${new Date(String(g.played_at)).toLocaleString("sv-SE").slice(0, 16)}  ${g.analyzed ? String(g.result).padEnd(7) : `skip:${g.skip_reason}`.padEnd(7)} ${String(g.matchup ?? "").padEnd(4)} ${String(g.map_name).padEnd(16)} ${String(g.opp_name ?? "").padEnd(20)} ${mmss(Number(g.duration_ms))}  ${g.source}`,
      );
    }
    break;
  }
  default:
    console.log(HELP);
}
