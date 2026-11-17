// Small formatting helpers used by the API and by both clients, so a date, an hour or an amount reads the same everywhere (USA-5).

/** A calendar date (YYYY-MM-DD) plus a number of days, with no time zone involved. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 8 becomes "08:00"; 24 becomes "24:00" (closing at midnight). */
export const formatHour = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

/**
 * An amount for people: "1200.00" becomes "1,200", "10.50" stays "10.50". No currency symbol: each venue uses one local currency
 * shown as a plain amount (assumption A1, decision Q4 open).
 */
export function formatAmount(amount: string): string {
  const [whole = '0', fraction = '00'] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === '00' ? grouped : `${grouped}.${fraction}`;
}

/** "Wednesday, 16 January 2030" for a calendar date. Pure calendar arithmetic in UTC, so no time zone can shift the day. */
export function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const toCents = (amount: string): number => {
  const [whole = '0', fraction = '00'] = amount.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
};

/** Adds money strings exactly, in whole cents (no floating point): ["10.10", "20.20"] gives "30.30". */
export function sumAmounts(amounts: string[]): string {
  const total = amounts.reduce((sum, a) => sum + toCents(a), 0);
  return `${Math.floor(total / 100)}.${String(total % 100).padStart(2, '0')}`;
}
