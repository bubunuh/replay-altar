#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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
} from "@replay-altar/core";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { activeReferenceGroups, applyOfficial, applySim, collectorState, readRecord, referencePaths, type RefLookup } from "@replay-altar/core";
import { CONSTANTS, gamedataDir, loadCosts, readSimOutput, simNotReady, simulateGame, summarize } from "@replay-altar/sim";
import { buildProfile, officialForMatch, officialForOwnGame, openReference, readState, refreshGroup, w3cClient } from "@replay-altar/reference";
import { rulesBook } from "@replay-altar/rules";
import { currentReplayBuild, racesPlayed } from "./reference.ts";
import { runCollector } from "./collector.ts";
import { isReplayFile } from "./watcher.ts";
import { install, resume, suspend, uninstall } from "./install.ts";
import { extractGameData } from "./gamedata.ts";

const HELP = `replay-altar — Warcraft III replay archive & stats

  replay-altar install             set up the background collector, launchers and desktop icon
  replay-altar suspend             stop the collector and keep it from starting at login
  replay-altar resume              start it again
  replay-altar uninstall [--purge] remove service, launchers and icons (--purge also deletes archive, stats, settings)
  replay-altar status              collector state and recent games
  replay-altar scan                ingest every replay in your replay folders now
  replay-altar ingest <file.w3g>…  ingest specific files
  replay-altar reingest            rebuild all stats from the archived replays
  replay-altar override <game> win|loss   correct a detected result (kept as an annotation)
  replay-altar export --jsonl [--out f]   one JSON line per analyzed game (for LLMs/scripts)
  replay-altar export --md <game|latest>  one game as Markdown
  replay-altar setup-sim           prepare the economy simulation (WC3V, its packages, game data from your install)
  replay-altar sim                 simulation status
  replay-altar sim --backfill      simulate analyzed games that have no simulation yet
  replay-altar sim --retry-failed  simulate games whose simulation failed
  replay-altar sim --rerun         simulate every analyzed game again
  replay-altar sim --resummarize   recompute economy numbers from stored simulations (after a model update)
  replay-altar sim <game>          simulate one game
  replay-altar ref                 pro reference games: status
  replay-altar ref refresh [--target N] [--group id|--all]   download recent tournament games from warcraft3.info
                              until each of your races has its target (same as "Update pro games")
  replay-altar ref profile         rebuild the reference statistics from stored games
  replay-altar official            fetch the game's own end-of-game stats from W3Champions for W3C games
                              (yours and reference games) that don't have them yet
  replay-altar report <game|latest> the rules' report of one game: recap, findings with causes and advice, turning point
  replay-altar report <game> --facts  the fact sheet behind the report
  replay-altar collector           run the collector in the foreground (what the service runs)
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
    const c = ctx();
    const out = await reingestAll(c);
    console.log(`rebuilt ${out.games} games`);
    for (const e of out.errors) console.error(e);
    // Reference groups use the same pipeline: rebuild them and their statistics too.
    const costs = simNotReady(c.paths.root) ? null : loadCosts(gamedataDir(c.paths.root));
    for (const g of activeReferenceGroups(c.config, racesPlayed(c.db))) {
      const ref = openReference(g.id, c.config);
      const res = await reingestAll(ref);
      if (costs) {
        for (const { game_key } of ref.db.prepare("SELECT game_key FROM games WHERE sim_status = 'ok'").all() as { game_key: string }[]) {
          const record = readRecord(ref.paths, game_key);
          if (record?.sim?.status !== "ok") continue;
          const { ranAt, runMs, outputPath } = record.sim;
          applySim(ref, game_key, summarize(record, readSimOutput(outputPath), costs, CONSTANTS, { ranAt, runMs, outputPath }));
        }
      }
      const p = buildProfile(ref.db, ref.paths, g, currentReplayBuild(c.db));
      console.log(`reference ${g.id}: rebuilt ${res.games} games; profile from ${p.games}`);
      for (const e of res.errors) console.error(e);
    }
    break;
  }
  case "override": {
    const [ref, result] = args;
    if (!ref || !["win", "loss"].includes(result)) throw new Error("usage: replay-altar override <game> win|loss");
    const { db } = ctx();
    const key = resolveKey(db, ref);
    addAnnotation(db, { gameKey: key, kind: "result_override", source: "user", author: "cli", body: { result } });
    console.log(`${key.slice(0, 8)} is now a ${result}`);
    break;
  }
  case "export": {
    const c = ctx();
    // Pro comparison: the profile of pros playing the race you played in that game.
    const profiles = new Map(
      c.config.reference.groups.flatMap((g) => {
        const file = join(referencePaths(g.id).root, "profile.json");
        return existsSync(file) ? [[g.race, { label: g.label, profile: JSON.parse(readFileSync(file, "utf8")) }] as const] : [];
      }),
    );
    const refLookup: RefLookup = (mu) => {
      const found = mu ? profiles.get(mu[0] as "H" | "O" | "U" | "N") : undefined;
      if (!found) return null;
      const key = mu && found.profile.matchups[mu]?.n >= 10 ? mu : "all";
      const mp = found.profile.matchups[key];
      return mp ? { label: found.label, matchup: key, games: mp.n, metrics: mp.metrics } : null;
    };
    if (args[0] === "--md") {
      const md = exportMarkdown(c.db, c.paths, resolveKey(c.db, args[1] ?? "latest"), refLookup);
      console.log(md);
    } else {
      const out = exportJsonl(c.db, c.paths, refLookup);
      const i = args.indexOf("--out");
      if (i >= 0) writeFileSync(args[i + 1], out + "\n");
      else console.log(out);
    }
    break;
  }
  case "setup-sim": {
    const root = join(import.meta.dirname, "../../..");
    // npm is a .cmd script on Windows, which only runs through the shell.
    const run = (cmd: string, cmdArgs: string[], cwd = root, shell = false) => {
      console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
      execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit", shell });
    };
    if (!existsSync(join(root, "vendor/wc3v/wc3v.js"))) run("git", ["submodule", "update", "--init", "--depth", "1", "vendor/wc3v"]);
    if (!existsSync(join(root, "vendor/wc3v/node_modules/w3gjs"))) run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], join(root, "vendor/wc3v"), process.platform === "win32");
    extractGameData();
    const problem = simNotReady(paths().root);
    console.log(problem ? `Not ready: ${problem}` : "Simulation ready. Run `replay-altar sim --backfill` to simulate existing games.");
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
      // Yours, then every reference group (their profiles are rebuilt after).
      // Also the rule-review sample (scripts/review-sample.ts), when there is one.
      const review = existsSync(referencePaths("review").db) ? [{ name: "review", ctx: openReference("review", c.config) }] : [];
      const contexts = [{ name: "your", ctx: c as { db: typeof c.db; paths: typeof c.paths } }, ...c.config.reference.groups.map((g) => ({ name: g.id, ctx: openReference(g.id, c.config), group: g })), ...review];
      for (const { name, ctx, ...rest } of contexts) {
        const rows = ctx.db.prepare("SELECT game_key FROM games WHERE sim_status = 'ok'").all() as { game_key: string }[];
        for (const { game_key } of rows) {
          const record = readRecord(ctx.paths, game_key);
          if (!record || record.sim?.status !== "ok") continue;
          const { ranAt, runMs, outputPath } = record.sim;
          applySim(ctx as Parameters<typeof applySim>[0], game_key, summarize(record, readSimOutput(outputPath), costs, CONSTANTS, { ranAt, runMs, outputPath }));
        }
        const group = (rest as { group?: (typeof c.config.reference.groups)[number] }).group;
        if (group && rows.length) buildProfile(ctx.db, ctx.paths, group, currentReplayBuild(c.db));
        if (rows.length) console.log(`re-summarized ${rows.length} ${name === "your" ? "of your" : name} games with economy model v${CONSTANTS.version}`);
      }
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
    // With --group: that group; --all: every race (for research); otherwise the races you play.
    const groups =
      gi >= 0 ? config.reference.groups.filter((g) => g.id === args[gi + 1])
      : args.includes("--all") ? config.reference.groups
      : activeReferenceGroups(config, racesPlayed(openDb(paths().db)));
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
      console.log(`current replay build: ${build ?? "unknown (no games yet)"}; update with \`replay-altar ref refresh\` or "Update pro games" in Settings`);
      for (const g of groups) {
        const ref = openReference(g.id, config);
        const st = readState(ref.paths.root);
        const n = (ref.db.prepare("SELECT COUNT(*) n FROM ref_matches").get() as { n: number }).n;
        const sims = ref.db.prepare("SELECT COALESCE(sim_status, 'none') s, COUNT(*) n FROM games GROUP BY 1").all() as { s: string; n: number }[];
        const byMu = ref.db.prepare("SELECT ? || 'v' || opp_race mu, COUNT(*) n FROM ref_matches GROUP BY 1").all(g.race) as { mu: string; n: number }[];
        console.log(`${g.label} [${g.id}]: ${n}/${g.target} games (${byMu.map((x) => `${x.mu} ${x.n}`).join(", ") || "none"}); simulations ${sims.map((x) => `${x.s} ${x.n}`).join(", ") || "none"}`);
        console.log(`  last refresh: ${st.lastRefreshAt ?? "never"}; data in ${ref.paths.root}`);
      }
    }
    break;
  }
  case "official": {
    const c = ctx();
    const client = w3cClient({ log: (m) => console.log(m) });
    const pause = () => new Promise((r) => setTimeout(r, 2000)); // gentle on W3Champions
    let ok = 0;
    let missing = 0;
    // Yours: W3Champions games without stats (or with a not-yet-found note).
    for (const { game_key } of c.db.prepare("SELECT game_key FROM games WHERE source = 'w3champions' AND analyzed = 1").all() as { game_key: string }[]) {
      const record = readRecord(c.paths, game_key);
      if (!record || record.official?.status === "ok") continue;
      const prev = record.official?.status === "missing" ? record.official.attempts : 0;
      const off = await officialForOwnGame(client, record, prev);
      applyOfficial(c, game_key, off);
      if (off.status === "ok") ok++;
      else missing++;
      console.log(`${game_key.slice(0, 8)} ${off.status === "ok" ? `match ${off.matchId}` : off.reason}`);
      await pause();
    }
    // Reference groups: the W3C match id is known.
    for (const g of activeReferenceGroups(c.config, racesPlayed(c.db))) {
      const ref = openReference(g.id, c.config);
      for (const { game_key, w3c_match_id } of ref.db.prepare("SELECT game_key, w3c_match_id FROM ref_matches WHERE w3c_match_id NOT LIKE 'w3info:%'").all() as { game_key: string; w3c_match_id: string }[]) {
        const record = readRecord(ref.paths, game_key);
        if (!record || record.official?.status === "ok") continue;
        const off = await officialForMatch(client, w3c_match_id, record);
        applyOfficial(ref, game_key, off);
        if (off.status === "ok") ok++;
        else missing++;
        await pause();
      }
      buildProfile(ref.db, ref.paths, g, currentReplayBuild(c.db));
    }
    console.log(`official stats: ${ok} fetched, ${missing} not available`);
    break;
  }
  case "status": {
    const { db } = ctx();
    const state = collectorState();
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
  case "report": {
    const c = ctx();
    const target = args.find((a) => !a.startsWith("--")) ?? "latest";
    const key =
      target === "latest"
        ? (c.db.prepare("SELECT game_key FROM games WHERE analyzed = 1 ORDER BY played_at DESC LIMIT 1").get() as { game_key: string }).game_key
        : resolveKey(c.db, target);
    const b = rulesBook(c.db, c.paths, key);
    if (b.problem) throw new Error(b.problem);
    if (args.includes("--facts")) {
      console.log(b.facts);
      break;
    }
    console.log(`${b.recap}\n`);
    b.findings.forEach((f, i) => {
      console.log(`${i + 1}. ${f.headline}`);
      for (const e of f.evidence) console.log(`   - ${e}`);
      for (const e of f.because ?? []) console.log(`   Why: ${e}`);
      if (f.advice) console.log(`   Next time: ${f.advice}`);
      console.log("");
    });
    if (b.turningPoint) console.log(`Turning point: ${b.turningPoint}\n`);
    if (b.oneThing) console.log(`One thing for next game: ${b.oneThing}`);
    break;
  }
  default:
    console.log(HELP);
}
