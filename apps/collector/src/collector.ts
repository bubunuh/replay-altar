// The always-on service: archive + analyze new replays, react to Warcraft III starting.
import { mkdirSync } from "node:fs";
import { ingestFile, loadConfig, markCollectorRunning, mmss, openDb, paths, replayDirs, resolveLanguage, setLanguage, tr, warcraftFolders, type GameRecord } from "@replay-altar/core";
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
  const result = r.result.me === "win" ? tr("Win", "Vitória") : r.result.me === "loss" ? tr("Loss", "Derrota") : tr("Game", "Partida");
  const map = r.game.map.file.replace(/^\(\d+\)|\.w3x$/g, "").replace(/_/g, " ");
  return {
    title: `${result} ${tr("vs", "contra")} ${opp?.name.replace(/#\d+$/, "") ?? "?"}`,
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
  markCollectorRunning();
  const ctx = { db, config, paths: p };
  const sims = new SimQueue(ctx, log);
  const officials = new OfficialQueue(ctx, log);
  const dirs = replayDirs(config);
  if (dirs.length === 0) log(`no replay folders found under ${warcraftFolders(config).join(", ") || "Documents/Warcraft III"}; add yours in Settings`);

  const watcher = new ReplayWatcher(
    dirs,
    async (path, origin) => {
      const out = await ingestFile(ctx, path);
      if (out.status === "duplicate") return;
      if (out.status === "error") return log(`${path}: ${out.error}`);
      const r = out.record;
      log(`${out.status} ${r.gameKey.slice(0, 8)} ${r.classification.source}/${r.classification.category} analyzed=${r.classification.analyzed} from ${path}`);
      if (out.needsSim) sims.add(r.gameKey);
      if (out.status === "new" && r.classification.source === "w3champions" && r.classification.analyzed) officials.add(r.gameKey);
      // Notify only for a game that just ended while we were watching. A rescan can find a
      // game from minutes ago, and its notification would land in the middle of the next match.
      const fresh = Date.now() - Date.parse(r.game.endedAt) < 10 * 60_000;
      if (origin === "event" && out.status === "new" && fresh && r.classification.analyzed && config.notifyAfterGame) {
        const { title, body } = describe(r);
        const clicked = await notify(title, body, { id: "open", label: tr("Open report", "Abrir análise") });
        if (clicked === "open") openDesktop([`--game=${r.gameKey}`]);
      }
    },
    log,
  );
  watcher.start();
  watcher.scanAll(); // backfill + anything played while we were down
  sims.backfill();

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
