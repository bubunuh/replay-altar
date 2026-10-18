// Downloads a few W3Champions ladder games of one race at one skill band into a separate
// reference folder ("review"), simulated, to test the rules on players of every level:
//
//   node scripts/review-sample.ts --race H --band low|avg|high [--n 3]
//
// Bands by the subject's MMR: low 1000-1300, avg 1500-1700, high 2000-2300 (the pro corpus covers
// tournament players). The opponent must be within 150 MMR. Polite: one replay every 20 s (W3C
// answered 429 after about 25 replays at one per 10 s).
// Prints "<gameKey> <subjectPlayerId> <mmr> <battleTag>" for each game kept.
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applySim, dataDir, ingestFile, loadConfig } from "@replay-altar/core";
import { mapFetchingSimulator, openReference, w3cClient, w3infoClient, W3C_RACE } from "@replay-altar/reference";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const race = arg("--race") as "H" | "O" | "U" | "N";
const band = arg("--band") as "low" | "avg" | "high";
const n = Number(arg("--n") ?? 3);
const BANDS = { low: [1000, 1300], avg: [1500, 1700], high: [2000, 2300] } as const;
if (!race || !BANDS[band]) throw new Error("usage: --race H|O|U|N --band low|avg|high [--n 3]");
const [lo, hi] = BANDS[band];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const config = loadConfig();
const ref = openReference("review", config);
ref.db.exec("CREATE TABLE IF NOT EXISTS review_games (game_key TEXT PRIMARY KEY, band TEXT NOT NULL, race TEXT NOT NULL)");
const w3c = w3cClient({ sleep, log: (m) => console.error(m) });
const simulate = mapFetchingSimulator({ dataRoot: ref.paths.root, config, gamedataRoot: dataDir(), client: w3infoClient({ sleep }), sleep, log: (m) => console.error(m) });
const seen = (id: string) => ref.db.prepare("SELECT 1 FROM ref_matches WHERE w3c_match_id = ? UNION SELECT 1 FROM ref_skipped WHERE w3c_match_id = ?").get(id, id) !== undefined;
const skip = (id: string, reason: string) => ref.db.prepare("INSERT OR REPLACE INTO ref_skipped VALUES (?, ?, ?)").run(id, reason, new Date().toISOString());
const usedPlayers = new Set((ref.db.prepare("SELECT subject_name FROM ref_matches").all() as { subject_name: string }[]).map((x) => x.subject_name));

const season = await w3c.currentSeason();
const incoming = join(ref.paths.root, "incoming");
mkdirSync(incoming, { recursive: true });
let kept = 0;
outer: for (let page = 0; page < 30; page++) {
  for (const gateway of [20, 10]) {
    const { matches } = await w3c.listMatches({ gateway, season, minMmr: lo - 150, maxMmr: hi + 150, offset: page * 50, pageSize: 50 });
    await sleep(2000);
    for (const m of matches) {
      if (kept >= n) break outer;
      const id = `w3c:${m.id}`;
      if (m.durationInSeconds < 480 || seen(id)) continue;
      const players = m.teams.flatMap((t) => t.players);
      if (players.length !== 2) continue;
      const subject = players.find((p) => W3C_RACE[p.race] === race && p.oldMmr >= lo && p.oldMmr <= hi && !usedPlayers.has(p.battleTag));
      const opponent = players.find((p) => p !== subject);
      if (!subject || !opponent || Math.abs(opponent.oldMmr - subject.oldMmr) > 150) continue;
      await sleep(20_000);
      const buffer = await w3c.downloadReplay(m.id);
      if (!buffer) {
        skip(id, "replay not available");
        continue;
      }
      const file = join(incoming, `${m.id}.w3g`);
      writeFileSync(file, buffer);
      let out;
      try {
        out = await ingestFile(ref, file);
      } catch (e) {
        skip(id, `ingest failed: ${(e as Error).message}`);
        continue;
      } finally {
        unlinkSync(file);
      }
      if (out.status !== "new") {
        skip(id, out.status === "error" ? out.error : "duplicate game");
        continue;
      }
      const record = out.record;
      const p = record.players.find((x) => x.name.toLowerCase() === subject.battleTag.toLowerCase());
      if (!p) {
        skip(id, "subject not found in the replay");
        continue;
      }
      const sim = await simulate(record);
      applySim(ref, record.gameKey, sim);
      if (sim.status !== "ok") {
        skip(id, `simulation failed: ${sim.reason}`);
        continue;
      }
      ref.db.prepare("INSERT INTO ref_matches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        record.gameKey, id, gateway, season, m.startTime, m.map,
        subject.battleTag, p.playerId, subject.oldMmr,
        opponent.battleTag, W3C_RACE[opponent.race], opponent.oldMmr,
        subject.won ? 1 : 0, null, new Date().toISOString(),
      );
      ref.db.prepare("INSERT OR REPLACE INTO review_games VALUES (?, ?, ?)").run(record.gameKey, band, race);
      usedPlayers.add(subject.battleTag);
      kept++;
      console.log(`${record.gameKey} ${p.playerId} ${subject.oldMmr} ${subject.battleTag}`);
    }
  }
}
if (kept < n) console.error(`only ${kept} of ${n} found`);
