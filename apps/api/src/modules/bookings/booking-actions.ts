// FR-2.13, FR-2.16-2.18, FR-2.20-2.24: cancellation and outcomes.
// All credit updates are atomic with the booking transition and impossible to repeat.
import type { AppDeps } from '../../lib/deps';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { withTx, lockBooking, lockCourt, lockUser } from '../../db/tx';
import { applyCredit } from '../credit/credit.service';
import { BOOKING_INCLUDE, bookingView } from './booking-view';
import { tierOf, type BookingHistoryEvent, type Role } from '@athleteverse/shared';
import type { Prisma } from '@prisma/client';
import { escapeLike } from '../../lib/search';
import { localDateIn, localDayRange } from '../../lib/time';

export type Outcome = 'PAID' | 'UNPAID' | 'NO_SHOW';

/** Table 15: after automatic closure the manager may still confirm the cash for this many days. */
export const CASH_CONFIRM_DAYS = 7;

const OPERATOR_INCLUDE = { ...BOOKING_INCLUDE, player: { select: { id: true, fullName: true, phone: true, creditScore: true, blockedAt: true } } } as const;
type OperatorBooking = Prisma.BookingGetPayload<{ include: typeof OPERATOR_INCLUDE }>;

/** A booking as the venue sees it: with the player's phone (FR-1.16, venue rule) and credit badge (FR-2.27). */
function operatorView(b: OperatorBooking, tz: string, tiers: { good: number; caution: number }) {
  return { ...bookingView(b, tz), player: { id: b.player.id, fullName: b.player.fullName, phone: b.player.phone, creditScore: b.player.creditScore,
    creditTier: b.player.blockedAt ? 'BLOCKED' as const : tierOf(b.player.creditScore, tiers) } };
}

// Table 16: > 6 hours free; [1,6] hours late; <1 hour last-minute. No cancellation after start (N6).
export function cancellationBand(msUntilStart: number, freeHours: number, lastHours: number): 'FREE' | 'LATE' | 'LAST_MINUTE' | 'STARTED' {
  if (msUntilStart <= 0) return 'STARTED';
  if (msUntilStart > freeHours * 3600000) return 'FREE';
  if (msUntilStart >= lastHours * 3600000) return 'LATE';
  return 'LAST_MINUTE';
}

export async function listMyBookings(deps: AppDeps, playerId: string) {
  const rows = await deps.prisma.booking.findMany({ where: { playerId }, include: BOOKING_INCLUDE, orderBy: { startTime: 'desc' }, take: 200 });
  return { items: rows.map(r => bookingView(r, deps.env.PLATFORM_TZ)) };
}

export async function cancellationPreview(deps: AppDeps, playerId: string, bookingId: string) {
  const b = await deps.prisma.booking.findFirst({ where: { id: bookingId, playerId } });
  if (!b) throw notFound('Booking');
  if (b.status !== 'CONFIRMED') throw new AppError('ALREADY_RECORDED', 'Only confirmed bookings can be cancelled');
  const [free, last, latePoints, lastPoints] = await Promise.all([
    deps.settings.get('free_cancel_hours'), deps.settings.get('last_minute_hours'), deps.settings.get('penalty_late'), deps.settings.get('penalty_lastmin'),
  ]);
  const band = cancellationBand(b.startTime.getTime() - deps.clock.now().getTime(), free, last);
  return { band, penalty: band === 'LATE' ? -latePoints : band === 'LAST_MINUTE' ? -lastPoints : 0, startsAt: b.startTime.toISOString() };
}

export async function cancelMyBooking(deps: AppDeps, playerId: string, bookingId: string) {
  const [free, last, latePoints, lastPoints] = await Promise.all([
    deps.settings.get('free_cancel_hours'), deps.settings.get('last_minute_hours'), deps.settings.get('penalty_late'), deps.settings.get('penalty_lastmin'),
  ]);
  return withTx(deps.prisma, async tx => {
    await lockUser(tx, playerId);
    const original = await tx.booking.findFirst({ where: { id: bookingId, playerId }, select: { courtId: true } });
    if (!original) throw notFound('Booking');
    await lockCourt(tx, original.courtId);
    const locked = await lockBooking(tx, bookingId);
    if (!locked || locked.playerId !== playerId) throw notFound('Booking');
    if (locked.status !== 'CONFIRMED') throw new AppError('ALREADY_RECORDED', 'Only confirmed bookings can be cancelled');
    const now = deps.clock.now();
    const band = cancellationBand(locked.startTime.getTime() - now.getTime(), free, last);
    if (band === 'STARTED') throw new AppError('BOOKING_STARTED', 'A booking cannot be cancelled after it starts');
    const penalty = band === 'LATE' ? -latePoints : band === 'LAST_MINUTE' ? -lastPoints : 0;
    await tx.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED', cancelledAt: now, cancelledById: playerId, cancelReason: `Player cancellation (${band})` } });
    if (penalty) await applyCredit(deps, tx, { userId: playerId, bookingId, eventType: band === 'LATE' ? 'LATE_CANCEL' : 'LASTMIN_CANCEL', delta: penalty });
    await tx.auditLog.create({ data: { createdAt: deps.clock.now(), actorId: playerId, action: 'BOOKING_CANCELLED', targetType: 'Booking', targetId: bookingId, reason: `Player cancellation ${band}`, newValue: { band, penalty } } });
    return { ok: true as const, penalty, band };
  });
}

