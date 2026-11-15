// Research: the income model against Warcraft III's own gold, on the recorded games.
// For each recorded player-game (an exported folder with meta.json + observer.jsonl, see
// export-lab.py; the game's record in the "observer" reference store) it compares, at 5, 10, 15
// and 20 minutes and at the last snapshot, the model's gold mined with the game's gold_mined, the
// model's unspent gold with the game's gold, and the spending from orders with start + gold_mined
// - gold (which leaves out bounty, so the real spending is a little higher than that).
//
//   node scripts/observer/income-check.ts <exported folder>... [--gold <rate>] [--no-refusal] [--fit] [--json out.json]
//
// --gold: another gold per worker-second; --no-refusal: count every unit order as paid (the
// model before 0.2.6); --fit: the rate at which the model's gold mined matches the game's at 5
// and 10 minutes on median (W3Champions' "gold collected" is the same number as the game's gold
// mined: 15,870 against 15,860 on the first recorded ladder game).
//
// Result (0.2.6, 160 player-games of the development recordings): the rate fitted to the game's
// gold mined is 1.95 (was 1.80, fitted on W3Champions' end-of-game numbers: 8% short at 5-20
// minutes); with unit orders the gold can't pay for refused, the unspent gold is off by a median
// 106 at 5:00 and 101 at 10:00 (557 and 1149 before) and reads 0 or less in 9% and 2% of the
// player-games (72% and 76% before).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths, readRecord, referencePaths, type GameRecord } from "@replay-altar/core";
import { buildTimelines, CONSTANTS, gamedataDir, loadCosts, readSimOutput, runIncome, type EconomyConstants, type Timeline } from "@replay-altar/sim";
import { withoutNeverMade } from "../../packages/sim/src/deaths.ts";

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const costs = loadCosts(gamedataDir(paths().root));
const store = referencePaths("observer");
const obsRoot = join(paths().root, "observer");

// game id (batch4-01, batch1-02) → game key, from the batch manifests.
const keyOf = new Map<string, string>();
for (const b of readdirSync(obsRoot)) {
  const m = join(obsRoot, b, "manifest.json");
  if (!existsSync(m)) continue;
  for (const e of JSON.parse(readFileSync(m, "utf8")) as { file: string; key: string }[]) keyOf.set(`${b}-${e.file.split("_")[0].replace(/^zq/, "")}`, e.key);
}

type Snap = { game: { t: number }; players: { name: string; gold: number; gold_mined: number }[] };
type Point = { t: number | "end"; tl: Timeline; real: { gold: number; gold_mined: number } };
const points: Point[] = [];
const TIMES = [300_000, 600_000, 900_000, 1_200_000];
const folders = args.filter((a, i) => !a.startsWith("--") && !["--gold", "--json"].includes(args[i - 1]));
for (const dir of folders) {
  for (const g of readdirSync(dir)) {
    const metaFile = join(dir, g, "meta.json");
    if (!existsSync(metaFile)) continue;
    const meta = JSON.parse(readFileSync(metaFile, "utf8")) as { players: { wc3vId: number; name: string }[] };
    const key = keyOf.get(g);
    const r = key ? (readRecord(store, key) as GameRecord | null) : null;
    if (!r || r.sim?.status !== "ok") {
      console.error(`${g}: no simulated record`);
      continue;
    }
    const snaps = readFileSync(join(dir, g, "observer.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Snap);
    for (const tl of buildTimelines(withoutNeverMade(readSimOutput(r.sim.outputPath)), r, costs)) {
      const mp = meta.players.find((p) => p.wc3vId === tl.playerId);
      if (!mp) continue;
      if (args.includes("--no-refusal")) tl.spend = tl.spend.map(({ unit, ...a }) => a);
      const at = (t: number) => {
        const snap = snaps.filter((s) => s.game.t <= t).at(-1);
        return snap && t - snap.game.t <= 15_000 ? snap.players.find((p) => p.name === mp.name) : undefined;
      };
      for (const t of TIMES) {
        const real = t <= r.game.durationMs - 30_000 ? at(t) : undefined;
        if (real) points.push({ t, tl, real });
      }
      const last = snaps.at(-1)!;
      const real = last.players.find((p) => p.name === mp.name);
      if (real) points.push({ t: "end", tl: { ...tl, endMs: last.game.t }, real });
    }
  }
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN;
};
const sampleAt = (p: Point, k: EconomyConstants) => {
  const { series } = runIncome(p.tl, k);
  return p.t === "end" ? series.at(-1)! : series.filter((x) => x.t <= (p.t as number)).at(-1)!;
};

let k: EconomyConstants = opt("--gold") ? { ...CONSTANTS, goldPerWorkerSecond: Number(opt("--gold")) } : CONSTANTS;
if (args.includes("--fit")) {
  const early = points.filter((p) => p.t === 300_000 || p.t === 600_000);
  const ratio = (g: number) => median(early.map((p) => sampleAt(p, { ...k, goldPerWorkerSecond: g }).estGoldMined / p.real.gold_mined));
  let lo = 1;
  let hi = 3;
  for (let i = 0; i < 25; i++) {
    const mid = (lo + hi) / 2;
    if (ratio(mid) > 1) hi = mid;
    else lo = mid;
  }
  k = { ...k, goldPerWorkerSecond: Math.round(((lo + hi) / 2) * 1000) / 1000 };
}

const rows = points.map((p) => {
  const s = sampleAt(p, k);
  return { t: p.t, race: p.tl.race, minedModel: s.estGoldMined, minedReal: p.real.gold_mined, bankModel: s.estGoldBank, bankReal: p.real.gold, spentModel: s.goldSpent, spentReal: 500 + p.real.gold_mined - p.real.gold };
});
const r0 = (x: number) => String(Math.round(x));
console.log(`gold per worker-second ${k.goldPerWorkerSecond}${args.includes("--no-refusal") ? ", every unit order paid" : ""}; ${rows.filter((r) => r.t === "end").length} player-games`);
console.log("t       n  mined model/real  |err|  unspent model  real  |err|  model<=0  spent model/real");
for (const t of [...TIMES, "end" as const]) {
  const x = rows.filter((r) => r.t === t);
  if (!x.length) continue;
  console.log(
    (t === "end" ? "end" : `${t / 60000}m`).padEnd(5),
    String(x.length).padStart(4),
    median(x.map((r) => r.minedModel / r.minedReal)).toFixed(2).padStart(10),
    r0(median(x.map((r) => Math.abs(r.minedModel - r.minedReal)))).padStart(12),
    r0(median(x.map((r) => r.bankModel))).padStart(9),
    r0(median(x.map((r) => r.bankReal))).padStart(9),
    r0(median(x.map((r) => Math.abs(r.bankModel - r.bankReal)))).padStart(6),
    `${Math.round((100 * x.filter((r) => r.bankModel <= 0).length) / x.length)}%`.padStart(8),
    median(x.map((r) => r.spentModel / r.spentReal)).toFixed(2).padStart(10),
  );
}
console.log("\nby race at 10:00 (n, mined model/real, spent model/real)");
for (const race of ["H", "O", "U", "N"]) {
  const x = rows.filter((r) => r.t === 600_000 && r.race === race);
  if (x.length) console.log(race, x.length, median(x.map((r) => r.minedModel / r.minedReal)).toFixed(2), median(x.map((r) => r.spentModel / r.spentReal)).toFixed(2));
}
const out = opt("--json");
if (out) writeFileSync(out, JSON.stringify(rows));
