// Tests known counters (unit against unit, hero against unit, the game's damage table) on the pro
// games, and writes docs/COUNTERS.md. Each claim comes from a guide; the test asks whether, in
// pro fights where one side had the countered unit, the side that brought the counter traded
// better than the side that didn't.
//
//   node scripts/test-counters.ts
//
// How a fight is judged: WC3V's battle summary gives each side's resources lost; a side's trade
// share is what the other side lost / what both lost (0.5 = even). Fights against creeps and
// fights where both sides together lost under 200 are left out. An army is the units ordered in
// the 6 minutes before the fight (deaths aren't subtracted; the rules use the same window).
//
// Two things keep this honest. Fights from one game aren't independent, so the uncertainty comes
// from resampling whole games (bootstrap). And a unit can look good simply because it is a good
// unit, or because better players make it: each claim is also measured in fights where the
// opponent did NOT have the countered unit, and only the difference between the two ("specific")
// says the counter is about that unit.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRecord, referencePaths, type GameRecord, type PlayerRecord } from "@replay-altar/core";
import { nameOf } from "@replay-altar/core/names";
import { armyMix, mixVsMix, ROSTER } from "../packages/rules/src/combat.ts";
import type { RaceCode } from "@replay-altar/core/gamedata";
import combat from "../data/gamedata/combat.json" with { type: "json" };

const WINDOW_MS = 360_000;
const MIN_LOSSES = 200;
const BOOT = 2000;
const GROUPS = ["pros", "pros-orc", "pros-undead", "pros-nightelf"];
const UNITS = combat.units as Record<string, { cost: number; hero: boolean; air: boolean; attacks: { air: boolean }[] }>;

type Side = { p: PlayerRecord; units: Map<string, number>; heroes: Set<string> };
type Fight = { game: string; t: number; a: Side; b: Side; share: number; win: boolean };

// ---- Pro games, each once (a game can be in two race groups) -------------------------------
const games = new Map<string, GameRecord>();
for (const g of GROUPS) {
  const rp = referencePaths(g);
  for (const f of readdirSync(rp.games)) {
    const key = f.replace(/\.json$/, "");
    if (games.has(key)) continue;
    const r = readRecord(rp, key) as GameRecord | null;
    if (r?.sim?.status === "ok" && r.players.length === 2 && r.players.every((p) => p.result === "win" || p.result === "loss")) games.set(key, r);
  }
}

const unitsOrdered = (p: PlayerRecord, from: number, to: number) => {
  const m = new Map<string, number>();
  for (const b of p.build) if (b.kind === "unit" && b.ms >= from && b.ms <= to && UNITS[b.code] && !UNITS[b.code].hero) m.set(b.code, (m.get(b.code) ?? 0) + 1);
  return m;
};
const heroesBy = (p: PlayerRecord, t: number) => new Set(p.heroes.filter((h) => (h.levelUps[0] ?? Infinity) <= t).map((h) => h.code));

// ---- Every fight, from both sides ------------------------------------------------------------
const fights: Fight[] = [];
for (const [key, r] of games) {
  if (r.sim?.status !== "ok") continue;
  for (const f of r.sim.fights ?? []) {
    if (f.category === "creep-fight" || f.playerIds.length < 2 || !f.losses) continue;
    const [p, q] = r.players;
    const lp = f.losses[String(p.playerId)]?.value ?? 0;
    const lq = f.losses[String(q.playerId)]?.value ?? 0;
    if (lp + lq < MIN_LOSSES) continue;
    const side = (x: PlayerRecord): Side => ({ p: x, units: unitsOrdered(x, f.start - WINDOW_MS, f.start), heroes: heroesBy(x, f.start) });
    const sp = side(p), sq = side(q);
    fights.push({ game: key, t: f.start, a: sp, b: sq, share: lq / (lp + lq), win: p.result === "win" });
    fights.push({ game: key, t: f.start, a: sq, b: sp, share: lp / (lp + lq), win: q.result === "win" });
  }
}

// ---- Statistics ------------------------------------------------------------------------------
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
// Deterministic random numbers, so the report doesn't change from run to run.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

