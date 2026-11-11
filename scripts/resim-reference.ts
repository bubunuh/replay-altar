// Research: simulates every game of reference stores again (after a WC3V change), several at a time.
//
//   node scripts/resim-reference.ts <store> [<store> ...] [--jobs 4]
//   e.g. node scripts/resim-reference.ts pros pros-orc pros-undead pros-nightelf review validation
//
// Stores are the folders under <data>/reference. Every archived game is run, the failed ones too;
// the game's record and database row get the new summary (applySim), the WC3V output is replaced.
// Afterwards: `replay-altar ref profile --all --pool validation`, scripts/mine-principles.ts,
// `replay-altar ref publish`.
import { applySim, loadConfig, mapFolders, paths, readRecord } from "@replay-altar/core";
import { openReference } from "@replay-altar/reference";
import { simulateGame } from "@replay-altar/sim";
import { builtinMap } from "../apps/collector/src/gamedata.ts";

const args = process.argv.slice(2);
const ji = args.indexOf("--jobs");
const jobs = ji >= 0 ? Number(args[ji + 1]) : 4;
const stores = args.filter((a, i) => !a.startsWith("--") && i !== ji + 1);
const config = loadConfig();

for (const id of stores) {
  const ref = openReference(id, config);
  const keys = (ref.db.prepare("SELECT game_key FROM games ORDER BY game_key").all() as { game_key: string }[]).map((r) => r.game_key);
  let next = 0, ok = 0, failed = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < keys.length) {
      const key = keys[next++];
      const record = readRecord(ref.paths, key);
      if (!record) continue;
      const sim = await simulateGame(record, { dataRoot: ref.paths.root, gamedataRoot: paths().root, mapFolders: [...mapFolders(config), paths().maps], fromGame: builtinMap });
      applySim(ref, key, sim);
      if (sim.status === "ok") ok++;
      else {
        failed++;
        console.log(`${id} ${key.slice(0, 8)}: ${sim.reason}`);
      }
      if ((ok + failed) % 100 === 0) console.log(`${id}: ${ok + failed}/${keys.length} (${failed} failed), ${Math.round((Date.now() - started) / 60000)} min`);
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  console.log(`${id}: done, ${ok} ok, ${failed} failed of ${keys.length}, ${Math.round((Date.now() - started) / 60000)} min`);
}
