// Research: W3Champions' end-of-game numbers against the game's own, on the recorded ladder games
// (batch3 and batch4 manifests, their W3Champions match id). Writes one row per player-game.
//
//   node scripts/observer/official-vs-recording.ts <out.json>
//
// Result (2026-11-11, 116 player-games that end with the recording): W3Champions' "gold
// collected" is the game's gold mined (median ratio 1.001, 93 within 1%), so bounty is not in it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths, readRecord, referencePaths, type GameRecord } from "@replay-altar/core";
import { officialForMatch, w3cClient } from "@replay-altar/reference";
const obs = join(paths().root, "observer"); const store = referencePaths("observer"); const client = w3cClient({});
const out: unknown[] = [];
for (const b of ["batch3", "batch4"]) for (const e of JSON.parse(readFileSync(join(obs, b, "manifest.json"), "utf8"))) {
  if (!e.w3c) continue; const f = join(obs, b, "recordings", e.file.replace(/\.w3g$/, ".jsonl")); if (!existsSync(f)) continue;
  const r = readRecord(store, e.key) as GameRecord | null; if (!r) continue;
  const off = await officialForMatch(client, e.w3c, r); await new Promise((z) => setTimeout(z, 2500));
  if (off.status !== "ok") { console.log(e.file, off.status); continue; }
  const lines = readFileSync(f, "utf8").trim().split("\n"); const last = JSON.parse(lines.at(-1)!);
  for (const op of off.players) { const rp = r.players.find((p) => p.playerId === op.playerId)!; const lp = last.players.find((p: any) => rp.name.startsWith(p.name + "#"));
    if (lp) out.push({ game: `${b}/${e.file}`, name: rp.name, goldCollected: op.goldCollected, lumber: (op as any).lumberCollected, mined: lp.gold_mined, harvested: lp.lumber_harvested, gold: lp.gold, lastT: last.game.t, dur: r.game.durationMs }); }
  console.log(e.file, "ok");
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
