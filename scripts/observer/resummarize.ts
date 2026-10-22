// Research: re-summarizes the games of observer batches (their manifest.json) with the current
// summary code, so scripts/observer/batch-compare.py measures it ("today" column).
//
//   node scripts/observer/resummarize.ts <batch folder>...
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applySim, loadConfig, openDb, paths, readRecord, referencePaths } from "@replay-altar/core";
import { CONSTANTS, gamedataDir, loadCosts, readSimOutput, selectionsOf, summarize } from "@replay-altar/sim";
import { openReference } from "@replay-altar/reference";

const config = loadConfig();
const costs = loadCosts(gamedataDir(paths().root));
const groups = readdirSync(join(paths().root, "reference"));
const contextFor = (key: string) => {
  const mine = paths();
  if (existsSync(join(mine.games, `${key}.json`)) && readRecord(mine, key)?.sim?.status === "ok") return { db: openDb(mine.db), paths: mine, config };
  for (const g of groups) {
    const rp = referencePaths(g);
    if (existsSync(join(rp.games, `${key}.json`)) && readRecord(rp, key)?.sim?.status === "ok") return openReference(g, config);
  }
  return null;
};
let n = 0;
for (const batch of process.argv.slice(2)) {
  for (const { key } of JSON.parse(readFileSync(join(batch, "manifest.json"), "utf8")) as { key: string }[]) {
    const ctx = contextFor(key);
    const record = ctx && readRecord(ctx.paths, key);
    if (!ctx || record?.sim?.status !== "ok") continue;
    const { ranAt, runMs, outputPath } = record.sim;
    applySim(ctx, key, summarize(record, readSimOutput(outputPath), costs, CONSTANTS, { ranAt, runMs, outputPath }, await selectionsOf(record.provenance.archivePath)));
    n++;
  }
}
console.log(`re-summarized ${n} games`);