/** Difference of means (with − without), and a 90% interval from resampling games. */
function compare(rows: Fight[], has: (f: Fight) => boolean) {
  const byGame = new Map<string, Fight[]>();
  for (const f of rows) byGame.set(f.game, [...(byGame.get(f.game) ?? []), f]);
  const keys = [...byGame.keys()];
  const diff = (fs: Fight[]) => mean(fs.filter(has).map((f) => f.share)) - mean(fs.filter((f) => !has(f)).map((f) => f.share));
  const boots: number[] = [];
  for (let i = 0; i < BOOT; i++) {
    const sample: Fight[] = [];
    for (let j = 0; j < keys.length; j++) sample.push(...byGame.get(keys[Math.floor(rand() * keys.length)])!);
    const d = diff(sample);
    if (Number.isFinite(d)) boots.push(d);
  }
  boots.sort((x, y) => x - y);
  const withF = rows.filter(has);
  return {
    nWith: withF.length,
    gamesWith: new Set(withF.map((f) => f.game)).size,
    nWithout: rows.length - withF.length,
    with: mean(withF.map((f) => f.share)),
    without: mean(rows.filter((f) => !has(f)).map((f) => f.share)),
    diff: diff(rows),
    lo: boots[Math.floor(boots.length * 0.05)] ?? NaN,
    hi: boots[Math.floor(boots.length * 0.95)] ?? NaN,
  };
}

type Claim = {
  claim: string;
  source: string;
  /** Races of the side with the counter and of the side with the countered unit. */
  races: [string, string];
  /** The countered thing, on the opponent's side. */
  theirs: (b: Side) => boolean;
  /** The counter, on the own side. */
  mine: (a: Side) => boolean;
};

const has = (code: string, n = 2) => (s: Side) => (s.units.get(code) ?? 0) >= n;
const any = (...preds: ((s: Side) => boolean)[]) => (s: Side) => preds.some((p) => p(s));
const hero = (code: string) => (s: Side) => s.heroes.has(code);
const GYM = "Warcraft 3 Gym";

const CLAIMS: Claim[] = [
  { claim: "Dryads counter Huntresses", source: `${GYM}, "AoW Fast Hunts Tech"`, races: ["N", "N"], theirs: has("esen", 3), mine: has("edry") },
  { claim: "Hippogryph Riders counter Huntresses", source: `${GYM}, "AoW Fast Hunts Tech"`, races: ["N", "N"], theirs: has("esen", 3), mine: has("ehpr") },
  { claim: "Footmen are good against Spell Breakers", source: `${GYM}, "Standard Human Mirror Guide"`, races: ["H", "H"], theirs: has("hspt"), mine: has("hfoo", 3) },
  { claim: "Knights are extremely strong against Spell Breakers", source: `${GYM}, "Standard Human Mirror Guide"`, races: ["H", "H"], theirs: has("hspt"), mine: has("hkni") },
  { claim: "Flying Machines counter Gryphon Riders", source: `${GYM}, "Standard Human Mirror Guide"`, races: ["H", "H"], theirs: has("hgry"), mine: has("hgyr") },
  { claim: "Gryphon Riders counter Knights", source: `${GYM}, "Standard Human Mirror Guide"`, races: ["H", "H"], theirs: has("hkni"), mine: has("hgry") },
  { claim: "Banshees are a great counter to Druids of the Claw (bears)", source: `${GYM}, "DK Ghoul Tier 3 Expo vs KotG DH"`, races: ["U", "N"], theirs: has("edoc"), mine: has("uban") },
  { claim: "Frost Wyrms counter Druids of the Claw (bears)", source: `${GYM}, "Ghoul Pull Build vs Night Elf"`, races: ["U", "N"], theirs: has("edoc"), mine: has("ufro", 1) },
  { claim: "Hippogryphs counter Destroyers", source: `${GYM}, "Night Elf's 24 Food Proxy Expo"`, races: ["N", "U"], theirs: has("ubsp"), mine: has("ehip") },
  { claim: "Headhunters counter Dryads", source: `${GYM}, "Tier 2 FS/Naga Push vs NE"`, races: ["O", "N"], theirs: has("edry"), mine: has("ohun", 3) },
  { claim: "Spirit Walkers answer Druids of the Talon (Cyclone)", source: `${GYM}, "Mass Talons Versus Orc"`, races: ["O", "N"], theirs: has("edot", 3), mine: has("ospw") },
  { claim: "Sorceresses (Slow) are very effective against large melee units", source: `${GYM}, "Beginner Guide: Rifle Caster"`, races: ["H", "*"], theirs: any(has("ogru", 4), has("otau"), has("uabo"), has("edoc"), has("emtg"), has("hkni")), mine: has("hsor") },
  { claim: "Riflemen, Flying Machines and Dragonhawk Riders answer Wind Riders", source: `${GYM}, "No Barracks Shop Before Tech"`, races: ["H", "O"], theirs: has("owyv"), mine: any(has("hrif", 4), has("hgyr"), has("hdhw")) },
  { claim: "Dryads answer Wind Riders", source: `${GYM}, "No Barracks Shop Before Tech"`, races: ["N", "O"], theirs: has("owyv"), mine: has("edry") },
  { claim: "The Pit Lord is extremely strong against Spell Breakers", source: `${GYM}, "Standard Human Mirror Guide"`, races: ["H", "H"], theirs: has("hspt"), mine: hero("Nplh") },
  { claim: "The Pandaren Brewmaster's Breath of Fire is strong against Footmen", source: `${GYM}, "Standard Human Mirror Guide"`, races: ["H", "H"], theirs: has("hfoo", 4), mine: hero("Npbm") },
  { claim: "The Pit Lord counters Priestess of the Moon mass Huntresses", source: `${GYM}, "Tavern Hero First Build Order For Night Elf"`, races: ["N", "N"], theirs: (s) => s.heroes.has("Emoo") && has("esen", 3)(s), mine: hero("Nplh") },
  { claim: "The Mountain King's Bash is strong against Spell Breakers", source: `${GYM}, "Standard Human Mirror Guide"`, races: ["H", "H"], theirs: has("hspt"), mine: hero("Hmkg") },
];

