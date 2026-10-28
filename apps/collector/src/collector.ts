// The background service: archive + analyze new replays, react to Warcraft III starting. When it
// is awake depends on Settings → Behaviour (modes.ts).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectorMode,
  firstStart,
  importLimit,
  ingestFile,
  isWarcraftRunning,
  isWindowOpen,
  type CollectorMode,
  logEvent,
  reingestAll,
  loadConfig,
  markCollectorRunning,
  mmss,
  openDb,
  paths,
  replayDirs,
  resolveLanguage,
  setLanguage,
  startOverIfNewAnalysis,
  tr,
  warcraftFolders,
  type GameRecord,
} from "@replay-altar/core";
import { simNotReady, syncMapCache } from "@replay-altar/sim";
import { OfficialQueue } from "./officialqueue.ts";
import { SimQueue } from "./simqueue.ts";
import { notify, openDesktop, watchWarcraft } from "./system.ts";
import { ReplayWatcher } from "./watcher.ts";
import { archiveLookup } from "./archive.ts";
import { firstRun } from "./firstrun.ts";
import { progressWriter } from "./progress.ts";
import { backToWaiting, holdSimulations, waitForWake, wanted, type Wake } from "./modes.ts";
import { setTimeout as sleep } from "node:timers/promises";

const log = (msg: string) => console.log(`[replay-altar] ${msg}`);

function describe(r: GameRecord) {
  const me = r.players.find((p) => p.isMe);
  const opp = r.players.find((p) => p.playerId === r.classification.opponentId);
  const result = r.result.me === "win" ? tr("Win", "Vitória", "Victoria", "Victoire") : r.result.me === "loss" ? tr("Loss", "Derrota", "Derrota", "Défaite") : tr("Game", "Partida", "Partida", "Partie");
  const map = r.game.map.file.replace(/^\(\d+\)|\.w3x$/g, "").replace(/_/g, " ");
  return {
    title: `${result} ${tr("vs", "contra", "contra", "contre")} ${opp?.name.replace(/#\d+$/, "") ?? "?"}`,
    body: `${me?.race ?? "?"}v${opp?.race ?? "?"} · ${map} · ${mmss(r.game.durationMs)}`,
  };
}