export async function findVenueForOperator(deps: AppDeps, actor: { userId: string; role: Role; staffVenueId: string | null }, venueId: string) {
  if (actor.role === 'STAFF' && actor.staffVenueId === venueId) return;
  if (actor.role === 'MANAGER') {
    const venue = await deps.prisma.venue.findFirst({ where: { id: venueId, managerId: actor.userId } });
    if (venue) return;
  }
  throw forbidden('This booking does not belong to your assigned venue');
}

/**
 * FR-5.3: the venue's bookings, optionally for one local date and a search by code, player name or phone.
 * The date is filtered in the database (never after the row limit), so a long history cannot hide today's bookings.
 * A single day lists in time order; an open search lists newest first.
 */
export async function venueBookings(deps: AppDeps, actor: { userId: string; role: Role; staffVenueId: string | null }, venueId: string, date?: string, search?: string) {
  await findVenueForOperator(deps, actor, venueId);
  const [good, caution] = await Promise.all([deps.settings.get('tier_good'), deps.settings.get('tier_caution')]);
  const day = date ? localDayRange(date, deps.env.PLATFORM_TZ) : undefined;
  const term = search?.trim() ? escapeLike(search.trim()) : undefined;
  const rows = await deps.prisma.booking.findMany({
    where: { court: { venueId }, ...(day && { startTime: { gte: day.start, lt: day.end } }), ...(term ? { OR: [
      { bookingCode: { contains: term.toUpperCase() } },
      { player: { fullName: { contains: term, mode: 'insensitive' as const } } },
      { player: { phone: { contains: term } } },
    ] } : {}) },
    include: OPERATOR_INCLUDE,
    orderBy: { startTime: day ? 'asc' : 'desc' }, take: 200,
  });
  return { items: rows.map(b => operatorView(b, deps.env.PLATFORM_TZ, { good, caution })) };
}

const HISTORY_ACTIONS = ['BOOKING_CANCELLED', 'VENUE_BOOKING_CANCELLED', 'BOOKING_OUTCOME', 'BOOKING_AUTO_CLOSED'] as const;

/**
 * FR-5.3: one booking of the operator's venue with its status history, built from the booking itself (created), the audit
 * log (cancellations, outcomes, automatic closure) and the credit ledger (points). Other venues are refused (FR-1.13).
 */
export async function venueBookingDetail(deps: AppDeps, actor: { userId: string; role: Role; staffVenueId: string | null }, bookingId: string) {
  const b = await deps.prisma.booking.findUnique({ where: { id: bookingId }, include: OPERATOR_INCLUDE });
  if (!b) throw notFound('Booking');
  await findVenueForOperator(deps, actor, b.court.venueId);
  const [audits, credits, good, caution] = await Promise.all([
    deps.prisma.auditLog.findMany({ where: { targetType: 'Booking', targetId: bookingId, action: { in: [...HISTORY_ACTIONS] } },
      include: { actor: { select: { fullName: true, role: true } } }, orderBy: { createdAt: 'asc' } }),
    deps.prisma.creditEvent.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } }),
    deps.settings.get('tier_good'), deps.settings.get('tier_caution'),
  ]);
  const entry = (at: Date, event: BookingHistoryEvent, by: { fullName: string; role: Role } | null, extra: { reason?: string | null; points?: number; amount?: string | null } = {}) =>
    ({ at: at.toISOString(), event, by: by && { name: by.fullName, role: by.role }, reason: extra.reason ?? null, points: extra.points ?? null, amount: extra.amount ?? null });
  const history = [entry(b.createdAt, 'CREATED', { fullName: b.player.fullName, role: 'PLAYER' })];
  for (const a of audits) {
    const value = (a.newValue ?? {}) as { outcome?: Outcome; amount?: string | null };
    const event: BookingHistoryEvent = a.action === 'BOOKING_CANCELLED' ? 'PLAYER_CANCELLED' : a.action === 'VENUE_BOOKING_CANCELLED' ? 'VENUE_CANCELLED'
      : a.action === 'BOOKING_AUTO_CLOSED' ? 'AUTO_CLOSED' : value.outcome ?? 'PAID';
    history.push(entry(a.createdAt, event, a.actor, { reason: a.reason, amount: event === 'PAID' ? value.amount ?? null : null }));
  }
  for (const c of credits) history.push(entry(c.createdAt, 'CREDIT', null, { reason: c.eventType, points: c.points }));
  history.sort((x, y) => Date.parse(x.at) - Date.parse(y.at)); // stable: a status change stays before the points it caused
  return { ...operatorView(b, deps.env.PLATFORM_TZ, { good, caution }),
    amountReceived: b.amountReceived?.toFixed(2) ?? null, cancelReason: b.cancelReason, history };
}

