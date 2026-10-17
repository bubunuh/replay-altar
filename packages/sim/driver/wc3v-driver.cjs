// SPDX-License-Identifier: GPL-3.0-or-later
// Runs WC3V's simulation (vendor/wc3v, GPL-3.0) on one replay and writes its full output.
// This file loads WC3V's modules, so it is GPL like WC3V. W3Stats only runs it as a separate
// process and reads the JSON it prints.
//
//   node wc3v-driver.cjs <replay.w3g> <out.wc3v.gz>
//
// Prints one JSON line: { ok, ms, players: {id: {name, race, parseConfidence, ...}}, error? }
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const WC3V = path.resolve(__dirname, "../../../vendor/wc3v");
const [replayPath, outPath] = process.argv.slice(2);

// WC3V logs heavily to stdout; keep stdout for our one result line.
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
const say = (obj) => write(JSON.stringify(obj) + "\n");

(async () => {
  const started = Date.now();
  try {
    const logManager = require(path.join(WC3V, "helpers/logManager"));
    logManager.setTestMode(true);
    logManager.setProductionMode(true);
    // Installs console.logger, which the engine calls everywhere; silent in production mode.
    // (No log file: that only opens on getLogger().init(), which we never call.)
    logManager.setLogger(replayPath);
    const utils = require(path.join(WC3V, "helpers/utils"));
    const { doParsing } = require(path.join(WC3V, "wc3v.js"));

    const { replay, players, world, validation } = await doParsing(replayPath);
    const stats = {};
    for (const pid of Object.keys(players)) {
      const p = players[pid];
      if (!p || Number(pid) >= 24 || p.isNeutralPlayer) continue;
      stats[pid] = {
        name: p.playerName,
        race: p.race,
        parseConfidence: p.parseConfidence,
        validationConfidence: p.validationConfidence,
        issueCounts: p.validationIssues || null,
        supplyBumps: (p._supplyBumps || []).length,
      };
    }
    const output = utils.buildOutputObject(replay, players, world, validation);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, zlib.gzipSync(JSON.stringify(output)));
    say({ ok: true, ms: Date.now() - started, players: stats, warnings: (validation && validation.warnings || []).length });
  } catch (e) {
    say({ ok: false, ms: Date.now() - started, error: String((e && e.stack) || e).slice(0, 2000) });
    process.exitCode = 1;
  }
})();