const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—");
const pts = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${Math.round(v * 100)}` : "—");

function verdict(main: ReturnType<typeof compare>, control: ReturnType<typeof compare>, spec: { lo: number; hi: number; diff: number }) {
  if (main.nWith < 15 || main.gamesWith < 6 || main.nWithout < 15) return "not enough data";
  if (main.lo > 0) return spec.lo > 0 ? "supported, specific to that unit" : "supported, but the counter helps against most armies";
  if (main.hi < 0) return "contradicted";
  return "no clear effect";
}

/** The "specific" difference: the effect against X minus the effect without X, resampled together. */
function specific(rowsX: Fight[], rowsNoX: Fight[], mine: (a: Side) => boolean) {
  const games = [...new Set([...rowsX, ...rowsNoX].map((f) => f.game))];
  const by = (rows: Fight[]) => {
    const m = new Map<string, Fight[]>();
    for (const f of rows) m.set(f.game, [...(m.get(f.game) ?? []), f]);
    return m;
  };
  const bx = by(rowsX), bn = by(rowsNoX);
  const effect = (rows: Fight[]) => mean(rows.filter((f) => mine(f.a)).map((f) => f.share)) - mean(rows.filter((f) => !mine(f.a)).map((f) => f.share));
  const boots: number[] = [];
  for (let i = 0; i < BOOT; i++) {
    const sx: Fight[] = [], sn: Fight[] = [];
    for (let j = 0; j < games.length; j++) {
      const g = games[Math.floor(rand() * games.length)];
      sx.push(...(bx.get(g) ?? []));
      sn.push(...(bn.get(g) ?? []));
    }
    const d = effect(sx) - effect(sn);
    if (Number.isFinite(d)) boots.push(d);
  }
  boots.sort((x, y) => x - y);
  return { diff: effect(rowsX) - effect(rowsNoX), lo: boots[Math.floor(boots.length * 0.05)] ?? NaN, hi: boots[Math.floor(boots.length * 0.95)] ?? NaN };
}

const lines: string[] = [];
const out = (s = "") => lines.push(s);
out("# Counters tested on pro games");
out();
out(`Generated by \`node scripts/test-counters.ts\` from ${games.size} pro games (warcraft3.info tournament players, current patch at the time they were collected) and their ${fights.length / 2} fights between the players (creep fights and fights with under ${MIN_LOSSES} resources lost in all left out).`);
out();
out("**How to read it.** Each claim comes from a guide. *Trade share* is what the other side lost in a fight divided by what both lost: 50% is an even trade. *With* / *without*: the side's average trade share in fights where the opponent had the countered unit, with and without the counter in its own army (units ordered in the 6 minutes before the fight). *Difference*: with − without, in points, with a 90% range from resampling whole games. *Specific*: the same difference minus the one measured in fights where the opponent did **not** have the countered unit: a counter that is really about that unit helps more when that unit is there. Better players may also pick the counter more often, which these numbers can't separate.");
out();
out("| Claim | Source | Fights with / without (games with) | Trade share with / without | Difference (90% range) | Specific | Verdict |");
out("|---|---|---|---|---|---|---|");
const summary: { claim: string; verdict: string }[] = [];
for (const c of CLAIMS) {
  const [ra, rb] = c.races;
  const pool = fights.filter((f) => (ra === "*" || f.a.p.race === ra) && (rb === "*" || f.b.p.race === rb));
  const rowsX = pool.filter((f) => c.theirs(f.b));
  const rowsNoX = pool.filter((f) => !c.theirs(f.b));
  const main = compare(rowsX, (f) => c.mine(f.a));
  const control = compare(rowsNoX, (f) => c.mine(f.a));
  const spec = specific(rowsX, rowsNoX, c.mine);
  const v = verdict(main, control, spec);
  summary.push({ claim: c.claim, verdict: v });
  out(`| ${c.claim} | ${c.source} | ${main.nWith} / ${main.nWithout} (${main.gamesWith}) | ${pct(main.with)} / ${pct(main.without)} | ${pts(main.diff)} (${pts(main.lo)} to ${pts(main.hi)}) | ${pts(spec.diff)} (${pts(spec.lo)} to ${pts(spec.hi)}) | ${v} |`);
}

