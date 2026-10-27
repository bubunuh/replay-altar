// Which of WC3V's units existed, and when they died, for the army value, the losses and the fights.
//
// Deaths are WC3V's own (`lostState`: lost or possibly lost, since when). Since 0.2.2 WC3V reads
// the replay's selection lists itself (patches/wc3v: SelectionLedger, HandleBinder,
// SelectionEvidence): a unit the lists show gone dies then, and a trained unit the lists never
// show is marked possibly lost from its training with source "unlisted": an order the game refused
// (no gold or food) or one that was cancelled. Such a unit never existed, so it is left out
// everywhere instead of counting as a unit lost the moment it was trained (on the 36 observer
// games of the WC3V lab, the error of the losses so far fell from 202 to 136 and that of the
// losses per fight from 121 to 102).
//
// Before 0.2.2 Replay Altar corrected WC3V's deaths with the selection lists on its own (the
// replay's selection actions, then matched to WC3V's units). On top of the WC3V that reads them,
// that correction made the army value worse (100 → 150 on those games, 88 → 136 on 14 games the
// lab never saw) and the fights no better, so it was dropped (docs/DATA.md).
import type { WOutput } from "./economy.ts";

type U = { lostState?: { state: string; since: number; source?: string } | null };

/** When WC3V says the unit died (lost or possibly lost), or null. */
export const diedAt = (u: U) => (u.lostState?.state === "lost" || u.lostState?.state === "possiblyLost" ? u.lostState.since : null);

/** A unit WC3V made for a train order the game refused or cancelled (the lists never showed it). */
export const neverMade = (u: U) => diedAt(u) !== null && u.lostState!.source === "unlisted";

/** The output without the units that never existed (a shallow copy; the output itself is untouched). */
export function withoutNeverMade(o: WOutput): WOutput {
  const players = Object.fromEntries(Object.entries(o.players).map(([id, p]) => [id, p.units ? { ...p, units: p.units.filter((u) => !neverMade(u)) } : p]));
  return { ...o, players };
}
