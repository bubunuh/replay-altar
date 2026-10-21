// Writes a page script that replaces every player name with a placeholder, for screenshots meant
// to be shared (the README's): your battletags become "Player#1234", everyone else "Rival<n>".
// Names come from your games and the pro games on this PC; the script it writes holds them, so
// keep it out of the repository (the scratchpad or /tmp).
//
//   node scripts/hide-names.ts /tmp/hide-names.js
//   REPLAY_ALTAR_SHOT_JS=/tmp/hide-names.js electron apps/desktop --page=matches --screenshot=out.png
//
// A name without its #tag is replaced too, unless it is a word the app itself uses ("Focus",
// "Moon" in "Moon Well"), which would garble the page.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir, loadConfig } from "@replay-altar/core";

const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/hide-names.ts <out.js>");

const root = join(import.meta.dirname, "..");
const dbs = [join(dataDir(), "replay-altar.sqlite")];
const refDir = join(dataDir(), "reference");
if (existsSync(refDir)) for (const g of readdirSync(refDir)) if (existsSync(join(refDir, g, "reference.sqlite"))) dbs.push(join(refDir, g, "reference.sqlite"));

const names = new Set<string>();
for (const file of dbs) {
  const db = new DatabaseSync(file, { readOnly: true });
  for (const r of db.prepare("SELECT DISTINCT name FROM game_players").all() as { name: string }[]) names.add(r.name);
  db.close();
}

// Words in the app's own texts and game data: a bare name equal to one of them is left alone.
const words = new Set<string>();
const collect = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!["node_modules", "out", "test"].includes(e.name)) collect(p);
    } else if (/\.(tsx?|json)$/.test(e.name)) for (const w of readFileSync(p, "utf8").match(/\p{L}+/gu) ?? []) words.add(w.toLowerCase());
  }
};
for (const d of ["packages", "apps/desktop/src", "data/gamedata"]) collect(join(root, d));

const mine = new Set(loadConfig().accounts);
const alias = new Map<string, string>();
let n = 0;
for (const name of [...names].sort((a, b) => b.length - a.length || a.localeCompare(b))) {
  const tag = mine.has(name) ? "Player#1234" : `Rival${++n}#${1000 + n}`;
  alias.set(name, tag);
  const bare = name.split("#")[0];
  if (bare.length >= 3 && !alias.has(bare) && !words.has(bare.toLowerCase())) alias.set(bare, tag.split("#")[0]);
}
// Your Linux user name in folder paths.
const user = process.env.USER;
if (user) alias.set(user, "user");

const pairs = [...alias].sort((a, b) => b[0].length - a[0].length);
const js = `(async () => {
  const pairs = ${JSON.stringify(pairs)};
  const esc = (s) => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
  const re = new RegExp("(?<![\\\\p{L}\\\\p{N}_])(" + pairs.map((p) => esc(p[0])).join("|") + ")(?![\\\\p{L}\\\\p{N}])", "gu");
  const map = new Map(pairs);
  const f = (s) => s.replace(re, (x) => map.get(x));
  const run = () => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t; (t = w.nextNode()); ) { const v = f(t.nodeValue); if (v !== t.nodeValue) t.nodeValue = v; }
    for (const e of document.querySelectorAll("*")) for (const a of ["title", "alt", "placeholder", "aria-label", "data-tip"]) { const v = e.getAttribute(a); if (v) e.setAttribute(a, f(v)); }
    for (const e of document.querySelectorAll("input, textarea")) e.value = f(e.value);
  };
  run();
  // Parts of the page that arrive late (the report) get the same treatment.
  await new Promise((r) => setTimeout(r, 3000));
  run();
})();
`;
writeFileSync(out, js);
console.log(`${pairs.length} names → ${out}`);
