// Scans every stored game (reference groups, the "review" sample and your games) from each
// player's side for reports that look wrong, so reviews can go straight to suspect games:
//
//   node scripts/scan-reports.ts [--list N]
//
// Flags: a loss with no finding, or only minor ones; a loss with no turning point (and no
// disconnect note); a strength that contradicts a finding; a loss where you led in army all
// game without the disconnect note. Prints counts, then up to N games per flag (default 8).
import { existsSync, readdirSync } from "node:fs";
import { paths, readRecord, referencePaths, type GameRecord } from "@replay-altar/core";
import { asPlayer, loadRefGroups, refFor } from "../packages/ai/src/context.ts";
import { allFindings, findings, strengths } from "../packages/ai/src/findings.ts";
import { recapOf, turningPoint } from "../packages/ai/src/report.ts";
import { at, seriesOf } from "../packages/ai/src/series.ts";

const listN = Number(process.argv[process.argv.indexOf("--list") + 1]) || 8;
const groups = loadRefGroups();

// A strength (by its label) that says the opposite of a finding.
const CONTRADICTS: Record<string, RegExp> = {
  heroes: /^(Hero XP|Hero level 3|Creep camps|3-3-60)/,
  fights: /^(Trade efficiency|Units killed)/,
  economy: /^Workers/,
  workers_lost: /^Workers alive/,
  goal_3360: /^3-3-60/,
};

type Flag = "loss_no_findings" | "loss_only_minor" | "loss_no_turning_point" | "contradiction" | "loss_led_all_game";
const hits: Record<Flag, string[]> = { loss_no_findings: [], loss_only_minor: [], loss_no_turning_point: [], contradiction: [], loss_led_all_game: [] };
let perspectives = 0;
const seen = new Set<string>();
// Rule lift on ladder games (the review sample), where pros' lift may not carry over.
const ladder: { win: boolean; ids: string[] }[] = [];

const sources = [...groups.map((g) => g.group.id), "review"].map((id) => ({ id, p: referencePaths(id) })).concat([{ id: "me", p: paths() }]);
for (const { id, p } of sources) {
  if (!existsSync(p.games)) continue;
  for (const f of readdirSync(p.games)) {
    const r = readRecord(p, f.replace(/\.json$/, "")) as GameRecord;
    if (r.sim?.status !== "ok" || r.players.length !== 2 || r.game.durationMs < 8 * 60_000) continue;
    const sides = id === "me" ? r.players.filter((x) => x.isMe) : r.players;
    for (const me of sides) {
      // The same game sits in more than one race's group.
      if (seen.has(`${r.gameKey}:${me.playerId}`)) continue;
      seen.add(`${r.gameKey}:${me.playerId}`);
      const opp = r.players.find((x) => x !== me)!;
      const result = me.result;
      if (result !== "win" && result !== "loss") continue;
      perspectives++;
      const view = asPlayer(r, me.playerId);
      const ref = refFor(groups, me, opp);
      const found = findings(view, ref);
      if (id === "review") ladder.push({ win: result === "win", ids: allFindings(view, ref).map((x) => x.id) });
      const good = strengths(view, ref, found);
      const tag = `${id} ${r.gameKey.slice(0, 8)} p${me.playerId} ${me.race}v${opp.race} ${result} ${Math.round(r.game.durationMs / 60_000)}m`;
      const recap = recapOf(view, opp, result, found, good);
      const disconnect = recap.includes("disconnect");
      if (result === "loss" && !found.length && !disconnect) hits.loss_no_findings.push(tag);
      else if (result === "loss" && found.length && found.every((x) => x.severity <= 0.55) && !disconnect) hits.loss_only_minor.push(`${tag}: ${found.map((x) => x.id).join(", ")}`);
      if (result === "loss" && !disconnect && !turningPoint(view, me, opp, result)) hits.loss_no_turning_point.push(tag);
      for (const x of found) {
        const re = CONTRADICTS[x.id];
        const s = re && good.find((g) => re.test(g));
        if (s) hits.contradiction.push(`${tag}: [${x.id}] ${x.headline} / ${s}`);
      }
      const sm = seriesOf(r, me), so = seriesOf(r, opp);
      // From 2:00 on (both start at 0).
      const led = sm.length > 3 && sm.filter((s) => s.t >= 120_000).every((s) => (s.armyValue ?? 0) >= (at(so, s.t)?.armyValue ?? 0));
      if (result === "loss" && led && !disconnect) hits.loss_led_all_game.push(tag);
    }
  }
}

console.log(`perspectives (8+ minutes, simulated): ${perspectives}\n`);
for (const [flag, list] of Object.entries(hits)) {
  console.log(`== ${flag}: ${list.length}`);
  for (const x of list.slice(0, listN)) console.log(`  ${x}`);
}

const lw = ladder.filter((x) => x.win), ll = ladder.filter((x) => !x.win);
console.log(`\n== rule lift on ladder games: ${ladder.length} perspectives (${lw.length} wins, ${ll.length} losses)`);
const rate = (set: typeof ladder, rule: string) => set.filter((x) => x.ids.includes(rule)).length / Math.max(1, set.length);
for (const rule of [...new Set(ladder.flatMap((x) => x.ids))].sort()) {
  const [w, l] = [rate(lw, rule), rate(ll, rule)];
  console.log(`  ${rule.padEnd(22)} wins ${Math.round(w * 100)}%  losses ${Math.round(l * 100)}%  lift ${w ? (l / w).toFixed(1) : l ? "inf" : "-"}`);
}