export async function recordOutcome(deps: AppDeps, actor: { userId: string; role: Role; staffVenueId: string | null }, bookingId: string, outcome: Outcome, amount?: string) {
  const source = await deps.prisma.booking.findUnique({ where: { id: bookingId }, select: { courtId: true, playerId: true, court: { select: { venueId: true } } } });
  if (!source) throw notFound('Booking');
  await findVenueForOperator(deps, actor, source.court.venueId);
  const [waitMinutes, recover, noShow, unpaid] = await Promise.all([
    deps.settings.get('no_show_wait_minutes'), deps.settings.get('recovery'), deps.settings.get('penalty_noshow'), deps.settings.get('penalty_unpaid'),
  ]);
  return withTx(deps.prisma, async tx => {
    await lockUser(tx, source.playerId);
    await lockCourt(tx, source.courtId);
    const b = await lockBooking(tx, bookingId);
    if (!b) throw notFound('Booking');
    if (b.status !== 'CONFIRMED' && !(b.status === 'COMPLETED' && b.paymentStatus === 'PENDING' && outcome === 'PAID')) {
      throw new AppError('ALREADY_RECORDED', 'This booking already has an outcome');
    }
    const now = deps.clock.now();
    if (now < b.startTime) throw new AppError('TOO_EARLY', 'Cannot record an outcome before the booking starts');
    if (outcome === 'NO_SHOW' && now.getTime() < b.startTime.getTime() + waitMinutes * 60000) {
      throw new AppError('TOO_EARLY', `No-show can only be recorded ${waitMinutes} minutes after the start`);
    }
    if (b.status === 'COMPLETED' && actor.role !== 'MANAGER') throw forbidden('Only the manager can confirm cash after automatic closure');
    if (b.status === 'COMPLETED' && now.getTime() > b.endTime.getTime() + CASH_CONFIRM_DAYS * 86400000) {
      throw new AppError('ALREADY_RECORDED', 'The 7-day payment confirmation period has ended');
    }
    const existing = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { totalPrice: true } });
    let received: string | null = null;
    if (outcome === 'PAID') {
      received = amount ?? existing.totalPrice.toFixed(2);
      if (Number(received) <= 0) throw new AppError('VALIDATION_ERROR', 'The amount received must be greater than zero');
    }
    await tx.booking.update({ where: { id: bookingId }, data: {
      status: outcome === 'NO_SHOW' ? 'NO_SHOW' : 'COMPLETED',
      paymentStatus: outcome === 'PAID' ? 'PAID' : outcome === 'UNPAID' ? 'UNPAID' : 'PENDING',
      amountReceived: received, handledById: actor.userId, handledAt: now,
    } });
    const eventType = outcome === 'PAID' ? 'RECOVERY' : outcome === 'NO_SHOW' ? 'NO_SHOW' : 'UNPAID';
    const delta = outcome === 'PAID' ? recover : outcome === 'NO_SHOW' ? -noShow : -unpaid;
    const score = await applyCredit(deps, tx, { userId: source.playerId, bookingId, eventType, delta, actorId: actor.userId });
    const [good, caution] = await Promise.all([deps.settings.get('tier_good'), deps.settings.get('tier_caution')]);
    const creditTier = score === 0 ? 'BLOCKED' as const : tierOf(score, { good, caution });
    await tx.auditLog.create({ data: { createdAt: deps.clock.now(), actorId: actor.userId, action: 'BOOKING_OUTCOME', targetType: 'Booking', targetId: bookingId, newValue: { outcome, amount: received } } });
    return { ok: true as const, creditScore: score, creditTier };
  });
}

