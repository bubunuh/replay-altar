// The always-on service: archive + analyze new replays, react to Warcraft III starting.
import { ingestFile, loadConfig, mmss, openDb, paths, replayDirs, type GameRecord } from "@w3stats/core";
import { scheduleReferenceRefresh } from "./reference.ts";
import { SimQueue } from "./simqueue.ts";
import { notify, openDesktop, watchWarcraft } from "./system.ts";
import { ReplayWatcher } from "./watcher.ts";

const log = (msg: string) => console.log(`[w3stats] ${msg}`);

function describe(r: GameRecord) {
  const me = r.players.find((p) => p.isMe);
  const opp = r.players.find((p) => p.playerId === r.classification.opponentId);
  const result = r.result.me === "win" ? "Win" : r.result.me === "loss" ? "Loss" : "Game";
  const map = r.game.map.file.replace(/^\(\d+\)|\.w3x$/g, "").replace(/_/g, " ");
  return {
    title: `${result} vs ${opp?.name.replace(/#\d+$/, "") ?? "?"}`,
    body: `${me?.race ?? "?"}v${opp?.race ?? "?"} · ${map} · ${mmss(r.game.durationMs)}`,
  };
}

export async function runCollector() {
  const config = loadConfig();
  const p = paths();
  const db = openDb(p.db);
  const ctx = { db, config, paths: p };
  const sims = new SimQueue(ctx, log);
  const dirs = replayDirs(config);
  if (dirs.length === 0) log(`no replay folders found under ${config.warcraftDocuments.join(", ")}`);

  const watcher = new ReplayWatcher(
    dirs,
    async (path, origin) => {
      const out = await ingestFile(ctx, path);
      if (out.status === "duplicate") return;
      if (out.status === "error") return log(`${path}: ${out.error}`);
      const r = out.record;
      log(`${out.status} ${r.gameKey.slice(0, 8)} ${r.classification.source}/${r.classification.category} analyzed=${r.classification.analyzed} from ${path}`);
      if (out.needsSim) sims.add(r.gameKey);
      // Notify only for a game that just ended while we were watching. A rescan can find a
      // game from minutes ago, and its notification would land in the middle of the next match.
      const fresh = Date.now() - Date.parse(r.game.endedAt) < 10 * 60_000;
      if (origin === "event" && out.status === "new" && fresh && r.classification.analyzed && config.notifyAfterGame) {
        const { title, body } = describe(r);
        const clicked = await notify(title, body, { id: "open", label: "Open report" });
        if (clicked === "open") openDesktop([`--game=${r.gameKey}`]);
      }
    },
    log,
  );
  watcher.start();
  watcher.scanAll(); // backfill + anything played while we were down
  sims.backfill();
  const refTimer = scheduleReferenceRefresh(config, log);

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
    clearInterval(refTimer);
    db.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  log(`running; data in ${p.root}`);
}
