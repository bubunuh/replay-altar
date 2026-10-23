// Unit deaths from the replay's own selection lists. A replay records no deaths, and WC3V guesses
// them: it marks a unit dead when it stops getting orders after a fight. That fails for units in a
// hotkey group (WC3V keeps ordering its stale copy of the group) and for units it never tied to the
// orders that move them (it marks them dead the moment they are trained). But when a player switches
// selection, the replay lists every unit being deselected: what was really selected then, already
// without the dead ones. A unit that stops appearing in later lists of the group it was last in died
// in between. Checked against the game's own unit counts on 50 recorded player-games
// (scripts/observer/batch-compare.py).
import { readFileSync } from "node:fs";
import { ReplayParser } from "w3gjs";

type Tag = [number, number];
/** The selection actions of one player, in order. */
export type SelectionAction =
  | { t: number; kind: "deselect" | "select"; units: Tag[] }
  | { t: number; kind: "assign"; units: Tag[] }
  | { t: number; kind: "focus"; itemId: string; object: Tag };
export type Selections = Record<string, SelectionAction[]>;

const fourCC = (b: number[]) => String.fromCharCode(...[...b].reverse());

/** Reads the selection actions of every player (about half a second for a 20-minute replay). */
export async function readSelections(replayPath: string): Promise<Selections> {
  const out: Selections = {};
  const parser = new ReplayParser();
  let t = 0;
  parser.on("gamedatablock", (block: { id: number; timeIncrement?: number; commandBlocks?: { playerId: number; actions: Record<string, unknown>[] }[] }) => {
    if (block.timeIncrement) t += block.timeIncrement;
    for (const cb of block.commandBlocks ?? []) {
      const list = (out[String(cb.playerId)] ??= []);
      for (const a of cb.actions) {
        if (a.id === 0x16) list.push({ t, kind: a.selectMode === 2 ? "deselect" : "select", units: a.units as Tag[] });
        else if (a.id === 0x17) list.push({ t, kind: "assign", units: a.units as Tag[] });
        else if (a.id === 0x19) list.push({ t, kind: "focus", itemId: fourCC(a.itemId as number[]), object: a.object as Tag });
      }
    }
  });
  await parser.parse(readFileSync(replayPath));
  return out;
}

const key = (u: Tag) => `${u[0]}:${u[1]}`;

/**
 * Deaths seen in one player's selection lists: unit handle ("id1:id2") → [last listed, first list
 * without it]. Lists are whole selections the game wrote out: a deselect followed at once by a new
 * selection, or a group assignment. Also returns the type the game named for each handle it focused.
 */
export function listDeaths(actions: SelectionAction[]): { deaths: Map<string, [number, number]>; typeOf: Map<string, string>; firstSeen: Map<string, number> } {
  const lists: { t: number; units: Set<string> }[] = [];
  const typeOf = new Map<string, string>();
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const next = actions[i + 1];
    if (a.kind === "focus") {
      if (a.object[0] || a.object[1]) typeOf.set(key(a.object), a.itemId);
    } else if (a.kind === "assign" || (a.kind === "deselect" && next?.kind === "select" && next.t === a.t)) {
      lists.push({ t: a.t, units: new Set(a.units.map(key)) });
    }
  }
  const seen = new Map<string, number[]>();
  for (const l of lists) for (const h of l.units) (seen.get(h) ?? seen.set(h, []).get(h)!).push(l.t);
  const deaths = new Map<string, [number, number]>();
  const firstSeen = new Map<string, number>();
  for (const [h, ts] of seen) {
    firstSeen.set(h, ts[0]);
    const last = ts[ts.length - 1];
    const base = lists.find((l) => l.t === last && l.units.has(h))!.units;
    const others = base.size - 1;
    // The first later list that shares most of that group but lacks the unit.
    for (const l of lists) {
      if (l.t <= last) continue;
      let shared = 0;
      for (const x of l.units) if (base.has(x)) shared++;
      if (shared >= Math.max(2, 0.5 * others)) {
        deaths.set(h, [last, l.t]);
        break;
      }
    }
  }
  return { deaths, typeOf, firstSeen };
}
