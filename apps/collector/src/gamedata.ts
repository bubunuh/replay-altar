// Extracts what the app needs from the local Warcraft III install: the balance tables WC3V's
// simulation reads, and the race crests, hero portraits and UI font the app shows.
//
// The game's files sit in CASC storage, read with casc-extract (scripts/casc, built on CascLib).
// Linux: in a podman container, with the install mounted as an overlay (:O); CascLib opens some
// files read-write, and the overlay sends anything it might write to a throwaway layer.
// Windows: scripts/casc/bin/casc-extract.exe (scripts/casc/build-windows.sh), whose CascLib is
// patched to open every file read-only. Either way the game files are never touched.
//
// Output: vendor/wc3v/helpers/UnitBalance.json, plus a copy of the source tables and a manifest
// under <data>/sim/gamedata/<game version>/ (and sim/gamedata/current pointing at it), and the
// pictures under <data>/ui/.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir, projectRoot } from "@replay-altar/core";
import { decodeDds, encodePng } from "./dds.ts";

const ROOT = projectRoot();
const IMAGE = "localhost/replay-altar-casc:latest";
const windows = process.platform === "win32";

/** The base war3.w3mod tables are current melee balance (the _balance\* overlays are for custom maps). */
const TABLES = ["unitbalance.slk", "upgradedata.slk", "abilitydata.slk", "itemdata.slk", "unitweapons.slk", "unitdata.slk"].map((f) => `units\\${f}`).concat("units\\miscgame.txt");
const RACES = ["human", "orc", "undead", "nightelf", "random"].map((r) => `webui\\versusmenu\\raceicons\\${r}-resting.png`);
const FONT = "fonts\\frizqt__.ttf";
/** Hero code to its command-card icon. */
const HEROES: Record<string, string> = {
  Hamg: "btnheroarchmage", Hmkg: "btnheromountainking", Hpal: "btnheropaladin", Hblm: "btnherobloodelfprince",
  Edem: "btnherodemonhunter", Ekee: "btnkeeperofthegrove", Emoo: "btnheromoonpriestess", Ewar: "btnherowarden",
  Obla: "btnheroblademaster", Ofar: "btnherofarseer", Otch: "btnherotaurenchieftain", Oshd: "btnshadowhunter",
  Udea: "btnherodeathknight", Udre: "btnherodreadlord", Ulic: "btnherolich", Ucrl: "btnherocryptlord",
  Npbm: "btnpandarenbrewmaster", Nbrn: "btnbansheeranger", Nngs: "btnnagaseawitch", Nplh: "btnpitlord",
  Nbst: "btnbeastmaster", Ntin: "btnherotinker", Nfir: "btnheroavatarofflame", Nalc: "btnheroalchemist", Npal: "btnforsakenpaladin",
};

/** Battle.net's install folder: from the registry on Windows, else the usual places. */
export function defaultWarcraftDir(): string {
  if (!windows) return join(homedir(), "Games/battlenet/drive_c/Program Files (x86)/Warcraft III");
  try {
    const out = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\Warcraft III", "/v", "InstallPath"], { encoding: "utf8", windowsHide: true });
    const path = out.match(/InstallPath\s+REG_SZ\s+(.+)/)?.[1]?.trim();
    if (path && existsSync(join(path, ".build.info"))) return path;
  } catch {
    // not in the registry
  }
  const candidates = ["C:\\Program Files (x86)\\Warcraft III", "C:\\Program Files\\Warcraft III"];
  return candidates.find((d) => existsSync(join(d, ".build.info"))) ?? candidates[0];
}

/** The game version from .build.info (a |-separated table; the column named "Version!…"). */
function gameVersion(wc3: string): string {
  const [head, row] = readFileSync(join(wc3, ".build.info"), "utf8").split(/\r?\n/);
  const col = head.split("|").findIndex((c) => c.startsWith("Version!"));
  const version = row?.split("|")[col];
  if (col < 0 || !version) throw new Error(`no game version in ${join(wc3, ".build.info")}`);
  return version;
}

