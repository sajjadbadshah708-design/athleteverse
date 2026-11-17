import { z } from 'zod';
import { BOOKING_STATUSES, PAYMENT_STATUSES, TIERS } from '../enums';
import { idSchema } from './common';
import { dateSchema, moneySchema } from './venues';

// Creating a booking (SRS FR-2.7 to FR-2.11, Table 14). A booking is one court, one date, 1 to 3 consecutive 60-minute slots.

export const BOOKING_MAX_SLOTS = 3; // Table 14; the database also checks 1 to 3 hours

export const BOOKING_MESSAGES = {
  notASlot: 'Choose hours that this court offers, up to its closing time.',
  tooLate: (minutes: number) => `This hour can no longer be booked: bookings close ${minutes} minutes before the start.`,
  tooFar: (days: number) => `You can book up to ${days} days ahead.`,
  tooManySlots: (max: number) => `You can book at most ${max} hours at a time.`,
} as const;

export const createBookingRequestSchema = z.object({
  courtId: idSchema,
  startsAt: z.iso.datetime(), // the exact start of the first hour, as the availability grid sent it
  slots: z.number().int().min(1).max(BOOKING_MAX_SLOTS),
});
export type CreateBookingRequest = z.infer<typeof createBookingRequestSchema>;

export const bookingSchema = z.object({
  id: idSchema,
  code: z.string().length(8), // shown at the venue to find the booking (FR-2.8)
  status: z.enum(BOOKING_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  date: dateSchema, // the local date, in the platform time zone
  startHour: z.number().int(),
  endHour: z.number().int(), // 24 when the booking runs to midnight
  hours: z.number().int(),
  totalPrice: moneySchema, // fixed at booking time: later price changes never affect it (FR-2.10)
  court: z.object({ id: idSchema, name: z.string(), sportName: z.string() }),
  venue: z.object({ id: idSchema, name: z.string(), address: z.string(), cityName: z.string(), contactPhone: z.string() }),
  createdAt: z.iso.datetime(),
});
export type Booking = z.infer<typeof bookingSchema>;

/** Sent with SLOT_TAKEN: other windows of the same length, nearest to the one wanted (SRS 5.3: "the other receives alternative slots"). */
export const alternativeSchema = z.object({
  courtId: idSchema,
  courtName: z.string(),
  startsAt: z.iso.datetime(),
  startHour: z.number().int(),
  endHour: z.number().int(),
  slots: z.number().int(),
  price: moneySchema,
});
export type Alternative = z.infer<typeof alternativeSchema>;

export const tierLimitDetailsSchema = z.object({ tier: z.enum(TIERS), limit: z.number().int(), upcoming: z.number().int() });
export type TierLimitDetails = z.infer<typeof tierLimitDetailsSchema>;
