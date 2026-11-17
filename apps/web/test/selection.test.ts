// SRS Table 14: one court, 1 to 3 consecutive hours. Pure rules of what a tap on an hour does.
import type { Slot } from '@athleteverse/shared';
import { describe, expect, it } from 'vitest';
import { alternativeToSelection, nextSelection, selectedSlots, type Selection } from '../src/booking/selection';

const HOUR = 3_600_000;
const T0 = Date.UTC(2030, 0, 16, 8);
const iso = (h: number) => new Date(T0 + (h - 8) * HOUR).toISOString();
const slot = (hour: number, state: Slot['state'] = 'AVAILABLE'): Slot => ({ startHour: hour, endHour: hour + 1, startsAt: iso(hour), endsAt: iso(hour + 1), state, price: '20.00' });
const SLOTS = [8, 9, 10, 11, 12, 13].map((h) => slot(h));
const sel = (...hours: number[]): Selection => ({ courtId: 'A', startsAts: hours.map(iso) });
const tap = (current: Selection | null, hour: number, slots = SLOTS, max = 3, court = 'A') =>
  nextSelection(current, court, slots, slots.find((s) => s.startHour === hour)!, max);

describe('tapping hours', () => {
  it('starts a selection with the first tap', () => {
    expect(tap(null, 10)).toEqual(sel(10));
  });

  it('extends to the hour after, or before, up to the limit', () => {
    expect(tap(sel(10), 11)).toEqual(sel(10, 11));
    expect(tap(sel(10), 9)).toEqual(sel(9, 10));
    expect(tap(sel(10, 11), 12)).toEqual(sel(10, 11, 12));
    expect(tap(sel(10, 11), 9)).toEqual(sel(9, 10, 11));
  });

  it('starts again when the limit is full, rather than growing past it', () => {
    expect(tap(sel(9, 10, 11), 12)).toEqual(sel(12));
    expect(tap(sel(9, 10, 11), 8)).toEqual(sel(8));
    expect(tap(sel(10, 11), 12, SLOTS, 2)).toEqual(sel(12)); // a venue setting of 2 hours
  });

  it('starts again with a tap that leaves a gap, or on another court', () => {
    expect(tap(sel(10), 12)).toEqual(sel(12));
    expect(tap(sel(8, 9), 12)).toEqual(sel(12));
    expect(tap(sel(10, 11), 10, SLOTS, 3, 'B')).toEqual({ courtId: 'B', startsAts: [iso(10)] });
  });

  it('shrinks from either end, deselects the last hour, and restarts from a middle hour', () => {
    expect(tap(sel(9, 10, 11), 9)).toEqual(sel(10, 11));
    expect(tap(sel(9, 10, 11), 11)).toEqual(sel(9, 10));
    expect(tap(sel(10), 10)).toBeNull();
    expect(tap(sel(9, 10, 11), 10)).toEqual(sel(10));
  });

  it('ignores hours that cannot be booked', () => {
    const slots = [slot(9), slot(10, 'BOOKED'), slot(11, 'BLOCKED'), slot(12, 'PAST')];
    expect(tap(sel(9), 10, slots)).toEqual(sel(9));
    expect(tap(null, 11, slots)).toBeNull();
    expect(tap(sel(9), 12, slots)).toEqual(sel(9));
  });

  it('does not join hours that are not back to back in time (such as either side of a skipped hour)', () => {
    const slots = [slot(9), { ...slot(11), startsAt: iso(12), endsAt: iso(13) }]; // 10:00 is missing
    expect(tap(sel(9), 11, slots)).toEqual({ courtId: 'A', startsAts: [iso(12)] });
  });
});

describe('selectedSlots', () => {
  it('returns the chosen hours in order while they are all still available', () => {
    expect(selectedSlots(sel(10, 11), SLOTS)!.map((s) => s.startHour)).toEqual([10, 11]);
  });

  it('returns null when nothing is chosen, when an hour was booked meanwhile, or when an hour has vanished', () => {
    expect(selectedSlots(null, SLOTS)).toBeNull();
    expect(selectedSlots(sel(10, 11), SLOTS.map((s) => (s.startHour === 11 ? slot(11, 'BOOKED') : s)))).toBeNull();
    expect(selectedSlots(sel(10, 11), SLOTS.filter((s) => s.startHour !== 11))).toBeNull();
    expect(selectedSlots(sel(10, 12), SLOTS)).toBeNull(); // not consecutive
  });
});

describe('alternativeToSelection', () => {
  it('turns an offered window into the hours it covers', () => {
    expect(alternativeToSelection({ courtId: 'B', courtName: 'Court B', startsAt: iso(10), startHour: 10, endHour: 12, slots: 2, price: '40.00' })).toEqual({
      courtId: 'B',
      startsAts: [iso(10), iso(11)],
    });
  });
});