// ---- The damage table: armies whose attacks suit the other army's armor ----------------------
out();
out("## The game's damage table");
out();
out("For every fight, each army's average damage multiplier against the other's armor (the game's attack-type × armor-type table, weighted by unit cost; 1.0 = full damage; fighting units only, without spellcasters), and the difference between the two sides. If attack and armor types matter in practice, the side with the better multiplier should trade better.");
out();
const adv = fights
  .map((f) => {
    // Fighting units only: a caster's damage is in its spells, not in its attack's type.
    const fighting = (p: PlayerRecord) => armyMix(p, f.t - WINDOW_MS, f.t).filter((e) => ROSTER[p.race as RaceCode]?.includes(e.code));
    const a = fighting(f.a.p);
    const b = fighting(f.b.p);
    return a.length && b.length ? { f, d: mixVsMix(a, b) - mixVsMix(b, a) } : null;
  })
  .filter((x): x is { f: Fight; d: number } => x !== null);
const bins: [string, (d: number) => boolean][] = [
  ["far worse (< −0.25)", (d) => d < -0.25],
  ["worse (−0.25 to −0.10)", (d) => d >= -0.25 && d < -0.1],
  ["about even (−0.10 to +0.10)", (d) => d >= -0.1 && d <= 0.1],
  ["better (+0.10 to +0.25)", (d) => d > 0.1 && d <= 0.25],
  ["far better (> +0.25)", (d) => d > 0.25],
];
out("| Your multiplier minus theirs | Fights | Average trade share | Games won |");
out("|---|---|---|---|");
for (const [label, pred] of bins) {
  const rows = adv.filter((x) => pred(x.d));
  out(`| ${label} | ${rows.length} | ${pct(mean(rows.map((x) => x.f.share)))} | ${pct(mean(rows.map((x) => (x.f.win ? 1 : 0))))} |`);
}
const dmg = compare(adv.map((x) => x.f), (f) => adv.find((x) => x.f === f)!.d > 0.1);
out();
out(`Better multiplier (> +0.10) against the rest: ${pts(dmg.diff)} points of trade share (90% range ${pts(dmg.lo)} to ${pts(dmg.hi)}).`);

// ---- Air against an army that can't shoot up -------------------------------------------------
out();
out("## Air against little anti-air");
out();
const canHitAir = (code: string) => UNITS[code]?.attacks.some((a) => a.air) ?? false;
const airValue = (s: Side) => [...s.units].reduce((n, [c, k]) => n + (UNITS[c]?.air ? UNITS[c].cost * k : 0), 0);
const value = (s: Side) => [...s.units].reduce((n, [c, k]) => n + (UNITS[c]?.cost ?? 0) * k, 0);
const antiAirValue = (s: Side) => [...s.units].reduce((n, [c, k]) => n + (canHitAir(c) ? (UNITS[c]?.cost ?? 0) * k : 0), 0);
const airRows = fights.filter((f) => value(f.b) > 0 && airValue(f.b) / value(f.b) >= 0.3 && value(f.a) > 0);
const aa = compare(airRows, (f) => antiAirValue(f.a) / value(f.a) >= 0.3);
out(`In ${airRows.length} fights where at least 30% of the opponent's army value flew, the side with at least 30% of its own value able to hit air traded ${pct(aa.with)} against ${pct(aa.without)} without (difference ${pts(aa.diff)}, 90% range ${pts(aa.lo)} to ${pts(aa.hi)}; ${aa.nWith} and ${aa.nWithout} fights).`);

out();
out("## Summary");
out();
for (const s of summary) out(`- ${s.claim}: **${s.verdict}**.`);
out();
out("Claims marked *not enough data* need more pro games of that matchup with that unit; the pro statistics are refreshed with new versions of Replay Altar.");

writeFileSync(join(import.meta.dirname, "../docs/COUNTERS.md"), lines.join("\n") + "\n");
console.log(lines.slice(-summary.length - 3).join("\n"));
