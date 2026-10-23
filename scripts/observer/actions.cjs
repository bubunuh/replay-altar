// Research: dumps the raw selection and group actions of one player from a replay (w3gjs, as WC3V
// reads it), to compare with the observer recording.  node actions.cjs <replay> <playerId> > out.jsonl
const path = require("path");
const WC3V = path.join(__dirname, "../../vendor/wc3v");
const ReplayParser = require(path.join(WC3V, "node_modules/w3gjs/dist/lib/parsers/ReplayParser")).default;
const utils = require(path.join(WC3V, "helpers/utils"));
const fs = require("fs");
const [file, pid] = process.argv.slice(2);
const parser = new ReplayParser();
let t = 0;
parser.on("gamedatablock", (block) => {
  if (block.timeIncrement) t += block.timeIncrement;
  for (const cb of block.commandBlocks || []) {
    if (pid && String(cb.playerId) !== pid) continue;
    for (let a of cb.actions || []) {
      a = utils.fixBrokenActionFormat(utils.normalizeAction(a));
      const keep = { t, p: cb.playerId, id: a.id };
      for (const k of ["selectMode", "groupNumber", "itemId", "objectId1", "objectId2", "orderId", "abilityFlags", "targetX", "targetY"]) if (a[k] !== undefined) keep[k] = a[k];
      const list = a.actions || a.units || a.unitIds || a.objects || a.selectedUnits; if (list) keep.units = list.map((u) => (Array.isArray(u) ? u : [u.itemId1 ?? u.objectId1 ?? u[0], u.itemId2 ?? u.objectId2 ?? u[1]])); if (!keep.units && (a.id === 22 || a.id === 23)) keep.keys = Object.keys(a);
      process.stdout.write(JSON.stringify(keep) + "\n");
    }
  }
});
parser.parse(fs.readFileSync(file)).then(() => {});
