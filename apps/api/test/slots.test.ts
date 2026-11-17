// The slots of one local day and what each costs (Table 14, A2, FR-2.10). The booking transaction (T9) uses the same functions.
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { daySlots, isPeakHour } from '../src/modules/venues/slots';

const base = { date: '2030-01-16', timeZone: 'UTC', openHour: 8, closeHour: 23, peakStartHour: 18, peakEndHour: 23, priceRegular: '20', pricePeak: '30' };

describe('daySlots', () => {
  it('makes one 60-minute slot per whole hour from opening up to closing', () => {
    const slots = daySlots(base);
    expect(slots).toHaveLength(15); // 08:00 .. 22:00 start times
    expect(slots[0]).toMatchObject({ startHour: 8, endHour: 9 });
    expect(slots.at(-1)).toMatchObject({ startHour: 22, endHour: 23 });
    for (const s of slots) expect(s.endsAt.getTime() - s.startsAt.getTime()).toBe(3_600_000);
  });

  it('prices peak hours with the peak price and all others with the regular price', () => {
    const byHour = Object.fromEntries(daySlots(base).map((s) => [s.startHour, s.price]));
    expect(byHour[17]).toBe('20.00'); // the hour before the peak window
    expect(byHour[18]).toBe('30.00'); // first peak hour
    expect(byHour[22]).toBe('30.00'); // last hour of the window (22:00 to 23:00)
    expect(daySlots(base).filter((s) => s.isPeak).map((s) => s.startHour)).toEqual([18, 19, 20, 21, 22]);
  });

  it('uses the regular price all day when the court has no peak price, or the venue has no peak window', () => {
    expect(new Set(daySlots({ ...base, pricePeak: null }).map((s) => s.price))).toEqual(new Set(['20.00']));
    expect(new Set(daySlots({ ...base, peakStartHour: null, peakEndHour: null }).map((s) => s.price))).toEqual(new Set(['20.00']));
  });

  it('formats money with two decimals from strings and from database decimals', () => {
    expect(daySlots({ ...base, priceRegular: '7.5' })[0]!.price).toBe('7.50');
    expect(daySlots({ ...base, priceRegular: new Prisma.Decimal('1200') })[0]!.price).toBe('1200.00');
    expect(daySlots({ ...base, priceRegular: new Prisma.Decimal('19.999') })[0]!.price).toBe('20.00');
  });

  it('can run to midnight: closing at 24 makes 23:00 to 24:00 the last slot', () => {
    const slots = daySlots({ ...base, openHour: 0, closeHour: 24 });
    expect(slots).toHaveLength(24);
    expect(slots.at(-1)).toMatchObject({ startHour: 23, endHour: 24 });
  });

  it('puts the UTC instants where the platform time zone says (Karachi is UTC+5)', () => {
    const first = daySlots({ ...base, timeZone: 'Asia/Karachi' })[0]!;
    expect(first.startsAt.toISOString()).toBe('2030-01-16T03:00:00.000Z');
    expect(first.endsAt.toISOString()).toBe('2030-01-16T04:00:00.000Z');
  });

  it('leaves out the hour that does not exist when clocks go forward, and the slots still follow each other', () => {
    const slots = daySlots({ ...base, date: '2030-03-10', timeZone: 'America/New_York', openHour: 0, closeHour: 24, peakStartHour: null, peakEndHour: null });
    expect(slots).toHaveLength(23);
    expect(slots.map((s) => s.startHour)).not.toContain(2);
    const at1 = slots.find((s) => s.startHour === 1)!;
    const at3 = slots.find((s) => s.startHour === 3)!;
    expect(at1.endsAt.getTime()).toBe(at3.startsAt.getTime()); // 01:00 EST ends exactly when 03:00 EDT begins
  });
});

describe('isPeakHour', () => {
  it('is half-open: the start hour is peak, the end hour is not', () => {
    expect(isPeakHour(17, 18, 23)).toBe(false);
    expect(isPeakHour(18, 18, 23)).toBe(true);
    expect(isPeakHour(22, 18, 23)).toBe(true);
    expect(isPeakHour(23, 18, 23)).toBe(false);
    expect(isPeakHour(20, null, null)).toBe(false);
    expect(isPeakHour(20, 18, null)).toBe(false);
  });
});
