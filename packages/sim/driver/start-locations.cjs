// SPDX-License-Identifier: GPL-3.0-or-later
// Reads the start locations of extracted maps with WC3V's own parser (vendor/wc3v, GPL-3.0:
// lib/parsers/LUAJASSFile.js, the one its data-tool uses when it extracts a map). Used to repair
// map entries an older WC3V misread (packages/sim/src/maps.ts, repairStartLocations).
//
//   node start-locations.cjs < ["<mapdata>/war3map.lua", "<mapdata>/war3map.j", ...]
//
// Prints one JSON line: { "<script>": { "<spot>": { x, y } } or null (unreadable) }
"use strict";
const fs = require("fs");
const path = require("path");

const LUAJASSFile = require(path.resolve(__dirname, "../../../vendor/wc3v/lib/parsers/LUAJASSFile"));

const out = {};
for (const file of JSON.parse(fs.readFileSync(0, "utf8"))) {
  try {
    out[file] = new LUAJASSFile(file).startingPositions;
  } catch {
    out[file] = null;
  }
}
process.stdout.write(JSON.stringify(out) + "\n");
