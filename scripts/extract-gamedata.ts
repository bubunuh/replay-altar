// Extracts the balance tables WC3V's simulation needs, and the race crests, hero portraits and
// UI font the app shows, from the local Warcraft III install (read-only; see
// apps/collector/src/gamedata.ts). Run it after a game patch:
//
//   node scripts/extract-gamedata.ts [wc3-install-dir]
import { extractGameData } from "../apps/collector/src/gamedata.ts";

extractGameData(process.argv[2]);
