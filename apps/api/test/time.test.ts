import { describe, expect, it } from 'vitest';
import { addDays, localDateIn, localDayRange, localHourToUtc } from '../src/lib/time';

describe('localDateIn', () => {
  const instant = new Date('2030-01-15T12:00:00Z');

  it('gives the calendar date in the platform time zone', () => {
    expect(localDateIn('UTC', instant)).toBe('2030-01-15');
    expect(localDateIn('Pacific/Kiritimati', instant)).toBe('2030-01-16'); // UTC+14
    expect(localDateIn('Pacific/Pago_Pago', new Date('2030-01-15T05:00:00Z'))).toBe('2030-01-14'); // UTC-11
  });

  it('follows daylight saving time', () => {
    expect(localDateIn('America/New_York', new Date('2030-06-15T02:00:00Z'))).toBe('2030-06-14'); // 22:00 EDT the day before
    expect(localDateIn('America/New_York', new Date('2030-12-15T02:00:00Z'))).toBe('2030-12-14'); // 21:00 EST
  });

  it('always writes YYYY-MM-DD, so dates compare correctly as text', () => {
    expect(localDateIn('UTC', new Date('2030-03-05T00:00:00Z'))).toBe('2030-03-05');
  });
});


describe('localHourToUtc', () => {
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  it('converts a wall-clock hour in the platform time zone to a UTC instant', () => {
    expect(iso(localHourToUtc('2030-01-15', 8, 'UTC'))).toBe('2030-01-15T08:00:00.000Z');
    expect(iso(localHourToUtc('2030-01-15', 8, 'Asia/Karachi'))).toBe('2030-01-15T03:00:00.000Z'); // UTC+5, no daylight saving
    expect(iso(localHourToUtc('2030-01-15', 0, 'Pacific/Kiritimati'))).toBe('2030-01-14T10:00:00.000Z'); // UTC+14
    expect(iso(localHourToUtc('2030-01-15', 23, 'Pacific/Pago_Pago'))).toBe('2030-01-16T10:00:00.000Z'); // UTC-11
  });

  it('follows daylight saving: summer and winter offsets differ', () => {
    expect(iso(localHourToUtc('2030-01-15', 12, 'America/New_York'))).toBe('2030-01-15T17:00:00.000Z'); // EST, UTC-5
    expect(iso(localHourToUtc('2030-07-15', 12, 'America/New_York'))).toBe('2030-07-15T16:00:00.000Z'); // EDT, UTC-4
  });

  it('returns null for an hour that does not exist (clocks go forward on 10 March 2030 in New York)', () => {
    expect(iso(localHourToUtc('2030-03-10', 1, 'America/New_York'))).toBe('2030-03-10T06:00:00.000Z'); // 01:00 EST
    expect(localHourToUtc('2030-03-10', 2, 'America/New_York')).toBeNull(); // 02:00 never happens
    expect(iso(localHourToUtc('2030-03-10', 3, 'America/New_York'))).toBe('2030-03-10T07:00:00.000Z'); // 03:00 EDT, one hour after 01:00 EST
  });

  it('takes the first occurrence of an hour that happens twice (clocks go back on 3 November 2030)', () => {
    expect(iso(localHourToUtc('2030-11-03', 1, 'America/New_York'))).toBe('2030-11-03T05:00:00.000Z'); // 01:00 EDT, not 01:00 EST
    expect(iso(localHourToUtc('2030-11-03', 2, 'America/New_York'))).toBe('2030-11-03T07:00:00.000Z'); // 02:00 EST
  });
});

describe('localDayRange', () => {
  const range = (date: string, tz: string) => {
    const r = localDayRange(date, tz);
    return [r.start.toISOString(), r.end.toISOString()];
  };

  it('covers exactly one calendar day in the zone', () => {
    expect(range('2030-01-16', 'UTC')).toEqual(['2030-01-16T00:00:00.000Z', '2030-01-17T00:00:00.000Z']);
    expect(range('2030-01-16', 'Asia/Karachi')).toEqual(['2030-01-15T19:00:00.000Z', '2030-01-16T19:00:00.000Z']); // UTC+5
  });

  it('is 23 hours long on the day clocks go forward and 25 on the day they go back', () => {
    const hours = (date: string) => { const r = localDayRange(date, 'America/New_York'); return (r.end.getTime() - r.start.getTime()) / 3600000; };
    expect(hours('2030-03-10')).toBe(23);
    expect(hours('2030-11-03')).toBe(25);
  });

  it('starts at the first real hour when midnight itself is skipped (Havana springs forward at 00:00)', () => {
    const r = localDayRange('2030-03-10', 'America/Havana');
    expect(localDateIn('America/Havana', r.start)).toBe('2030-03-10');
    expect(localDateIn('America/Havana', new Date(r.start.getTime() - 1))).toBe('2030-03-09');
  });
});

describe('addDays', () => {
  it('adds calendar days without any time zone', () => {
    expect(addDays('2030-01-15', 14)).toBe('2030-01-29');
    expect(addDays('2030-01-31', 1)).toBe('2030-02-01');
    expect(addDays('2030-12-31', 1)).toBe('2031-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // leap year
    expect(addDays('2029-02-28', 1)).toBe('2029-03-01');
    expect(addDays('2030-03-01', -1)).toBe('2030-02-28');
  });
});