/** Copies CASC files (paths inside war3.w3mod) into `out`, flat, at the lowest priority. */
function extract(wc3: string, out: string, names: string[]) {
  const args = names.map((n) => `war3.w3mod:${n}`);
  mkdirSync(out, { recursive: true });
  if (windows) {
    const exe = process.env.REPLAY_ALTAR_CASC_EXTRACT ?? join(ROOT, "scripts/casc/bin/casc-extract.exe");
    if (!existsSync(exe)) throw new Error(`${exe} is missing (build it on Linux with scripts/casc/build-windows.sh)`);
    // Written to the working directory: the extractor takes ANSI paths, and the user's folder may not be.
    execFileSync(exe, [wc3, ".", ...args], { cwd: out, stdio: "ignore", windowsHide: true });
    return;
  }
  execFileSync("nice", ["-n", "19", "podman", "run", "--rm", "--security-opt", "label=disable", "-v", `${wc3}:/war3:O`, "-v", `${out}:/out:z`, IMAGE, "/war3", "/out", ...args], { stdio: "ignore" });
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/**
 * Points sim/gamedata/current at this version: a relative symlink on Linux. Windows gets a copy
 * (a few MB): links there need admin rights or are junctions, which some tools mishandle.
 */
function pointCurrent(dir: string, version: string) {
  const current = join(dir, "current");
  const st = lstatSync(current, { throwIfNoEntry: false });
  if (st?.isSymbolicLink()) unlinkSync(current); // the link only, never what it points to
  else if (st) rmSync(current, { recursive: true, force: true }); // an earlier copy
  if (windows) cpSync(join(dir, version), current, { recursive: true });
  else symlinkSync(version, current);
}

export function extractGameData(wc3 = defaultWarcraftDir()) {
  if (!existsSync(join(wc3, ".build.info"))) throw new Error(`No Warcraft III install at ${wc3}`);
  const version = gameVersion(wc3);
  const data = dataDir();
  const out = join(data, "sim/gamedata", version);

  if (!windows) {
    try {
      execFileSync("podman", ["image", "exists", IMAGE]);
    } catch {
      console.log("Building the CASC extractor image (one time)…");
      execFileSync("nice", ["-n", "19", "podman", "build", "-q", "-t", IMAGE, join(ROOT, "scripts/casc")], { stdio: "ignore" });
    }
  }

  extract(wc3, out, TABLES);
  // Race crests and the game's UI font (Friz Quadrata): kept with your data, never in the repo.
  extract(wc3, join(data, "ui/races"), RACES);
  extract(wc3, join(data, "ui/fonts"), [FONT]);
  // Hero portraits for the match header, decoded from DDS.
  const raw = mkdtempSync(join(tmpdir(), "replay-altar-heroes-"));
  try {
    extract(wc3, raw, Object.values(HEROES).map((b) => `replaceabletextures\\commandbuttons\\${b}.dds`));
    mkdirSync(join(data, "ui/heroes"), { recursive: true });
    for (const [code, icon] of Object.entries(HEROES)) {
      const dds = join(raw, `${icon}.dds`);
      if (existsSync(dds)) writeFileSync(join(data, "ui/heroes", `${code}.png`), encodePng(decodeDds(readFileSync(dds))));
    }
  } finally {
    rmSync(raw, { recursive: true, force: true });
  }

  // WC3V's converter reads ./UnitBalance.slk and writes ./UnitBalance.json (on Windows the
  // extracted unitbalance.slk is already that file: names are case-insensitive there).
  if (!windows) copyFileSync(join(out, "unitbalance.slk"), join(out, "UnitBalance.slk"));
  execFileSync(process.execPath, [join(ROOT, "vendor/wc3v/slk/slk.js")], { cwd: out, stdio: "ignore", windowsHide: true });
  copyFileSync(join(out, "UnitBalance.json"), join(ROOT, "vendor/wc3v/helpers/UnitBalance.json"));

  const files = ["unitbalance.slk", "upgradedata.slk", "abilitydata.slk", "itemdata.slk", "unitweapons.slk", "unitdata.slk", "miscgame.txt", "UnitBalance.json"];
  const manifest = {
    gameVersion: version,
    source: `war3.w3mod:units (base melee tables) from ${wc3}`,
    extractedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    sha256: Object.fromEntries(files.map((f) => [f, sha256(join(out, f))])),
  };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  pointCurrent(join(data, "sim/gamedata"), version);
  console.log(`Game data ${version} -> ${out} (and vendor/wc3v/helpers/UnitBalance.json)`);
}