/** FR-2.22: manager may cancel an upcoming booking at their venue with a reason, without penalty. */
export async function managerCancelBooking(deps: AppDeps, actor: { userId: string; role: Role; staffVenueId: string | null }, bookingId: string, reason: string) {
  if (actor.role !== 'MANAGER') throw forbidden('Only Arena Managers may cancel venue bookings');
  const source = await deps.prisma.booking.findUnique({ where: { id: bookingId }, select: { courtId: true, playerId: true, court: { select: { venueId: true } } } });
  if (!source) throw notFound('Booking');
  await findVenueForOperator(deps, actor, source.court.venueId);
  return withTx(deps.prisma, async tx => {
    await lockUser(tx, source.playerId);
    await lockCourt(tx, source.courtId);
    const row = await lockBooking(tx, bookingId);
    if (!row || row.status !== 'CONFIRMED') throw new AppError('ALREADY_RECORDED', 'Only confirmed bookings can be cancelled');
    const now = deps.clock.now();
    await tx.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED', cancelledAt: now, cancelledById: actor.userId, cancelReason: reason } });
    await tx.auditLog.create({ data: { createdAt: deps.clock.now(), actorId: actor.userId, action: 'VENUE_BOOKING_CANCELLED', targetType: 'Booking', targetId: bookingId, reason } });
    return { ok: true as const };
  });
}

/** FR-2.17: paid booking receipt is visible only to its player, never to unrelated accounts. */
export async function playerReceipt(deps: AppDeps, playerId: string, bookingId: string) {
  const b = await deps.prisma.booking.findFirst({ where: { id: bookingId, playerId }, include: { court: { include: { venue: true } } } });
  if (!b) throw notFound('Booking');
  if (b.paymentStatus !== 'PAID' || !b.amountReceived || !b.handledAt) throw new AppError('CONFLICT', 'No cash receipt is available for this booking yet');
  return { code: b.bookingCode, venueName: b.court.venue.name, courtName: b.court.name,
    amountReceived: b.amountReceived.toFixed(2), paidAt: b.handledAt.toISOString(), startsAt: b.startTime.toISOString(), endsAt: b.endTime.toISOString() };
}

/**
 * FR-5.1 (MVP slice): today's bookings by court for one venue or all of the manager's venues, plus the bookings that need
 * an action: started without an outcome, and automatically closed ones whose cash can still be confirmed.
 */
export async function managerHome(deps: AppDeps, managerId: string, venueId?: string) {
  const owned = await deps.prisma.venue.findMany({ where: { managerId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  if (venueId && !owned.some(v => v.id === venueId)) throw forbidden('This venue is not yours');
  const venueIds = venueId ? [venueId] : owned.map(v => v.id);
  const now = deps.clock.now();
  const date = localDateIn(deps.env.PLATFORM_TZ, now);
  const day = localDayRange(date, deps.env.PLATFORM_TZ);
  const inVenues = { court: { venueId: { in: venueIds } } };
  const [courts, todays, needsOutcome, awaitingCash, good, caution] = await Promise.all([
    deps.prisma.court.findMany({ where: { venueId: { in: venueIds } }, include: { venue: { select: { name: true } } }, orderBy: [{ venue: { name: 'asc' } }, { name: 'asc' }] }),
    deps.prisma.booking.findMany({ where: { ...inVenues, startTime: { gte: day.start, lt: day.end }, status: { not: 'CANCELLED' } }, include: OPERATOR_INCLUDE, orderBy: { startTime: 'asc' } }),
    deps.prisma.booking.findMany({ where: { ...inVenues, status: 'CONFIRMED', startTime: { lte: now } }, include: OPERATOR_INCLUDE, orderBy: { startTime: 'asc' }, take: 100 }),
    deps.prisma.booking.findMany({ where: { ...inVenues, status: 'COMPLETED', paymentStatus: 'PENDING', handledAt: null,
      endTime: { gte: new Date(now.getTime() - CASH_CONFIRM_DAYS * 86400000) } }, include: OPERATOR_INCLUDE, orderBy: { startTime: 'asc' }, take: 100 }),
    deps.settings.get('tier_good'), deps.settings.get('tier_caution'),
  ]);
  const view = (b: OperatorBooking) => operatorView(b, deps.env.PLATFORM_TZ, { good, caution });
  return {
    date, venues: owned,
    courts: courts.map(c => ({ id: c.id, name: c.name, venueName: c.venue.name, bookings: todays.filter(b => b.courtId === c.id).map(view) })),
    needsOutcome: needsOutcome.map(view), awaitingCash: awaitingCash.map(view),
  };
}
