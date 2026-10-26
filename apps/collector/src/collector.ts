// The always-on service: archive + analyze new replays, react to Warcraft III starting.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { firstStart, importLimit, ingestFile, reingestAll, loadConfig, markCollectorRunning, mmss, openDb, paths, replayDirs, resolveLanguage, setLanguage, tr, warcraftFolders, type GameRecord } from "@replay-altar/core";
import { simNotReady, syncMapCache } from "@replay-altar/sim";
import { OfficialQueue } from "./officialqueue.ts";
import { SimQueue } from "./simqueue.ts";
import { notify, openDesktop, watchWarcraft } from "./system.ts";
import { ReplayWatcher } from "./watcher.ts";
import { firstRun } from "./firstrun.ts";
import { progressWriter } from "./progress.ts";

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
  const found = replayDirs(loadConfig());
  mkdirSync(p.root, { recursive: true });
  const writeProgress = progressWriter(p.root);
  const config = await firstRun(loadConfig(), found, log, (setup) => writeProgress({ setup, import: null, sims: null }));
  setLanguage(resolveLanguage(config.language));
  const db = openDb(p.db);
  // Before anything is imported: a database with games already means an update.
  const start = firstStart(db);
  markCollectorRunning();
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
  const sims = new SimQueue(ctx, log);
  const officials = new OfficialQueue(ctx, log);
  const dirs = replayDirs(config);
  if (dirs.length === 0) log(`no replay folders found under ${warcraftFolders(config).join(", ") || "Documents/Warcraft III"}; add yours in Settings`);

  const knownFile = db.prepare("SELECT 1 FROM files WHERE path = ? AND size = ? AND mtime = ?");
  const watcher = new ReplayWatcher(
    dirs,
    async (path, origin) => {
      const out = await ingestFile(ctx, path);
      if (out.status === "duplicate") return;
      if (out.status === "error") return log(`${path}: ${out.error}`);
      const r = out.record;
      log(`${out.status} ${r.gameKey.slice(0, 8)} ${r.classification.source}/${r.classification.category} analyzed=${r.classification.analyzed} from ${path}`);
      if (out.needsSim) sims.add(r.gameKey);
      if (out.status === "new" && r.classification.source === "w3champions" && r.classification.analyzed && config.fetchOfficialStats !== false) officials.add(r.gameKey);
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
      known: (path, size, mtime) => !!knownFile.get(path, size, mtime),
      onScan: (r) => writeFileSync(join(p.root, "replays.json"), JSON.stringify(r)),
    },
  );
  // Extracted maps live in the data folder; WC3V reads them from the install, which an update
  // replaced: put them back before anything is simulated.
  try {
    const moved = syncMapCache(p.root);
    if (moved.restored || moved.saved) log(`maps: ${moved.restored} restored from the data folder, ${moved.saved} saved to it`);
  } catch (e) {
    log(`maps: ${(e as Error).message}`);
  }
  watcher.start();
  watcher.scanAll(); // backfill + anything played while we were down
  sims.backfill();
  // Games that failed for a reason outside the replay are simulated again: missing game data
  // whenever it's there now (it appears once the game is installed), and map failures once per
  // version, which may have fixed them (the 0.1 Windows builds couldn't prepare any map).
  const version = process.env.REPLAY_ALTAR_VERSION;
  const retried = join(p.root, "sims-retried.txt");
  const newVersion = !!version && (!existsSync(retried) || readFileSync(retried, "utf8") !== version);
  if (!simNotReady(p.root)) sims.retryFailed(newVersion ? /^(map |game data|WC3V)/ : /^(game data|WC3V)/);
  if (newVersion) writeFileSync(retried, version);

  // Progress for the window: the replays found at start (later rescans find known files and
  // would only flash a bar), then the simulations.
  const importTotal = watcher.pendingCount;
  let importing = importTotal > 0;
  const progress = setInterval(() => {
    if (importing && watcher.pendingCount === 0) importing = false;
    writeProgress({ setup: null, import: importing ? { done: importTotal - watcher.pendingCount, total: importTotal } : null, sims: sims.progress });
  }, 1000);

  const wc3 = watchWarcraft(
    () => {
      log("Warcraft III started");
      if (config.openWindowOnGameStart) openDesktop(["--background"]);
    },
    () => log("Warcraft III stopped"),
  );

  const shutdown = () => {
    log("stopping");
    watcher.stop();
    clearInterval(wc3);
    clearInterval(progress);
    writeProgress({ setup: null, import: null, sims: null });
    db.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  log(`running; data in ${p.root}`);
}
