// Creating a booking: the heart of the platform (SRS FR-2.7 to FR-2.11, FR-2.9, REL-1, Table 14, section 5.3).
//
// Why a double booking cannot happen: three independent layers.
//   1. The screen only offers free hours (the availability grid, computed by the same computeDay used below).
//   2. This transaction locks the player row, then the court row (always in that order: users -> courts -> bookings), and
//      re-checks bookings and blocks against fresh data. Two players tapping at the same instant queue up on the court lock;
//      the second one sees the first one's booking and is told so.
//   3. PostgreSQL exclusion constraints reject any overlapping active booking of a court (bookings_no_court_overlap) or of a
//      player (bookings_no_player_overlap), even if layers 1 and 2 were somehow bypassed. translateBookingConflict turns
//      those database errors into the same answers a player would get from layer 2.
//
// Everything inside withTx is database work only (it can run twice after a deadlock); the e-mail goes out after the commit.
import {
  BOOKING_MESSAGES,
  formatAmount,
  formatDateLong,
  formatHour,
  sumAmounts,
  tierOf,
  type Alternative,
  type Booking,
  type CreateBookingRequest,
} from '@athleteverse/shared';
import { Prisma } from '@prisma/client';
import { constraintName, SQLSTATE, sqlState } from '../../db/pgErrors';
import { lockCourt, lockUser, withTx } from '../../db/tx';
import type { AppDeps } from '../../lib/deps';
import { AppError, forbidden, notFound, validationError } from '../../lib/errors';
import { sendSafely } from '../../lib/mailer/mailer';
import { bookingConfirmedMessage } from '../../lib/mailer/templates';
import { HOUR, localDateIn } from '../../lib/time';
import { assertProfileComplete } from '../users/completeness';
import { bookingWindow, computeDay, findBookableVenue } from '../venues/venues.service';
import { daySlots } from '../venues/slots';
import { generateBookingCode } from './code';

const TAKING_SLOT = ['CONFIRMED', 'COMPLETED'] as const; // the statuses the exclusion constraints treat as holding a slot
const MAX_ALTERNATIVES = 5;

const slotTaken = () => new AppError('SLOT_TAKEN', 'That time was just taken');
const bookingOverlap = () => new AppError('BOOKING_OVERLAP', 'You already have a booking at that time');

/** Layer 3: what a violated database constraint means for the player. Null for any other error. */
export function translateBookingConflict(err: unknown): AppError | null {
  if (sqlState(err) !== SQLSTATE.exclusionViolation) return null;
  const name = constraintName(err);
  if (name === 'bookings_no_player_overlap') return bookingOverlap();
  if (name === 'bookings_no_court_overlap') return slotTaken();
  return null;
}

interface Context {
  venueId?: string;
  sportId?: number;
}

