// MVP booking management and credit contracts, shared by web and the API.
import { z } from 'zod';
import { bookingSchema } from './bookings';
import { idSchema } from './common';
import { TIERS } from '../enums';

export const myBookingsResponseSchema = z.object({ items: z.array(bookingSchema) });
export type MyBookingsResponse = z.infer<typeof myBookingsResponseSchema>;
export const cancellationPreviewSchema = z.object({ band: z.enum(['FREE', 'LATE', 'LAST_MINUTE', 'STARTED']), penalty: z.number().int(), startsAt: z.iso.datetime() });
export type CancellationPreview = z.infer<typeof cancellationPreviewSchema>;
export const cancellationResultSchema = z.object({ ok: z.literal(true), penalty: z.number().int(), band: cancellationPreviewSchema.shape.band });
export const outcomeRequestSchema = z.object({ outcome: z.enum(['PAID', 'UNPAID', 'NO_SHOW']), amount: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).optional() });
export const outcomeResultSchema = z.object({ ok: z.literal(true), creditScore: z.number().int(), creditTier: z.enum(TIERS) });
export const venueBookingSchema = bookingSchema.extend({ player: z.object({ id: idSchema, fullName: z.string(), phone: z.string(), creditScore: z.number().int(), creditTier: z.enum(TIERS) }) });
export type VenueBooking = z.infer<typeof venueBookingSchema>;
export const venueBookingsResponseSchema = z.object({ items: z.array(venueBookingSchema) });
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
