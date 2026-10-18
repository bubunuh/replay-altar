// Runs the AI analysis with another model on some of your games, without touching the stored
// analyses: results go to --out. For choosing a smaller model to recommend.
//
//   node scripts/try-model.ts --model ~/models/x.gguf --out /tmp/x [--draft f] [--template f] [--port 8090] [game-key-prefix ...]
//
// Prints per game: time, speed, numbers not found in the facts, and the review.
import { mkdirSync } from "node:fs";
import { DEFAULT_CONFIG, listGames, loadConfig, openDb, paths, type AiConfig } from "@replay-altar/core";
import { analyzeGame, ModelServer } from "../packages/ai/src/index.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const model = arg("--model");
const out = arg("--out");
if (!model || !out) throw new Error("usage: --model <gguf> --out <dir> [game-key-prefix ...]");
const flags = new Set(["--model", "--out", "--draft", "--template", "--port"]);
const prefixes = process.argv.slice(2).filter((a, i, all) => !flags.has(a) && !flags.has(all[i - 1]));

const base = { ...DEFAULT_CONFIG.ai, ...loadConfig().ai };
const cfg: AiConfig = { ...base, model, draftModel: arg("--draft") ?? "", chatTemplate: arg("--template") ?? "", port: Number(arg("--port") ?? 8090) };
const p = paths();
const db = openDb(p.db);
mkdirSync(out, { recursive: true });
const where = { ...p, ai: out };
const server = new ModelServer(cfg, out);

const games = listGames(db).filter((g) => g.analyzed === 1 && (!prefixes.length || prefixes.some((x) => g.game_key.startsWith(x))));
try {
  for (const g of games) {
    const a = await analyzeGame(db, where, cfg, server, g.game_key);
    const t = a.timings;
    console.log(`\n=== ${g.game_key.slice(0, 8)} ${g.result} ${g.matchup} · ${Math.round(t.totalMs / 1000)} s · ${t.tokensPerSecond?.toFixed(0) ?? "?"} tok/s · unverified: ${a.unverified.join(", ") || "none"}`);
    if (a.error) console.log(`error: ${a.error}`);
    else console.log(JSON.stringify(a.review, null, 2));
  }
} finally {
  server.stop();
}