export async function createBooking(deps: AppDeps, playerId: string, input: CreateBookingRequest): Promise<Booking> {
  const { prisma, clock, env, settings } = deps;
  const [advanceDays, minLeadMinutes, maxSlots, tierGood, tierCaution, upcomingLimits, freeCancelHours] = await Promise.all([
    settings.get('advance_days'),
    settings.get('min_lead_minutes'),
    settings.get('max_slots'),
    settings.get('tier_good'),
    settings.get('tier_caution'),
    settings.get('upcoming_limits'),
    settings.get('free_cancel_hours'),
  ]);
  if (input.slots > maxSlots) {
    throw validationError([{ in: 'body', path: 'slots', message: BOOKING_MESSAGES.tooManySlots(maxSlots) }]);
  }
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + input.slots * HOUR);
  const now = clock.now();
  const ctx: Context = {};

  try {
    const done = await withTx(prisma, async (tx) => {
      // ---- the player (lock 1) ----
      const player = await lockUser(tx, playerId);
      if (!player || player.role !== 'PLAYER') throw forbidden();
      if (player.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED', 'Your account has been suspended');
      if (player.status !== 'ACTIVE') throw forbidden();
      await assertProfileComplete(tx, playerId); // FR-1.15

      // FR-2.11, FR-2.25: the credit tier sets how many upcoming bookings a player may hold. The user lock above makes this
      // count-then-insert safe: two simultaneous bookings of one player queue up here.
      const tier = player.blockedAt ? 'BLOCKED' : tierOf(player.creditScore, { good: tierGood, caution: tierCaution });
      const limit = upcomingLimits[tier];
      const upcoming = await tx.booking.count({ where: { playerId, status: 'CONFIRMED', startTime: { gt: now } } });
      if (upcoming >= limit) throw new AppError('TIER_LIMIT', 'Booking limit reached for your credit tier', { tier, limit, upcoming });

      // ---- the court (lock 2): everything below is judged against the court as it is NOW ----
      const lockedCourt = await lockCourt(tx, input.courtId);
      if (!lockedCourt || lockedCourt.status !== 'ACTIVE') throw notFound('Court');
      const venue = await findBookableVenue(tx, lockedCourt.venueId);
      const court = venue?.courts.find((c) => c.id === lockedCourt.id);
      if (!venue || !court) throw notFound('Court');
      ctx.venueId = venue.id;
      ctx.sportId = court.sportId;

      // The requested hours must be real, consecutive slots of this court's local day (opening hours, whole hours, same day: A2).
      const date = localDateIn(env.PLATFORM_TZ, startsAt);
      const daySlotList = daySlots({
        date,
        timeZone: env.PLATFORM_TZ,
        openHour: venue.openHour,
        closeHour: venue.closeHour,
        peakStartHour: venue.peakStartHour,
        peakEndHour: venue.peakEndHour,
        priceRegular: court.priceRegular,
        pricePeak: court.pricePeak,
      });
      const first = daySlotList.findIndex((s) => s.startsAt.getTime() === startsAt.getTime());
      const wanted = first < 0 ? [] : daySlotList.slice(first, first + input.slots);
      const contiguous = wanted.length === input.slots && wanted.every((s, i) => s.startsAt.getTime() === startsAt.getTime() + i * HOUR);
      if (!contiguous) throw validationError([{ in: 'body', path: 'startsAt', message: BOOKING_MESSAGES.notASlot }]);

      // FR-2.7: up to 14 days ahead, and not later than 30 minutes before the start
      if (startsAt.getTime() < now.getTime() + minLeadMinutes * 60_000) {
        throw validationError([{ in: 'body', path: 'startsAt', message: BOOKING_MESSAGES.tooLate(minLeadMinutes) }]);
      }
      if (date > bookingWindow(deps, now, advanceDays).lastDate) {
        throw validationError([{ in: 'body', path: 'startsAt', message: BOOKING_MESSAGES.tooFar(advanceDays) }]);
      }

      // ---- layer 2: re-check against the database, under the locks ----
      const holdingNow = { status: { in: [...TAKING_SLOT] }, startTime: { lt: endsAt }, endTime: { gt: startsAt } };
      if (await tx.booking.findFirst({ where: { playerId, ...holdingNow }, select: { id: true } })) throw bookingOverlap();
      if (await tx.booking.findFirst({ where: { courtId: court.id, ...holdingNow }, select: { id: true } })) throw slotTaken();
      if (await tx.courtBlock.findFirst({ where: { courtId: court.id, startTime: { lt: endsAt }, endTime: { gt: startsAt } }, select: { id: true } })) {
        throw slotTaken();
      }

      // ---- the booking: the price is the sum of the slot prices NOW and never changes afterwards (FR-2.10) ----
      const total = wanted.reduce((sum, s) => sum.plus(s.price), new Prisma.Decimal(0));
      let code = generateBookingCode();
      while (await tx.booking.findUnique({ where: { bookingCode: code }, select: { id: true } })) code = generateBookingCode();
      const row = await tx.booking.create({
        data: { bookingCode: code, courtId: court.id, playerId, startTime: startsAt, endTime: endsAt, totalPrice: total, createdAt: now }, // the injected clock, like every other timestamp
      });
      const owner = await tx.user.findUniqueOrThrow({ where: { id: playerId }, select: { email: true } });

      const booking: Booking = {
        id: row.id,
        code: row.bookingCode,
        status: row.status,
        paymentStatus: row.paymentStatus,
        startsAt: row.startTime.toISOString(),
        endsAt: row.endTime.toISOString(),
        date,
        startHour: wanted[0]!.startHour,
        endHour: wanted[wanted.length - 1]!.endHour,
        hours: input.slots,
        totalPrice: total.toFixed(2),
        court: { id: court.id, name: court.name, sportName: court.sport.name },
        venue: { id: venue.id, name: venue.name, address: venue.address, cityName: venue.city.name, contactPhone: venue.phone },
        createdAt: row.createdAt.toISOString(),
      };
      return { booking, email: owner.email };
    });

    // After the commit (REL-4: a failing mail provider never undoes a booking).
    const b = done.booking;
    await sendSafely(
      deps,
      bookingConfirmedMessage(done.email, {
        code: b.code,
        venueName: b.venue.name,
        venueAddress: `${b.venue.address}, ${b.venue.cityName}`,
        courtName: b.court.name,
        dateText: formatDateLong(b.date),
        timeText: `${formatHour(b.startHour)} to ${formatHour(b.endHour)}`,
        totalText: formatAmount(b.totalPrice),
        freeCancelHours,
      }),
    );
    return b;
  } catch (err) {
    const mapped = translateBookingConflict(err) ?? err;
    if (mapped instanceof AppError && mapped.code === 'SLOT_TAKEN' && ctx.venueId && ctx.sportId !== undefined) {
      // SRS 5.3: "exactly one succeeds and the other receives alternative slots". Looked up after the rollback, on fresh data.
      const alternatives = await findAlternatives(deps, ctx.venueId, ctx.sportId, input, minLeadMinutes);
      throw new AppError('SLOT_TAKEN', mapped.message, { alternatives });
    }
    throw mapped;
  }
}

