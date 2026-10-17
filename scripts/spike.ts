// Phase 0 spike: run w3gjs over the fixture replays and print what the plan depends on.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import W3GReplay from "w3gjs";

const dir = process.argv[2] ?? "fixtures/replays";
const me = "Pedrovisk#1486";

for (const file of readdirSync(dir).filter((f) => f.endsWith(".w3g")).sort()) {
  const replay = new W3GReplay();
  const out = await replay.parse(readFileSync(join(dir, file)));
  const mine = out.players.find((p) => p.name === me);
  const result = out.winningTeamId === undefined || out.winningTeamId === -1 || !mine
    ? "?"
    : out.winningTeamId === mine.teamid ? "WIN" : "LOSS";
  const slots = replay.slots
    .filter((s) => s.slotStatus === 2)
    .map((s) => `p${s.playerId}/t${s.teamId}/${s.computerFlag ? "AI" : "hum"}`);
  console.log(`${file}`);
  console.log(`  id=${out.id.slice(0, 12)} type=${out.type} matchup=${out.matchup} gameType=${replay.meta.gameType} gamename=${out.gamename} v=${out.version}.${out.buildNumber} dur=${(out.duration / 60000).toFixed(1)}m parse=${out.parseTime}ms`);
  console.log(`  map=${out.map.file} result(me)=${result} winningTeamId=${out.winningTeamId}`);
  console.log(`  players=${out.players.map((p) => `${p.name}[t${p.teamid} ${p.race}/${p.raceDetected} apm${p.apm} heroes:${p.heroes.map((h) => `${h.id}L${h.level}`).join(",")}]`).join(" | ")}`);
  console.log(`  observers=${JSON.stringify(out.observers)} slots=${slots.join(" ")}`);
  console.log(`  leaves=${replay.leaveEvents.map((e) => `p${e.playerId}:r${e.reason}/${e.result}`).join(" ")}`);
}
