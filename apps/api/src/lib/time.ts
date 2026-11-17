// Time helpers. All instants are UTC (rule 5); "what day is it" is a question about the platform's time zone (PLATFORM_TZ, N4).
import { addDays } from '@athleteverse/shared';

/** The calendar date (YYYY-MM-DD) that an instant falls on in the given IANA time zone. */
export function localDateIn(timeZone: string, instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** How far the time zone is ahead of UTC at an instant, in milliseconds (positive east of Greenwich). */
function offsetMs(timeZone: string, instantMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return wall - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The UTC instant at which a wall clock in `timeZone` reads `hour`:00 on `date` (YYYY-MM-DD).
 * Returns null when that wall-clock hour does not exist (the hour skipped when clocks go forward); when it happens twice
 * (clocks go back) the first occurrence is returned.
 */
export function localHourToUtc(date: string, hour: number, timeZone: string): Date | null {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, hour, 0, 0);
  // The offset depends on the instant we are looking for, so try the offsets in force a day earlier and a day later.
  const candidates = new Set([wall - offsetMs(timeZone, wall - DAY_MS), wall - offsetMs(timeZone, wall + DAY_MS)]);
  const valid = [...candidates].filter((t) => t + offsetMs(timeZone, t) === wall).sort((a, b) => a - b);
  return valid.length ? new Date(valid[0]!) : null;
}

/** The first instant of a local calendar day; when midnight is skipped by a clock change the day starts at the next real hour. */
function startOfLocalDay(date: string, timeZone: string): Date {
  for (let hour = 0; hour < 4; hour++) {
    const instant = localHourToUtc(date, hour, timeZone);
    if (instant) return instant;
  }
  throw new Error(`No valid start of day for ${date} in ${timeZone}`);
}

/** The UTC range [start, end) covered by a calendar date (YYYY-MM-DD) in the given time zone, for database filters. */
export function localDayRange(date: string, timeZone: string): { start: Date; end: Date } {
  return { start: startOfLocalDay(date, timeZone), end: startOfLocalDay(addDays(date, 1), timeZone) };
}

export { addDays }; // one implementation for the API and the clients

export const HOUR = HOUR_MS;