/** Free windows of the same length, on courts of the same sport, on the same day, nearest to the time that was wanted. */
export async function findAlternatives(
  deps: AppDeps,
  venueId: string,
  sportId: number,
  wanted: CreateBookingRequest,
  minLeadMinutes: number,
): Promise<Alternative[]> {
  const venue = await findBookableVenue(deps.prisma, venueId);
  if (!venue) return [];
  const startsAt = new Date(wanted.startsAt);
  const date = localDateIn(deps.env.PLATFORM_TZ, startsAt);
  const days = await computeDay(deps.prisma, deps, venue, date, deps.clock.now(), minLeadMinutes);

  const found: { alternative: Alternative; distance: number }[] = [];
  for (const { court, slots } of days) {
    if (court.sportId !== sportId) continue;
    for (let i = 0; i + wanted.slots <= slots.length; i++) {
      const window = slots.slice(i, i + wanted.slots);
      const start = window[0]!.startsAt;
      const contiguous = window.every((s, k) => s.startsAt.getTime() === start.getTime() + k * HOUR);
      if (!contiguous || window.some((s) => s.state !== 'AVAILABLE')) continue;
      if (court.id === wanted.courtId && start.getTime() === startsAt.getTime()) continue; // the one that was just taken
      found.push({
        distance: Math.abs(start.getTime() - startsAt.getTime()),
        alternative: {
          courtId: court.id,
          courtName: court.name,
          startsAt: start.toISOString(),
          startHour: window[0]!.startHour,
          endHour: window[window.length - 1]!.endHour,
          slots: wanted.slots,
          price: sumAmounts(window.map((s) => s.price)),
        },
      });
    }
  }
  found.sort((a, b) => a.distance - b.distance || a.alternative.courtName.localeCompare(b.alternative.courtName) || a.alternative.startsAt.localeCompare(b.alternative.startsAt));
  return found.slice(0, MAX_ALTERNATIVES).map((f) => f.alternative);
}
