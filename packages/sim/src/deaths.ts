// When each unit died, for the army value and the losses. WC3V's guess, corrected with the replay's
// selection lists (selections.ts):
// - A unit WC3V never saw move after training was never tied to the orders that moved it; WC3V calls
//   it lost the moment it was trained. It counts as alive unless the lists show a death for it.
// - A unit WC3V followed dies when the lists show it gone, if that is before WC3V's own guess (WC3V
//   keeps ordering dead units that are still in its copy of a hotkey group).
// - Ghouls are left to WC3V: they leave the army to gather lumber, which looks like dying in the lists;
//   for the same reason, an Undead player's handles the game never named get no deaths from the lists.
// Against the game's own counts on 50 recorded player-games (scripts/observer/batch-compare.py) the
// average army value error went 257 → 183.
import { baseUnit, RACES } from "@replay-altar/core";
import { costOf, type CostTables } from "./costs.ts";
import { listDeaths, type SelectionAction } from "./selections.ts";

const WORKERS = new Set(Object.values(RACES).map((r) => r.worker));
const NOT_FROM_LISTS = new Set(["ugho"]);

export type DeathUnit = {
  itemId: string;
  isBuilding?: boolean;
  isIllusion?: boolean;
  objectId1?: number | null;
  objectId2?: number | null;
  spawnTime?: number | null;
  trainedTime?: number | null;
  path?: unknown[];
  lostState?: { state: string; since: number } | null;
};

const wc3vDeath = (u: DeathUnit) => (u.lostState?.state === "lost" || u.lostState?.state === "possiblyLost" ? u.lostState.since : null);

/** Death time of each unit (null: alive at the end). Without selections, WC3V's guess as it is. */
export function unitDeaths<U extends DeathUnit>(units: U[], costs: CostTables, actions?: SelectionAction[]): Map<U, number | null> {
  const out = new Map<U, number | null>(units.map((u) => [u, wc3vDeath(u)]));
  if (!actions?.length) return out;
  const isArmy = (u: DeathUnit) => {
    if (u.isBuilding || u.isIllusion || WORKERS.has(u.itemId)) return false;
    const c = costOf(costs, u.itemId);
    return !c.isHero && c.food > 0;
  };
  const army = units.filter((u) => isArmy(u) && u.trainedTime != null);
  const unfollowed = army.filter((u) => (u.path?.length ?? 0) <= 2);
  for (const u of unfollowed) out.set(u, null);
  const hasGhouls = army.some((u) => u.itemId === "ugho");

  const { deaths, typeOf, firstSeen } = listDeaths(actions);
  const followed = new Map<string, U>();
  for (const u of army) if ((u.path?.length ?? 0) > 2 && u.objectId1 != null) followed.set(`${u.objectId1}:${u.objectId2}`, u);
  const assigned = new Map<string, number>();
  const taken = new Set<U>();
  const order = [...deaths.keys()].sort((a, b) => (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0));
  for (const h of order) {
    const [last, gone] = deaths.get(h)!;
    const at = (last + gone) / 2;
    const known = followed.get(h);
    if (known) {
      if (!NOT_FROM_LISTS.has(known.itemId)) out.set(known, Math.min(out.get(known) ?? Infinity, at));
      continue;
    }
    // With ghouls around, an unnamed handle that left its group is most likely a ghoul gone to the trees.
    if (hasGhouls && !typeOf.get(h)) continue;
    // A unit WC3V never tied to its handle: the type the game named, else the type the player had
    // trained more of than has been matched by the time the handle first shows up.
    const seenAt = firstSeen.get(h) ?? 0;
    // Types compare by their base form: the game names a Druid in bear form edcm, WC3V the edoc trained.
    const named = typeOf.get(h);
    let type = named && baseUnit(named);
    if (!type) {
      let best = 0;
      for (const ty of new Set(unfollowed.map((u) => baseUnit(u.itemId)))) {
        const room = unfollowed.filter((u) => baseUnit(u.itemId) === ty && u.trainedTime! <= seenAt).length - (assigned.get(ty) ?? 0);
        if (room > best) [best, type] = [room, ty];
      }
    }
    if (!type || NOT_FROM_LISTS.has(type)) continue;
    const unit = unfollowed.find((u) => baseUnit(u.itemId) === type && !taken.has(u) && u.trainedTime! <= gone);
    if (!unit) continue;
    taken.add(unit);
    assigned.set(type, (assigned.get(type) ?? 0) + 1);
    out.set(unit, at);
  }
  return out;
}
