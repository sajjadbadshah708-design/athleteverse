import type { Prisma } from '@prisma/client';
import { localDateIn } from '../../lib/time';

export const BOOKING_INCLUDE = {
  court: { include: { venue: { include: { city: true } }, sport: true } },
} as const;
export type DetailedBooking = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

export function bookingView(b: DetailedBooking, tz: string) {
  const date = localDateIn(tz, b.startTime);
  const startHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(b.startTime));
  const hours = Math.round((b.endTime.getTime() - b.startTime.getTime()) / 3600000);
  return {
    id: b.id, code: b.bookingCode, status: b.status, paymentStatus: b.paymentStatus,
    startsAt: b.startTime.toISOString(), endsAt: b.endTime.toISOString(), date, startHour, endHour: startHour + hours,
    hours, totalPrice: b.totalPrice.toFixed(2),
    court: { id: b.court.id, name: b.court.name, sportName: b.court.sport.name },
    venue: { id: b.court.venue.id, name: b.court.venue.name, address: b.court.venue.address, cityName: b.court.venue.city.name, contactPhone: b.court.venue.phone },
    createdAt: b.createdAt.toISOString(),
  };
}
