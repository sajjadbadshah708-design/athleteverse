import { z } from 'zod';
import { SLOT_STATES } from '../enums';
import { idSchema, pageOf } from './common';
import { isRealDate } from './profile';

// Public venue discovery and availability (SRS FR-2.1, FR-2.2, FR-2.3, FR-2.5). Times of day are whole hours in the platform
// time zone (A2, N4): the API sends the hour number for display and the exact UTC instant for logic, so no client ever has to
// guess a time zone.

/** Money is a string like "1200.00", never a float (design principle: money as decimal). */
export const moneySchema = z.string().regex(/^\d{1,8}\.\d{2}$/);

export const VENUE_SORTS = ['name', 'price'] as const;
export type VenueSort = (typeof VENUE_SORTS)[number];

export const SEARCH_MAX_LENGTH = 80;

export const dateSchema = z.string().refine(isRealDate, 'Choose a valid date.');

export const venueListQuerySchema = z.object({
  q: z.string().trim().max(SEARCH_MAX_LENGTH).optional(), // matches the venue name or address
  cityId: z.coerce.number().int().positive().optional(),
  sportId: z.coerce.number().int().positive().optional(),
  minPrice: z.coerce.number().min(0).max(99_999_999).optional(), // regular hourly price of a court
  maxPrice: z.coerce.number().min(0).max(99_999_999).optional(),
  sort: z.enum(VENUE_SORTS).default('name'),
  page: z.coerce.number().int().min(1).default(1),
});
export type VenueListQuery = z.infer<typeof venueListQuerySchema>;

export const venueSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  address: z.string(),
  cityId: z.number().int(),
  cityName: z.string(),
  openHour: z.number().int(),
  closeHour: z.number().int(),
  sports: z.array(z.object({ id: z.number().int(), name: z.string() })), // sports of the courts that match the filters
  courtCount: z.number().int(),
  fromPrice: moneySchema, // cheapest regular hourly price among the matching courts
});
export const venueListResponseSchema = pageOf(venueSummarySchema);
export type VenueSummary = z.infer<typeof venueSummarySchema>;

export const courtSchema = z.object({
  id: idSchema,
  name: z.string(),
  sportId: z.number().int(),
  sportName: z.string(),
  priceRegular: moneySchema,
  pricePeak: moneySchema.nullable(),
});

/** The cancellation and credit rules shown on the venue page (FR-2.3). Values come from the platform settings (Table 26). */
export const policySchema = z.object({
  advanceDays: z.number().int(),
  minLeadMinutes: z.number().int(),
  maxSlots: z.number().int(),
  freeCancelHours: z.number().int(),
  lastMinuteHours: z.number().int(),
  penaltyLate: z.number().int(),
  penaltyLastMinute: z.number().int(),
  noShowWaitMinutes: z.number().int(),
  penaltyNoShow: z.number().int(),
  penaltyUnpaid: z.number().int(),
});
export type Policy = z.infer<typeof policySchema>;

export const venueDetailSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  address: z.string(),
  cityId: z.number().int(),
  cityName: z.string(),
  contactPhone: z.string(), // the venue's business phone, public on purpose (not a player's phone)
  openHour: z.number().int(),
  closeHour: z.number().int(),
  peakStartHour: z.number().int().nullable(),
  peakEndHour: z.number().int().nullable(),
  courts: z.array(courtSchema),
  policy: policySchema,
  timeZone: z.string(),
  bookingWindow: z.object({ today: dateSchema, lastDate: dateSchema }), // the dates a player may look at and book
});
export type VenueDetail = z.infer<typeof venueDetailSchema>;

export const availabilityQuerySchema = z.object({ date: dateSchema });

export const slotStateSchema = z.enum(SLOT_STATES);

export const slotSchema = z.object({
  startHour: z.number().int(), // local hour, for display: "18:00 to 19:00"
  endHour: z.number().int(),
  startsAt: z.iso.datetime(), // exact UTC instants, for logic
  endsAt: z.iso.datetime(),
  state: slotStateSchema,
  price: moneySchema,
});
export type Slot = z.infer<typeof slotSchema>;

export const availabilityResponseSchema = z.object({
  date: dateSchema,
  timeZone: z.string(),
  courts: z.array(z.object({ courtId: idSchema, name: z.string(), sportId: z.number().int(), sportName: z.string(), slots: z.array(slotSchema) })),
});
export type Availability = z.infer<typeof availabilityResponseSchema>;
