// "Next time" for each rule: what to do differently, written by hand from the same guides the
// rules come from (Grubby's beginner series and race guides, Warcraft 3 Gym, Liquipedia), with
// the race's own buildings and units and the pros' numbers where the rule has them.
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import { RACES, type RaceCode } from "@replay-altar/core/gamedata";
import { nameOf } from "@replay-altar/core/names";
import type { FactsRef } from "./facts.ts";
import { mmss } from "./series.ts";

export type AdviceCtx = { r: GameRecord; me: PlayerRecord; opp: PlayerRecord; ref: FactsRef | null };

const SHOP: Record<RaceCode, string> = { H: "hvlt", O: "ovln", U: "utom", N: "eden" };
const SMITH: Record<RaceCode, string> = { H: "hbla", O: "ofor", U: "ugrv", N: "edob" };
/** What a race creeps with in the first minutes (Liquipedia build orders). */
const FIRST_CREEP: Record<RaceCode, string> = {
  H: "your first hero, Militia and the first Footmen",
  O: "your first hero and the first Grunts or Headhunters",
  U: "the Death Knight or Dreadlord and your first Ghouls",
  N: "your first hero and the first Archers, healing at the Moon Wells",
};
/** How a race answers worker harassment (Grubby's race guides). */
const HARASS_ANSWER: Record<RaceCode, string> = {
  H: "ring Call to Arms (Militia) or pull Peasants away",
  O: "put Peons in the Burrows (Battle Stations)",
  U: "pull Acolytes away and bring Ghouls home",
  N: "pull Wisps away; Ancient Protectors and Moon Wells defend",
};

const pro = (c: AdviceCtx, key: string) => c.ref?.mp.metrics[key]?.p50 ?? null;
const race = (c: AdviceCtx) => (c.me.race as RaceCode) in RACES ? (c.me.race as RaceCode) : "H";

/** The advice for a finding, or null when the rule has none. */
export function adviceFor(id: string, c: AdviceCtx): string | null {
  const R = race(c);
  const m = c.me.metrics;
  switch (id) {
    case "heroes": {
      const l3 = pro(c, "hero_level3_ms");
      const camps = pro(c, "creep_camps_6m");
      const fewCamps = camps !== null && (m.creep_camps_6m ?? 0) < camps;
      return `Creep from the moment your hero leaves the altar, with ${FIRST_CREEP[R]}, and go straight from one camp to the next; pros reach hero level 3 by ${mmss(l3)}${fewCamps ? ` and clear ${camps} camps by 6:00` : ""}. Bring the second hero creeping too, and buy a healing item so you can keep creeping instead of walking home.`;
    }
    case "fights": {
      const items = [m.items_bought ?? 0, c.opp.metrics.items_bought ?? 0];
      const fewItems = items[1] >= 8 && items[1] >= 3 * Math.max(1, items[0]);
      return `Take fights only where you are stronger: with your heroes alive and at least as high level, after an upgrade, never under their towers. ${fewItems ? `Bring potions and a Town Portal (${nameOf(SHOP[R])}) before the fight. ` : ""}Focus their heroes, and pull back wounded units and heroes instead of losing them.`;
    }
    case "window":
      return "When the opponent has no army for minutes (fast tech or towers), take an expansion right away, or go hit their creeping hero and their expansion: every minute of that window is free.";
    case "exposed":
      return "Keep some army from the first minutes; a lone hero can't creep safely or defend. Train units from your first production building non-stop until about 30 food.";
    case "economy":
      return R === "U"
        ? "Keep the Necropolis training Acolytes until 5 are on each gold mine; Ghouls cut the lumber. Queue one Acolyte at a time so gold isn't locked."
        : `Keep the ${nameOf(RACES[R].townHalls[0])} training workers non-stop (one in the queue at a time) until each gold mine has 5 and the lumber crew is full; train more before you expand so the new base starts full.`;
    case "supply":
      return `Start the next ${nameOf(RACES[R].supply)} when you are 6-8 food below the cap, not when you hit it; before a big round of production, start two.`;
    case "hero_deaths":
      return `Carry a Scroll of Town Portal (${nameOf(SHOP[R])}) and pull a hero back once it drops under a third of its health: a dead hero costs gold and time to revive and gives their heroes experience.`;
    case "no_heroes":
      return "When all your heroes are dead, retreat and wait for the revive: units without heroes lose fights and feed experience to theirs.";
    case "upkeep":
      return "Stay at 80 food or less unless you are about to fight; put the extra gold into an expansion or upgrades instead of units that sit at home.";
    case "expansion":
      return "Take an expansion when it is safe: after you win a fight, while their army is away, or when they tech. Pros who expanded did it by about " + mmss(pro(c, "expansion_ms")) + ".";
    case "first_creep":
      return `Start creeping as soon as the hero leaves the altar, with ${FIRST_CREEP[R]}; pros start within about 10 seconds.`;
    case "upgrades":
      return `Start your first attack or armor upgrade at the ${nameOf(SMITH[R])} around 50 food; pros start their first attack upgrade by about ${mmss(pro(c, "first_attack_upgrade_ms"))}.`;
    case "one_hero":
      return "Get a second hero around tier 2 (pros: around 38 food); Grubby: two heroes usually beat one, and the second one creeps too.";
    case "no_items":
      return `Visit the ${nameOf(SHOP[R])} or a neutral shop: a Potion of Healing and a Scroll of Town Portal save heroes, and items from creeps should be used, not kept.`;
    case "floating":
      return "When gold piles up above about 500, spend it: another production building, an upgrade, or units. Pros spend nearly everything they mine in the first 10 minutes.";
    case "unanswered_expansion":
      return "When they start an expansion and your army is bigger, attack it before the town hall finishes (about two minutes): it is their weakest moment.";
    case "just_over_50":
      return "Stay at 50 food and invest (upgrades, items, a production building), then go well past 50 right before a fight.";
    case "towers":
      return "Stop at an arcane or guard tower per base and put the rest into units: kills by towers give your heroes no experience.";
    case "workers_lost":
      return `When they harass your workers, ${HARASS_ANSWER[R]}, and add a tower at an exposed expansion.`;
    case "goal_3360":
      return "Aim for 3-3-60: first hero level 3, second hero level 3 and 60 food; then look for a fight. Creep with both heroes to get there.";
    case "unused_spike":
      return "At 50 food with level 3 heroes, do one of three within a minute or two: attack, expand, or start tier 3. Waiting gives the opponent time to catch up.";
    case "upkeep_before_upgrades":
      return `Before going over 50 food, invest: an attack or armor upgrade at the ${nameOf(SMITH[R])}, items, or an expansion.`;
    case "mine_dry":
      return "Take a second base well before your main mine runs out (it holds 12,500 gold: about 20 minutes with 5 workers).";
    case "build_drift":
      return "Follow your build's timings: start the tier upgrade and the expansion at the food counts the pros on that build use (shown above), and add other buildings around them.";
    case "mechanics":
      return "Put heroes and army on control groups 1-3 and production buildings on 4-6, and select with the number keys instead of clicking; it frees time for the map.";
    case "army_mismatch":
    case "no_anti_air":
    case "no_sustain":
    case "no_scout":
      return null; // these write their own advice (it depends on the game)
    default:
      return null;
  }
}
