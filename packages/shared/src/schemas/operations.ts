// MVP booking management and credit contracts, shared by web and the API.
import { z } from 'zod';
import { bookingSchema } from './bookings';
import { idSchema, pageOf } from './common';
import { ROLES, TIERS } from '../enums';

export const myBookingsResponseSchema = z.object({ items: z.array(bookingSchema) });
export type MyBookingsResponse = z.infer<typeof myBookingsResponseSchema>;
export const cancellationPreviewSchema = z.object({ band: z.enum(['FREE', 'LATE', 'LAST_MINUTE', 'STARTED']), penalty: z.number().int(), startsAt: z.iso.datetime() });
export type CancellationPreview = z.infer<typeof cancellationPreviewSchema>;
export const cancellationResultSchema = z.object({ ok: z.literal(true), penalty: z.number().int(), band: cancellationPreviewSchema.shape.band });
export const outcomeRequestSchema = z.object({ outcome: z.enum(['PAID', 'UNPAID', 'NO_SHOW']), amount: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).optional() });
export const outcomeResultSchema = z.object({ ok: z.literal(true), creditScore: z.number().int(), creditTier: z.enum(TIERS) });
export const venueBookingSchema = bookingSchema.extend({ player: z.object({ id: idSchema, fullName: z.string(), phone: z.string(), creditScore: z.number().int(), creditTier: z.enum(TIERS) }) });
export type VenueBooking = z.infer<typeof venueBookingSchema>;
export const venueBookingsResponseSchema = pageOf(venueBookingSchema); // PERF-4: 20 per page
export type VenueBookingsResponse = z.infer<typeof venueBookingsResponseSchema>;
export const creditSummarySchema = z.object({
  score: z.number().int().min(0).max(100), tier: z.enum(TIERS),
  events: z.array(z.object({ id: idSchema, bookingId: idSchema.nullable(), type: z.string(), points: z.number().int(), scoreAfter: z.number().int(), createdAt: z.iso.datetime() })),
});
export type CreditSummary = z.infer<typeof creditSummarySchema>;

export const bookingReceiptSchema = z.object({
  code: z.string().length(8), venueName: z.string(), courtName: z.string(),
  amountReceived: z.string(), paidAt: z.iso.datetime(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(),
});
export type BookingReceipt = z.infer<typeof bookingReceiptSchema>;

/** FR-5.3: one entry of a booking's status history, as shown to the venue (derived from the audit log and credit ledger). */
export const BOOKING_HISTORY_EVENTS = ['CREATED', 'PLAYER_CANCELLED', 'VENUE_CANCELLED', 'PAID', 'UNPAID', 'NO_SHOW', 'AUTO_CLOSED', 'CREDIT'] as const;
export type BookingHistoryEvent = (typeof BOOKING_HISTORY_EVENTS)[number];
export const bookingHistoryEntrySchema = z.object({
  at: z.iso.datetime(),
  event: z.enum(BOOKING_HISTORY_EVENTS),
  by: z.object({ name: z.string(), role: z.enum(ROLES) }).nullable(), // null: the system (timed job)
  reason: z.string().nullable(),
  points: z.number().int().nullable(), // CREDIT entries: the change applied to the player's score
  amount: z.string().nullable(), // PAID entries: the cash received
});
export type BookingHistoryEntry = z.infer<typeof bookingHistoryEntrySchema>;
export const venueBookingDetailSchema = venueBookingSchema.extend({
  amountReceived: z.string().nullable(),
  cancelReason: z.string().nullable(),
  history: z.array(bookingHistoryEntrySchema),
});
export type VenueBookingDetail = z.infer<typeof venueBookingDetailSchema>;

/** FR-5.1 (MVP slice): the manager's day for one venue or all of them, and the bookings that need an action. */
export const managerHomeQuerySchema = z.object({ venueId: idSchema.optional() });
export const managerHomeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // today in the platform time zone
  venues: z.array(z.object({ id: idSchema, name: z.string() })),
  courts: z.array(z.object({ id: idSchema, name: z.string(), venueName: z.string(), bookings: z.array(venueBookingSchema) })),
  needsOutcome: z.array(venueBookingSchema), // started, still Confirmed: record Paid, Unpaid or No-Show
  awaitingCash: z.array(venueBookingSchema), // closed automatically, cash can still be confirmed by the manager
});
export type ManagerHome = z.infer<typeof managerHomeSchema>;
