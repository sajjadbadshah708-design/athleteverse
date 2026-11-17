// One bookable slot is 60 minutes on a whole hour (Table 14, A2). These pure functions turn a venue's opening hours, peak window
// and a court's prices into the slots of one local day. The booking transaction (T9) uses the same functions to price a booking,
// so what a player sees and what a booking costs can never disagree (FR-2.10).
import { addDays, HOUR, localHourToUtc } from '../../lib/time';

type DecimalLike = { toFixed(fractionDigits?: number): string };

export interface DaySlot {
  startHour: number; // local wall-clock hour, for display
  endHour: number;
  startsAt: Date;
  endsAt: Date;
  price: string; // "20.00"
  isPeak: boolean;
}

export interface DaySlotInput {
  date: string; // YYYY-MM-DD in the platform time zone
  timeZone: string;
  openHour: number; // 0..23
  closeHour: number; // 1..24, after openHour
  peakStartHour: number | null;
  peakEndHour: number | null;
  priceRegular: DecimalLike | string;
  pricePeak: DecimalLike | string | null;
}

const money = (value: DecimalLike | string): string => (typeof value === 'string' ? Number(value).toFixed(2) : value.toFixed(2));

/** Peak applies to the hours from peakStart up to (not including) peakEnd, and only when the court has a peak price. */
export function isPeakHour(hour: number, peakStartHour: number | null, peakEndHour: number | null): boolean {
  return peakStartHour !== null && peakEndHour !== null && hour >= peakStartHour && hour < peakEndHour;
}

/** The slots of one local day, in time order. A wall-clock hour that does not exist that day (clocks going forward) is left out. */
export function daySlots(input: DaySlotInput): DaySlot[] {
  const slots: DaySlot[] = [];
  for (let hour = input.openHour; hour < input.closeHour; hour++) {
    // closeHour 24 means midnight: hours never run past the day (A2), so the last slot is 23:00 to 24:00
    const startsAt = localHourToUtc(input.date, hour, input.timeZone);
    if (!startsAt) continue;
    const isPeak = input.pricePeak !== null && isPeakHour(hour, input.peakStartHour, input.peakEndHour);
    slots.push({
      startHour: hour,
      endHour: hour + 1,
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      price: money(isPeak ? input.pricePeak! : input.priceRegular),
      isPeak,
    });
  }
  return slots;
}

export { addDays };
