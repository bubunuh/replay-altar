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
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { applySim, readRecord } from "@w3stats/core";
import { CONSTANTS, gamedataDir, loadCosts, readSimOutput, simNotReady, simulateGame, summarize } from "@w3stats/sim";
import { buildProfile, openReference, readState, refreshGroup } from "@w3stats/reference";
import { currentReplayBuild } from "./reference.ts";
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
  w3stats setup-sim           prepare the economy simulation (WC3V, its packages, game data from your install)
  w3stats sim                 simulation status
  w3stats sim --backfill      simulate analyzed games that have no simulation yet
  w3stats sim --retry-failed  simulate games whose simulation failed
  w3stats sim --rerun         simulate every analyzed game again
  w3stats sim --resummarize   recompute economy numbers from stored simulations (after a model update)
  w3stats sim <game>          simulate one game
  w3stats ref                 reference groups (pro games from W3Champions): status
  w3stats ref refresh [--target N] [--group id]   download/simulate missing reference games now
  w3stats ref profile         rebuild the reference statistics from stored games
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
  case "setup-sim": {
    const root = join(import.meta.dirname, "../../..");
    const run = (cmd: string, cmdArgs: string[], cwd = root) => {
      console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
      execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
    };
    if (!existsSync(join(root, "vendor/wc3v/wc3v.js"))) run("git", ["submodule", "update", "--init", "--depth", "1", "vendor/wc3v"]);
    if (!existsSync(join(root, "vendor/wc3v/node_modules/w3gjs"))) run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], join(root, "vendor/wc3v"));
    run(join(root, "scripts/extract-gamedata.sh"), []);
    const problem = simNotReady(paths().root);
    console.log(problem ? `Not ready: ${problem}` : "Simulation ready. Run `w3stats sim --backfill` to simulate existing games.");
    break;
  }
  case "sim": {
    const c = ctx();
    const flag = args[0];
    if (!flag) {
      const rows = c.db.prepare("SELECT COALESCE(sim_status, 'not simulated') status, COUNT(*) n FROM games WHERE analyzed = 1 GROUP BY 1").all() as { status: string; n: number }[];
      console.log(simNotReady(c.paths.root) ?? "simulation ready");
      for (const r of rows) console.log(`${String(r.n).padStart(4)}  ${r.status}`);
      const failed = c.db.prepare("SELECT game_key, sim_reason FROM games WHERE sim_status = 'failed' LIMIT 10").all() as { game_key: string; sim_reason: string }[];
      for (const f of failed) console.log(`      ${f.game_key.slice(0, 8)} failed: ${f.sim_reason}`);
      break;
    }
    if (flag === "--resummarize") {
      const costs = loadCosts(gamedataDir(c.paths.root));
      const rows = c.db.prepare("SELECT game_key FROM games WHERE sim_status = 'ok'").all() as { game_key: string }[];
      for (const { game_key } of rows) {
        const record = readRecord(c.paths, game_key);
        if (!record || record.sim?.status !== "ok") continue;
        const { ranAt, runMs, outputPath } = record.sim;
        applySim(c, game_key, summarize(record, readSimOutput(outputPath), costs, CONSTANTS, { ranAt, runMs, outputPath }));
      }
      console.log(`re-summarized ${rows.length} games with economy model v${CONSTANTS.version}`);
      break;
    }
    const where =
      flag === "--backfill" ? "analyzed = 1 AND sim_status IS NULL"
      : flag === "--retry-failed" ? "analyzed = 1 AND sim_status = 'failed'"
      : flag === "--rerun" ? "analyzed = 1"
      : null;
    const keys = where
      ? (c.db.prepare(`SELECT game_key FROM games WHERE ${where} ORDER BY played_at`).all() as { game_key: string }[]).map((r) => r.game_key)
      : [resolveKey(c.db, flag)];
    let i = 0;
    for (const key of keys) {
      const record = readRecord(c.paths, key);
      if (!record) continue;
      const sim = await simulateGame(record, { dataRoot: c.paths.root, warcraftDocuments: c.config.warcraftDocuments });
      applySim(c, key, sim);
      console.log(`[${++i}/${keys.length}] ${key.slice(0, 8)} ${sim.status === "ok" ? `ok in ${(sim.runMs / 1000).toFixed(1)}s${sim.warnings.length ? ` (${sim.warnings.join("; ")})` : ""}` : `failed: ${sim.reason}`}`);
    }
    break;
  }
  case "ref": {
    const config = loadConfig();
    const sub = args[0];
    const gi = args.indexOf("--group");
    const groups = config.reference.groups.filter((g) => gi < 0 || g.id === args[gi + 1]);
    const build = currentReplayBuild(openDb(paths().db));
    if (sub === "refresh") {
      const ti = args.indexOf("--target");
      for (const g of groups) {
        const res = await refreshGroup(g, {
          config,
          replayBuild: build,
          gamedataRoot: paths().root,
          target: ti >= 0 ? Number(args[ti + 1]) : undefined,
          log: (m) => console.log(m),
        });
        if (res.stopReason) console.log(`${g.id}: stopped early: ${res.stopReason}`);
        console.log(`${g.id}: +${res.downloaded} downloaded, ${res.skipped} skipped, ${res.pruned} pruned (old patch); ${res.kept} games, ${Object.keys(res.profile.matchups).filter((k) => k !== "all").map((k) => `${k} ${res.profile.matchups[k].n}`).join(", ")}`);
      }
    } else if (sub === "profile") {
      for (const g of groups) {
        const ref = openReference(g.id, config);
        const p = buildProfile(ref.db, ref.paths, g, build);
        console.log(`${g.id}: profile from ${p.games} games`);
      }
    } else {
      console.log(`current replay build: ${build ?? "unknown (no games yet)"}; refresh every ${config.reference.refreshDays} days`);
      for (const g of groups) {
        const ref = openReference(g.id, config);
        const st = readState(ref.paths.root);
        const n = (ref.db.prepare("SELECT COUNT(*) n FROM ref_matches").get() as { n: number }).n;
        const sims = ref.db.prepare("SELECT COALESCE(sim_status, 'none') s, COUNT(*) n FROM games GROUP BY 1").all() as { s: string; n: number }[];
        const byMu = ref.db.prepare("SELECT 'Hv' || opp_race mu, COUNT(*) n FROM ref_matches GROUP BY 1").all() as { mu: string; n: number }[];
        console.log(`${g.label} [${g.id}]: ${n}/${g.target} games (${byMu.map((x) => `${x.mu} ${x.n}`).join(", ") || "none"}); simulations ${sims.map((x) => `${x.s} ${x.n}`).join(", ") || "none"}`);
        console.log(`  last refresh: ${st.lastRefreshAt ?? "never"}; data in ${ref.paths.root}`);
      }
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
