// Public venue discovery (FR-2.1, FR-2.2, FR-2.3) and availability (FR-2.5). Nothing here needs a sign-in (D10), and nothing here
// reveals who booked what: a slot is only ever Available, Booked, Blocked or Past.
//
// Scale note: the list is filtered by the database but sorted and paged in memory. That is deliberate for a pilot (venues number
// in the dozens, and sorting by "cheapest court" is awkward in SQL); revisit it if venues reach the thousands.
import {
  PAGE_SIZE,
  type Availability,
  type Policy,
  type SlotState,
  type VenueDetail,
  type VenueListQuery,
  type VenueSummary,
} from '@athleteverse/shared';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Tx } from '../../db/tx';
import type { AppDeps } from '../../lib/deps';
import { notFound, validationError } from '../../lib/errors';
import { addDays, localDateIn } from '../../lib/time';
import { daySlots, type DaySlot } from './slots';

const money = (value: Prisma.Decimal): string => value.toFixed(2);

/** Prisma's `contains` hands % and _ to LIKE as wildcards, so a search for "%" would match every venue. Escape them (and the escape character). */
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, '\\$&');

// ---------- list ----------

export async function listVenues(deps: AppDeps, query: VenueListQuery): Promise<{ items: VenueSummary[]; page: number; pageSize: typeof PAGE_SIZE; total: number }> {
  // A venue is listed when at least one ACTIVE court matches every filter that is about courts (sport, price).
  const courtFilter: Prisma.CourtWhereInput = {
    status: 'ACTIVE',
    ...(query.sportId !== undefined && { sportId: query.sportId }),
    ...((query.minPrice !== undefined || query.maxPrice !== undefined) && {
      priceRegular: { ...(query.minPrice !== undefined && { gte: query.minPrice }), ...(query.maxPrice !== undefined && { lte: query.maxPrice }) },
    }),
  };
  const search = query.q?.trim() ? escapeLike(query.q.trim()) : undefined;

  const venues = await deps.prisma.venue.findMany({
    where: {
      status: 'ACTIVE',
      ...(query.cityId !== undefined && { cityId: query.cityId }),
      ...(search && { OR: [{ name: { contains: search, mode: 'insensitive' } }, { address: { contains: search, mode: 'insensitive' } }] }),
      courts: { some: courtFilter },
    },
    include: { city: { select: { name: true } }, courts: { where: courtFilter, include: { sport: { select: { id: true, name: true } } } } },
  });

  const summaries = venues.map((v) => {
    const cheapest = v.courts.map((c) => c.priceRegular).reduce((a, b) => (b.lt(a) ? b : a));
    const sports = [...new Map(v.courts.map((c) => [c.sport.id, c.sport])).values()].sort((a, b) => a.name.localeCompare(b.name));
    return { summary: { id: v.id, name: v.name, address: v.address, cityId: v.cityId, cityName: v.city.name, openHour: v.openHour, closeHour: v.closeHour, sports, courtCount: v.courts.length, fromPrice: money(cheapest) }, cheapest };
  });

  summaries.sort((a, b) => {
    if (query.sort === 'price' && !a.cheapest.eq(b.cheapest)) return a.cheapest.lt(b.cheapest) ? -1 : 1;
    return a.summary.name.localeCompare(b.summary.name, 'en', { sensitivity: 'base' });
  });

  const start = (query.page - 1) * PAGE_SIZE;
  return { items: summaries.slice(start, start + PAGE_SIZE).map((s) => s.summary), page: query.page, pageSize: PAGE_SIZE, total: summaries.length };
}

// ---------- detail ----------

async function loadPolicy(deps: AppDeps): Promise<Policy> {
  const { settings } = deps;
  const [advanceDays, minLeadMinutes, maxSlots, freeCancelHours, lastMinuteHours, penaltyLate, penaltyLastMinute, noShowWaitMinutes, penaltyNoShow, penaltyUnpaid] =
    await Promise.all([
      settings.get('advance_days'),
      settings.get('min_lead_minutes'),
      settings.get('max_slots'),
      settings.get('free_cancel_hours'),
      settings.get('last_minute_hours'),
      settings.get('penalty_late'),
      settings.get('penalty_lastmin'),
      settings.get('no_show_wait_minutes'),
      settings.get('penalty_noshow'),
      settings.get('penalty_unpaid'),
    ]);
  return { advanceDays, minLeadMinutes, maxSlots, freeCancelHours, lastMinuteHours, penaltyLate, penaltyLastMinute, noShowWaitMinutes, penaltyNoShow, penaltyUnpaid };
}

export async function getVenue(deps: AppDeps, venueId: string): Promise<VenueDetail> {
  const venue = await deps.prisma.venue.findFirst({
    where: { id: venueId, status: 'ACTIVE' },
    include: { city: { select: { name: true } }, courts: { where: { status: 'ACTIVE' }, include: { sport: { select: { name: true } } }, orderBy: { name: 'asc' } } },
  });
  if (!venue) throw notFound('Venue'); // suspended and inactive venues look exactly like missing ones

  const policy = await loadPolicy(deps);
  const window = bookingWindow(deps, deps.clock.now(), policy.advanceDays);
  return {
    id: venue.id,
    name: venue.name,
    description: venue.description,
    address: venue.address,
    cityId: venue.cityId,
    cityName: venue.city.name,
    contactPhone: venue.phone,
    openHour: venue.openHour,
    closeHour: venue.closeHour,
    peakStartHour: venue.peakStartHour,
    peakEndHour: venue.peakEndHour,
    courts: venue.courts.map((c) => ({ id: c.id, name: c.name, sportId: c.sportId, sportName: c.sport.name, priceRegular: money(c.priceRegular), pricePeak: c.pricePeak ? money(c.pricePeak) : null })),
    policy,
    timeZone: deps.env.PLATFORM_TZ,
    bookingWindow: window,
  };
}