export async function runCollector() {
  const p = paths();
  mkdirSync(p.root, { recursive: true });
  markCollectorRunning();
  // Read once: changing it in Settings restarts the collector.
  const mode = collectorMode(loadConfig());
  let stop: () => void = () => {};
  const shutdown = () => {
    log("stopping");
    stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  for (let first = true; ; first = false) {
    let wake: Wake | null = null;
    if (mode === "game") {
      log(first ? "waiting for Warcraft III (or the window) before doing anything" : "nothing left to do: waiting for Warcraft III again");
      wake = await waitForWake((warcraftToo) => ({ warcraft: warcraftToo && isWarcraftRunning(), window: isWindowOpen() }), (ms) => sleep(ms));
      log(wake === "window" ? "the window opened: awake" : "Warcraft III is running: awake");
    }
    await new Promise<void>((asleep) => {
      void awake(mode, wake, first, asleep, (fn) => (stop = fn));
    });
    stop = () => {};
  }
}

/**
 * Archives and analyzes replays until `asleep` (a "game" collector with nothing left to do; the
 * others stay awake). `onStop`: how to close everything when the process is asked to stop.
 */
async function awake(mode: CollectorMode, wake: Wake | null, first: boolean, asleep: () => void, onStop: (fn: () => void) => void) {
  const p = paths();
  // Games made by an older analysis: the match list starts over (analysis.ts), before anything else.
  const over = startOverIfNewAnalysis(p);
  if (over) log(`new analysis: the match list starts over (${over.games} games out, ${(over.freedBytes / 1e6).toFixed(0)} MB freed; ${over.archived} archived replays and ${over.officialKept} W3Champions statistics kept; previous database in ${over.backup ?? "-"})`);
  const found = replayDirs(loadConfig());
  const writeProgress = progressWriter(p.root);
  const config = await firstRun(loadConfig(), found, log, (setup) => writeProgress({ setup, import: null, sims: null }));
  setLanguage(resolveLanguage(config.language));
  const db = openDb(p.db);
  // Before anything is imported: a database with games already means an update.
  const start = firstStart(db);
  const ctx = { db, config, paths: p };
  // Your battletags changed (confirmed or edited in Settings, which restarts the collector): sort
  // the archived games again, so the ones you played count as yours.
  const applied = join(p.root, "accounts-applied.json");
  const accountsKey = JSON.stringify([...config.accounts].sort());
  if (!existsSync(applied) || readFileSync(applied, "utf8") !== accountsKey) {
    writeProgress({ setup: "accounts", import: null, sims: null });
    const out = await reingestAll(ctx);
    log(`battletags ${config.accounts.join(", ") || "(none)"}: re-sorted ${out.games} archived games`);
    writeFileSync(applied, accountsKey);
    writeProgress({ setup: null, import: null, sims: null });
  }
  // Warcraft III as last seen (every few seconds): "game" mode holds simulations while it runs.
  let warcraft = isWarcraftRunning();
  const sims = new SimQueue(ctx, log, () => holdSimulations(warcraft));
  const officials = new OfficialQueue(ctx, log);
  const dirs = replayDirs(config);
  if (dirs.length === 0) log(`no replay folders found under ${warcraftFolders(config).join(", ") || "Documents/Warcraft III"}; add yours in Settings`);

  // Imported (a replay in the folders, or the archived copy a game was imported from), or found
  // unreadable already in this run (it would be read again at every scan).
  const knownFile = db.prepare("SELECT game_key FROM files WHERE path = ? AND size = ? AND mtime = ? UNION ALL SELECT game_key FROM games WHERE archive_path = ? LIMIT 1");
  const unreadable = new Set<string>();
  const fileId = (path: string, size: number, mtime: string) => `${path}|${size}|${mtime}`;
  const watcher = new ReplayWatcher(
    dirs,
    async (path, origin) => {
      const out = await ingestFile(ctx, path);
      if (out.status === "duplicate") return;
      if (out.status === "error") {
        try {
          const s = statSync(path);
          unreadable.add(fileId(path, s.size, s.mtime.toISOString()));
        } catch {
          // gone
        }
        return log(`${path}: ${out.error}`);
      }
      const r = out.record;
      log(`${out.status} ${r.gameKey.slice(0, 8)} ${r.classification.source}/${r.classification.category} analyzed=${r.classification.analyzed} from ${path}`);
      if (out.needsSim) sims.add(r.gameKey);
      // Never looked up (a game imported again after a start-over keeps what was found before).
      if (out.status === "new" && !r.official && r.classification.source === "w3champions" && r.classification.analyzed && config.fetchOfficialStats !== false) officials.add(r.gameKey);
      // Notify only for a game that just ended while we were watching. A rescan can find a
      // game from minutes ago, and its notification would land in the middle of the next match.
      const fresh = Date.now() - Date.parse(r.game.endedAt) < 10 * 60_000;
      if (origin === "event" && out.status === "new" && fresh && r.classification.analyzed && config.notifyAfterGame) {
        const { title, body } = describe(r);
        const clicked = await notify(title, body, { id: "open", label: tr("Open report", "Abrir análise", "Abrir análisis", "Ouvrir l'analyse") });
        if (clicked === "open") openDesktop([`--game=${r.gameKey}`]);
      }
    },
    log,
    {
      // New games always; the replays that were there before the first start only once you ask
      // on the match list (an update keeps the newest ones it had imported by itself).
      since: new Date(start.at),
      limit: importLimit(config, start),
      known: (path, size, mtime) => unreadable.has(fileId(path, size, mtime)) || ((knownFile.get(path, size, mtime, path) as { game_key: string } | undefined)?.game_key ?? null),
      onScan: (r) => {
        const file = join(p.root, "replays.json");
        const body = JSON.stringify(r);
        let before = "";
        try {
          before = readFileSync(file, "utf8");
        } catch {
          // first scan
        }
        writeFileSync(file, body);
        // The window offers to import them: it hears when the count changed.
        if (body !== before) logEvent(p, { type: "scanned", ...r });
      },
      archive: { dir: p.archive, lookup: archiveLookup(p) },
    },
  );
  // Extracted maps live in the data folder; WC3V reads them from the install, which an update
  // replaced: put them back before anything is simulated.
  try {
    const moved = syncMapCache(p.root);
    if (moved.restored || moved.saved) log(`maps: ${moved.restored} restored from the data folder, ${moved.saved} saved to it`);
    if (moved.repaired) log(`maps: start positions read again for ${moved.repaired} map(s) an older version misread`);
  } catch (e) {
    log(`maps: ${(e as Error).message}`);
  }
  watcher.start();
  watcher.scanAll(); // backfill + anything played while we were down
  sims.backfill();
  // W3Champions statistics still missing for recent games: their later tries were lost if the
  // collector went back to waiting or stopped meanwhile.
  if (config.fetchOfficialStats !== false) {
    const n = officials.catchUp();
    if (n) log(`W3Champions statistics: ${n} recent game(s) to look up again`);
  }
  // Games that failed for a reason outside the replay are simulated again: missing game data
  // whenever it's there now (it appears once the game is installed), and map failures once per
  // version, which may have fixed them (the 0.1 Windows builds couldn't prepare any map).
  // Once per run of the collector (a "game" one wakes up often).
  if (first) {
    const version = process.env.REPLAY_ALTAR_VERSION;
    const retried = join(p.root, "sims-retried.txt");
    const newVersion = !!version && (!existsSync(retried) || readFileSync(retried, "utf8") !== version);
    if (!simNotReady(p.root)) sims.retryFailed(newVersion ? /^(map |game data|WC3V)/ : /^(game data|WC3V)/);
    if (newVersion) writeFileSync(retried, version);
  }

  // Progress for the window: the replays found at start (later rescans find known files and
  // would only flash a bar), then the simulations.
  const importTotal = watcher.pendingCount;
  let importing = importTotal > 0;
  const progress = setInterval(() => {
    if (importing && watcher.pendingCount === 0) importing = false;
    writeProgress({ setup: null, import: importing ? { done: importTotal - watcher.pendingCount, total: importTotal } : null, sims: sims.progress });
  }, 1000);

  const onWarcraftStart = () => {
    log("Warcraft III started");
    if (config.openWindowOnGameStart) openDesktop(["--background"]);
  };
  // Woken up by the game starting: what the watch below would have seen.
  if (wake === "warcraft started") onWarcraftStart();
  let lastWanted = Date.now();
  const wc3 = watchWarcraft(
    () => {
      warcraft = true;
      onWarcraftStart();
    },
    () => {
      warcraft = false;
      log("Warcraft III stopped");
      sims.resume(); // the simulations held during the match
    },
    warcraft,
    () => {
      // Back to waiting once nothing has wanted us awake for a while and the work is done.
      const now = Date.now();
      if (wanted(mode, { warcraft, window: isWindowOpen() })) lastWanted = now;
      else if (backToWaiting(mode, now, lastWanted, watcher.pendingCount > 0 || sims.pending > 0)) {
        close();
        asleep();
      }
    },
  );

  function close() {
    watcher.stop();
    clearInterval(wc3);
    clearInterval(progress);
    writeProgress({ setup: null, import: null, sims: null });
    db.close();
  }
  onStop(close);
  log(`running; data in ${p.root}`);
}
