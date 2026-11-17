// Which hours of one court the player has chosen (SRS Table 14: one court, one date, 1 to 3 consecutive hours).
// Hours are identified by their exact start instant, not by their position in a list, so a selection survives the grid
// refreshing every 15 seconds. The server re-checks everything when the booking is made.
import type { Alternative, Slot } from '@athleteverse/shared';

export interface Selection {
  courtId: string;
  startsAts: string[]; // consecutive hours, earliest first
}

const HOUR_MS = 3_600_000;
const continues = (earlier: Slot, later: Slot) => earlier.endsAt === later.startsAt;

/**
 * What a tap on an hour does:
 *  - an unavailable hour: nothing;
 *  - the only chosen hour: deselect it;
 *  - the first or last of several chosen hours: shrink the selection;
 *  - an hour right next to the selection (and room left under `max`): extend it;
 *  - anything else (another court, a gap, a full selection): start again with just that hour.
 */
export function nextSelection(current: Selection | null, courtId: string, slots: Slot[], slot: Slot, max: number): Selection | null {
  if (slot.state !== 'AVAILABLE') return current;
  const single: Selection = { courtId, startsAts: [slot.startsAt] };
  if (!current || current.courtId !== courtId) return single;

  const chosen = current.startsAts;
  const at = chosen.indexOf(slot.startsAt);
  if (at >= 0) {
    if (chosen.length === 1) return null;
    if (at === 0) return { courtId, startsAts: chosen.slice(1) };
    if (at === chosen.length - 1) return { courtId, startsAts: chosen.slice(0, -1) };
    return single; // a middle hour: start again from it
  }

  if (chosen.length < max) {
    const byStart = new Map(slots.map((s) => [s.startsAt, s]));
    const first = byStart.get(chosen[0]!);
    const last = byStart.get(chosen[chosen.length - 1]!);
    if (last && continues(last, slot)) return { courtId, startsAts: [...chosen, slot.startsAt] };
    if (first && continues(slot, first)) return { courtId, startsAts: [slot.startsAt, ...chosen] };
  }
  return single;
}

/** The chosen hours as slots, or null when any of them is no longer available (someone booked it) or they are not consecutive. */
export function selectedSlots(selection: Selection | null, courtSlots: Slot[]): Slot[] | null {
  if (!selection) return null;
  const byStart = new Map(courtSlots.map((s) => [s.startsAt, s]));
  const slots = selection.startsAts.map((start) => byStart.get(start));
  if (slots.some((s) => !s || s.state !== 'AVAILABLE')) return null;
  const found = slots as Slot[];
  return found.every((s, i) => i === 0 || continues(found[i - 1]!, s)) ? found : null;
}

/** The hours an alternative offers, as a selection. */
export function alternativeToSelection(alt: Alternative): Selection {
  const start = Date.parse(alt.startsAt);
  return { courtId: alt.courtId, startsAts: Array.from({ length: alt.slots }, (_, k) => new Date(start + k * HOUR_MS).toISOString()) };
}