// ---------- availability ----------

export type VenueWithCourts = Prisma.VenueGetPayload<{ include: { city: { select: { name: true } }; courts: { include: { sport: { select: { name: true } } } } } }>;
type Court = VenueWithCourts['courts'][number];
export type DaySlotWithState = DaySlot & { state: SlotState };
export interface CourtDay {
  court: Court;
  slots: DaySlotWithState[];
}

/** Active venue with its active courts, in court-name order, or null. The one place that decides what "bookable" means for a venue. */
export function findBookableVenue(db: Pick<PrismaClient | Tx, 'venue'>, venueId: string): Promise<VenueWithCourts | null> {
  return db.venue.findFirst({
    where: { id: venueId, status: 'ACTIVE' },
    include: { city: { select: { name: true } }, courts: { where: { status: 'ACTIVE' }, include: { sport: { select: { name: true } } }, orderBy: { name: 'asc' } } },
  });
}

/**
 * The state of every hour of one local day on every court of a venue: Past, Booked, Blocked or Available (FR-2.5).
 * The availability grid, the booking re-check and the "alternatives" offered after a clash all use this, so they cannot disagree.
 */
export async function computeDay(
  db: Pick<PrismaClient | Tx, 'booking' | 'courtBlock'>,
  deps: Pick<AppDeps, 'env'>,
  venue: VenueWithCourts,
  date: string,
  now: Date,
  minLeadMinutes: number,
): Promise<CourtDay[]> {
  const perCourt = venue.courts.map((court) => ({
    court,
    slots: daySlots({
      date,
      timeZone: deps.env.PLATFORM_TZ,
      openHour: venue.openHour,
      closeHour: venue.closeHour,
      peakStartHour: venue.peakStartHour,
      peakEndHour: venue.peakEndHour,
      priceRegular: court.priceRegular,
      pricePeak: court.pricePeak,
    }),
  }));

  const all = perCourt.flatMap((c) => c.slots);
  type Span = { courtId: string; startTime: Date; endTime: Date };
  let bookings: Span[] = [];
  let blocks: Span[] = [];
  if (all.length) {
    const dayStart = new Date(Math.min(...all.map((s) => s.startsAt.getTime())));
    const dayEnd = new Date(Math.max(...all.map((s) => s.endsAt.getTime())));
    const overlapping = { courtId: { in: venue.courts.map((c) => c.id) }, startTime: { lt: dayEnd }, endTime: { gt: dayStart } };
    [bookings, blocks] = await Promise.all([
      // the same statuses the database exclusion constraint treats as "taking the slot" (SRS 10.2)
      db.booking.findMany({ where: { ...overlapping, status: { in: ['CONFIRMED', 'COMPLETED'] } }, select: { courtId: true, startTime: true, endTime: true } }),
      db.courtBlock.findMany({ where: overlapping, select: { courtId: true, startTime: true, endTime: true } }),
    ]);
  }

  const bookableFrom = now.getTime() + minLeadMinutes * 60_000; // FR-2.7: not later than 30 minutes before the start
  const takes = (spans: Span[], courtId: string, start: Date, end: Date) =>
    spans.some((s) => s.courtId === courtId && s.startTime < end && s.endTime > start);

  return perCourt.map(({ court, slots }) => ({
    court,
    slots: slots.map((s) => ({
      ...s,
      state:
        s.startsAt.getTime() < bookableFrom
          ? ('PAST' as const)
          : takes(bookings, court.id, s.startsAt, s.endsAt)
            ? ('BOOKED' as const)
            : takes(blocks, court.id, s.startsAt, s.endsAt)
              ? ('BLOCKED' as const)
              : ('AVAILABLE' as const),
    })),
  }));
}

/** FR-2.7: the dates a player may look at and book: today (platform time zone) up to `advance_days` ahead. */
export function bookingWindow(deps: Pick<AppDeps, 'env'>, now: Date, advanceDays: number): { today: string; lastDate: string } {
  const today = localDateIn(deps.env.PLATFORM_TZ, now);
  return { today, lastDate: addDays(today, advanceDays) };
}

export async function getAvailability(deps: AppDeps, venueId: string, date: string): Promise<Availability> {
  const [advanceDays, minLeadMinutes] = await Promise.all([deps.settings.get('advance_days'), deps.settings.get('min_lead_minutes')]);
  const now = deps.clock.now();
  const { today, lastDate } = bookingWindow(deps, now, advanceDays);
  if (date < today || date > lastDate) {
    throw validationError([{ in: 'query', path: 'date', message: `Choose a date from ${today} to ${lastDate}.` }]);
  }

  const venue = await findBookableVenue(deps.prisma, venueId);
  if (!venue) throw notFound('Venue');

  const days = await computeDay(deps.prisma, deps, venue, date, now, minLeadMinutes);
  return {
    date,
    timeZone: deps.env.PLATFORM_TZ,
    courts: days.map(({ court, slots }) => ({
      courtId: court.id,
      name: court.name,
      sportId: court.sportId,
      sportName: court.sport.name,
      slots: slots.map((s) => ({
        startHour: s.startHour,
        endHour: s.endHour,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        price: s.price,
        state: s.state,
      })),
    })),
  };
}
