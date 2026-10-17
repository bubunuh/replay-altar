// Regenerates packages/core/src/data/names.json from w3gjs' internal mapping tables.
// w3gjs does not export these, so we read the module by file path.
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
// require.resolve("w3gjs") gives dist/cjs/index.js; the package root is two levels up.
const pkgRoot = join(dirname(require.resolve("w3gjs")), "../..");
const esmDir = join(pkgRoot, "dist/esm");
const m = await import(pathToFileURL(join(esmDir, "mappings.js")).href);
const version = require(join(pkgRoot, "package.json")).version;

// w3gjs prefixes names with a kind marker ("u_Footman", "a_Archmage:Blizzard").
const strip = (table: Record<string, string>) =>
  Object.fromEntries(Object.entries(table).map(([id, name]) => [id, name.replace(/^[a-z]_/, "")]));

const out = {
  source: `w3gjs@${version} src/mappings`,
  units: strip(m.units),
  buildings: strip(m.buildings),
  upgrades: strip(m.upgrades),
  items: strip(m.items),
  heroAbilities: strip(m.heroAbilities),
  abilityToHero: m.abilityToHero,
  // Hero names are not a table in w3gjs; derive them from "Archmage:Blizzard" style ability names.
  heroes: Object.fromEntries(
    Object.entries(m.abilityToHero as Record<string, string>).map(([ability, hero]) => [
      hero,
      strip(m.heroAbilities)[ability].split(":")[0],
    ]),
  ),
};
const target = new URL("../packages/core/src/data/names.json", import.meta.url);
mkdirSync(dirname(target.pathname), { recursive: true });
writeFileSync(target, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${target.pathname}`);
