// Regression tests for the added MVP booking/credit operations.
// Requires the PostgreSQL _test database and db:init just like bookings.test.ts.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/prisma';
import { createApp, createUser, browser, PASSWORD } from './helpers/auth';
import { TEST_DATABASE_URL, resetDb } from './helpers/db';
import { testDeps, TEST_JOB_SECRET } from './helpers/app';
import request from 'supertest';
import type { Express } from 'express';
import type { AppDeps } from '../src/lib/deps';
import type { FakeMailer } from '../src/lib/mailer/mailer';

const database = createDb(TEST_DATABASE_URL);
const prisma = database.prisma;
afterAll(() => database.close());
let deps: AppDeps;
let mailer: FakeMailer;
let clock: ReturnType<typeof testDeps>['clock'];
let app: Express;
let courtId: string;
let venueId: string;
let playerId: string;
let managerEmail: string;
let playerEmail: string;

async function signIn(email: string) {
  const agent = browser(app);
  const response = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return agent;
}
async function createBooking() {
  const agent = await signIn(playerEmail);
  const result = await agent.post('/api/v1/bookings').send({ courtId, startsAt: '2030-01-16T17:00:00.000Z', slots: 1 });
  expect(result.status).toBe(201);
  return result.body.id as string;
}

beforeEach(async () => {
  await resetDb();
  const t = testDeps({ prisma });
  deps = t.deps;
  mailer = t.mailer;
  clock = t.clock;
  app = createApp(deps);
  const city = await prisma.city.create({ data: { name: 'Test City' } });
  const sport = await prisma.sport.create({ data: { name: 'Futsal', minTeamSize: 5, maxTeamSize: 10 } });
  const manager = await createUser(prisma, { role: 'MANAGER' });
  managerEmail = manager.email;
  const venue = await prisma.venue.create({ data: { managerId: manager.id, cityId: city.id, name: 'Operations Arena', address: 'Test Lane', phone: '923009999999', openHour: 8, closeHour: 23 } });
  venueId = venue.id;
  const court = await prisma.court.create({ data: { venueId: venue.id, name: 'Court 1', sportId: sport.id, priceRegular: '20.00' } });
  courtId = court.id;
  const player = await createUser(prisma);
  playerId = player.id;
  playerEmail = player.email;
  await prisma.playerProfile.create({ data: { userId: player.id, cityId: city.id, dateOfBirth: new Date('2000-01-01T00:00:00Z') } });
});

describe('MVP cancellation and cash outcome regression', () => {
  it('previews a free cancellation, cancels without credit effect, and releases the slot', async () => {
    const id = await createBooking();
    const player = await signIn(playerEmail);
    const preview = await player.get(`/api/v1/me/bookings/${id}/cancellation`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ band: 'FREE', penalty: 0 });
    const cancelled = await player.post(`/api/v1/me/bookings/${id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ ok: true, penalty: 0, band: 'FREE' });
    expect((await player.post(`/api/v1/me/bookings/${id}/cancel`)).status).toBe(409);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED');
    expect(await prisma.creditEvent.count({ where: { bookingId: id } })).toBe(0);
  });

  it('charges a single late-cancellation penalty and stores a consistent credit ledger', async () => {
    const id = await createBooking();
    clock.set('2030-01-16T13:00:00.000Z'); // 4 hours before start, new login for fresh 15-minute token
    const player = await signIn(playerEmail);
    const preview = await player.get(`/api/v1/me/bookings/${id}/cancellation`);
    expect(preview.body).toMatchObject({ band: 'LATE', penalty: -10 });
    const response = await player.post(`/api/v1/me/bookings/${id}/cancel`);
    expect(response.status).toBe(200);
    expect(response.body.penalty).toBe(-10);
    const summary = await player.get('/api/v1/me/credit');
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ score: 90, tier: 'GOOD' });
    expect(summary.body.events).toHaveLength(1);
    expect(summary.body.events[0]).toMatchObject({ type: 'LATE_CANCEL', points: -10, scoreAfter: 90 });
  });

  it('rejects early no-show and later applies -30 only once, returning the required tier', async () => {
    const id = await createBooking();
    clock.set('2030-01-16T17:14:00.000Z');
    const manager = await signIn(managerEmail);
    const early = await manager.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'NO_SHOW' });
    expect(early.status).toBe(409);
    clock.set('2030-01-16T17:15:00.000Z');
    const ok = await manager.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'NO_SHOW' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, creditScore: 70, creditTier: 'GOOD' });
    expect((await manager.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'NO_SHOW' })).status).toBe(409);
    expect(await prisma.creditEvent.count({ where: { bookingId: id, eventType: 'NO_SHOW' } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: playerId } })).creditScore).toBe(70);
  });

  it('marks Paid, awards +5 at most 100, returns a tier, and serves an owner-only cash receipt', async () => {
    const id = await createBooking();
    await prisma.user.update({ where: { id: playerId }, data: { creditScore: 90 } });
    clock.set('2030-01-16T17:01:00.000Z');
    const manager = await signIn(managerEmail);
    const response = await manager.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'PAID', amount: '20.00' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, creditScore: 95, creditTier: 'GOOD' });
    const player = await signIn(playerEmail);
    const receipt = await player.get(`/api/v1/me/bookings/${id}/receipt`);
    expect(receipt.status).toBe(200);
    expect(receipt.body).toMatchObject({ amountReceived: '20.00', venueName: 'Operations Arena', courtName: 'Court 1' });
    const stranger = await createUser(prisma);
    const other = await signIn(stranger.email);
    expect((await other.get(`/api/v1/me/bookings/${id}/receipt`)).status).toBe(404);
  });

  it('prevents unrelated managers from accessing another venue bookings or marking cash', async () => {
    const id = await createBooking();
    const unrelatedManager = await createUser(prisma, { role: 'MANAGER' });
    const agent = await signIn(unrelatedManager.email);
    const list = await agent.get(`/api/v1/operations/venues/${venueId}/bookings`);
    expect(list.status).toBe(403);
    const outcome = await agent.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'PAID' });
    expect(outcome.status).toBe(403);
  });
});

// The booking made by createBooking() starts 2030-01-16 17:00 UTC and ends 18:00 UTC.
const START = Date.parse('2030-01-16T17:00:00.000Z');
const minutes = (m: number) => new Date(START + m * 60000).toISOString();
const credit = () => prisma.user.findUniqueOrThrow({ where: { id: playerId }, select: { creditScore: true, blockedAt: true } });

async function createStaff() {
  const staff = await createUser(prisma, { role: 'STAFF' });
  const venue = await prisma.venue.findUniqueOrThrow({ where: { id: venueId } });
  await prisma.staffProfile.create({ data: { userId: staff.id, venueId, invitedById: venue.managerId } });
  return staff;
}

describe('cancellation windows on the server clock (Table 16, FR-2.20, FR-2.21)', () => {
  async function previewAt(id: string, at: string) {
    clock.set(at);
    const player = await signIn(playerEmail); // a fresh sign-in, because the access token lives 15 minutes
    return (await player.get(`/api/v1/me/bookings/${id}/cancellation`)).body;
  }

  it('puts each boundary in the right band: more than 6 h free, 6 h to 1 h late, under 1 h last-minute', async () => {
    const id = await createBooking();
    expect(await previewAt(id, minutes(-6 * 60 - 1))).toMatchObject({ band: 'FREE', penalty: 0 });
    expect(await previewAt(id, minutes(-6 * 60))).toMatchObject({ band: 'LATE', penalty: -10 });
    expect(await previewAt(id, minutes(-60))).toMatchObject({ band: 'LATE', penalty: -10 });
    expect(await previewAt(id, minutes(-59))).toMatchObject({ band: 'LAST_MINUTE', penalty: -20 });
    expect(await previewAt(id, minutes(0))).toMatchObject({ band: 'STARTED', penalty: 0 });
  });

  it('applies -20 once for a last-minute cancellation and releases the slot (acceptance scenario 2)', async () => {
    const id = await createBooking();
    clock.set(minutes(-30));
    const player = await signIn(playerEmail);
    const response = await player.post(`/api/v1/me/bookings/${id}/cancel`);
    expect(response.body).toMatchObject({ ok: true, band: 'LAST_MINUTE', penalty: -20 });
    expect((await credit()).creditScore).toBe(80);
    expect(await prisma.creditEvent.findMany({ where: { bookingId: id }, select: { eventType: true, points: true, scoreAfter: true } }))
      .toEqual([{ eventType: 'LASTMIN_CANCEL', points: -20, scoreAfter: 80 }]);
    const other = await createUser(prisma);
    await prisma.playerProfile.create({ data: { userId: other.id, cityId: (await prisma.city.findFirstOrThrow()).id, dateOfBirth: new Date('2000-01-01T00:00:00Z') } });
    clock.set(minutes(-6 * 60)); // the slot is free again for anyone who can still book it
    const rebook = await (await signIn(other.email)).post('/api/v1/bookings').send({ courtId, startsAt: minutes(0), slots: 1 });
    expect(rebook.status).toBe(201);
  });

  it('never takes the score below 0 and marks the player Blocked', async () => {
    const id = await createBooking();
    await prisma.user.update({ where: { id: playerId }, data: { creditScore: 15 } });
    clock.set(minutes(-30));
    const response = await (await signIn(playerEmail)).post(`/api/v1/me/bookings/${id}/cancel`);
    expect(response.body.penalty).toBe(-20);
    const after = await credit();
    expect(after.creditScore).toBe(0);
    expect(after.blockedAt).not.toBeNull();
    expect((await prisma.creditEvent.findFirstOrThrow({ where: { bookingId: id } })).points).toBe(-15); // the ledger stores the real change
  });

  it('refuses a cancellation once the booking has started and leaves it unchanged', async () => {
    const id = await createBooking();
    clock.set(minutes(1));
    const response = await (await signIn(playerEmail)).post(`/api/v1/me/bookings/${id}/cancel`);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('BOOKING_STARTED');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('CONFIRMED');
    expect((await credit()).creditScore).toBe(100);
  });
});

describe('cash outcomes recorded by staff (Table 15, FR-2.16)', () => {
  it('records Unpaid as Completed with payment Unpaid and -50 once', async () => {
    const id = await createBooking();
    const staff = await createStaff();
    clock.set(minutes(70));
    const agent = await signIn(staff.email);
    const response = await agent.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'UNPAID' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ creditScore: 50, creditTier: 'CAUTION' });
    expect(await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true, paymentStatus: true, amountReceived: true } }))
      .toEqual({ status: 'COMPLETED', paymentStatus: 'UNPAID', amountReceived: null });
    expect((await agent.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'UNPAID' })).status).toBe(409);
    expect(await prisma.creditEvent.count({ where: { bookingId: id } })).toBe(1);
  });

  it('refuses any outcome before the booking starts', async () => {
    const id = await createBooking();
    clock.set(minutes(-1));
    const response = await (await signIn(managerEmail)).post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'PAID' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('TOO_EARLY');
  });

  it('lets staff of another venue do nothing with this booking', async () => {
    const id = await createBooking();
    const otherManager = await createUser(prisma, { role: 'MANAGER' });
    const otherVenue = await prisma.venue.create({ data: { managerId: otherManager.id,
      cityId: (await prisma.city.findFirstOrThrow()).id, name: 'Elsewhere Arena', address: 'Far Lane', phone: '923008888888', openHour: 8, closeHour: 23 } });
    const outsider = await createUser(prisma, { role: 'STAFF' });
    await prisma.staffProfile.create({ data: { userId: outsider.id, venueId: otherVenue.id, invitedById: otherManager.id } });
    clock.set(minutes(70));
    const agent = await signIn(outsider.email);
    expect((await agent.get(`/api/v1/operations/venues/${venueId}/bookings`)).status).toBe(403);
    expect((await agent.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'UNPAID' })).status).toBe(403);
    expect((await credit()).creditScore).toBe(100);
  });
});

describe('manager cancellation (FR-2.22, FR-1.23)', () => {
  it('cancels with a reason, without penalty, audits the reason and frees the slot', async () => {
    const id = await createBooking();
    clock.set(minutes(-30)); // inside the last-minute window: still no penalty, because the venue cancelled
    const manager = await signIn(managerEmail);
    expect((await manager.post(`/api/v1/operations/bookings/${id}/cancel`).send({ reason: 'no' })).status).toBe(422);
    const response = await manager.post(`/api/v1/operations/bookings/${id}/cancel`).send({ reason: 'Court flooded' });
    expect(response.status).toBe(200);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true, cancelReason: true } }))
      .toEqual({ status: 'CANCELLED', cancelReason: 'Court flooded' });
    expect(await prisma.creditEvent.count({ where: { bookingId: id } })).toBe(0);
    expect((await credit()).creditScore).toBe(100);
    expect(await prisma.auditLog.count({ where: { action: 'VENUE_BOOKING_CANCELLED', targetId: id, reason: 'Court flooded' } })).toBe(1);
    expect((await manager.post(`/api/v1/operations/bookings/${id}/cancel`).send({ reason: 'Court flooded' })).status).toBe(409);
  });

  it('is for the manager only: staff are refused', async () => {
    const id = await createBooking();
    const staff = await createStaff();
    const response = await (await signIn(staff.email)).post(`/api/v1/operations/bookings/${id}/cancel`).send({ reason: 'Court flooded' });
    expect(response.status).toBe(403);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('CONFIRMED');
  });
});

describe('timed jobs through POST /api/jobs/tick (Table 8, REL-3)', () => {
  const tick = () => request(app).post('/api/jobs/tick').set('X-Job-Secret', TEST_JOB_SECRET);
  const affected = (body: { name: string; affected: number }[] | { jobs: { name: string; affected: number }[] }, name: string) =>
    (Array.isArray(body) ? body : body.jobs).find(j => j.name === name)?.affected;

  it('closes a booking with no outcome 24 hours after its end, as Completed with payment Pending and no penalty (FR-2.18)', async () => {
    const id = await createBooking();
    clock.set(minutes(60 + 24 * 60 - 1)); // one minute short of 24 hours after the 18:00 end
    expect(affected((await tick()).body, 'auto_close_bookings')).toBe(0);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('CONFIRMED');
    clock.set(minutes(60 + 24 * 60));
    expect(affected((await tick()).body, 'auto_close_bookings')).toBe(1);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true, paymentStatus: true } }))
      .toEqual({ status: 'COMPLETED', paymentStatus: 'PENDING' });
    expect(await prisma.creditEvent.count({ where: { bookingId: id } })).toBe(0);
    expect(affected((await tick()).body, 'auto_close_bookings')).toBe(0); // a second run changes nothing
  });

  it('lets only the manager still confirm cash on an auto-closed booking, for 7 days (Table 15)', async () => {
    const id = await createBooking();
    clock.set(minutes(60 + 24 * 60));
    await tick();
    const staff = await createStaff();
    expect((await (await signIn(staff.email)).post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'PAID' })).status).toBe(403);
    const manager = await signIn(managerEmail);
    expect((await manager.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'UNPAID' })).status).toBe(409);
    const paid = await manager.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'PAID' });
    expect(paid.status).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).paymentStatus).toBe('PAID');
  });

  it('refuses the late confirmation after 7 days', async () => {
    const id = await createBooking();
    clock.set(minutes(60 + 24 * 60));
    await tick();
    clock.set(minutes(60 + 7 * 24 * 60 + 1));
    const response = await (await signIn(managerEmail)).post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'PAID' });
    expect(response.status).toBe(409);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).paymentStatus).toBe('PENDING');
  });

  it('restores a player blocked for 30 days to 20 points, once (FR-2.28)', async () => {
    const blockedAt = new Date('2030-01-01T00:00:00.000Z');
    await prisma.user.update({ where: { id: playerId }, data: { creditScore: 0, blockedAt } });
    clock.set(new Date(blockedAt.getTime() + 30 * 86400000 - 60000));
    expect(affected((await tick()).body, 'restore_blocked_players')).toBe(0);
    expect((await credit()).creditScore).toBe(0);
    clock.set(new Date(blockedAt.getTime() + 30 * 86400000));
    expect(affected((await tick()).body, 'restore_blocked_players')).toBe(1);
    expect(await credit()).toEqual({ creditScore: 20, blockedAt: null });
    expect(affected((await tick()).body, 'restore_blocked_players')).toBe(0);
    expect(await prisma.creditEvent.findMany({ where: { userId: playerId }, select: { eventType: true, points: true, scoreAfter: true } }))
      .toEqual([{ eventType: 'AUTO_RESTORE', points: 20, scoreAfter: 20 }]);
  });
});

describe('leaving the Blocked tier (SRS 5.5, FR-2.25, FR-2.28)', () => {
  const tick = () => request(app).post('/api/jobs/tick').set('X-Job-Secret', TEST_JOB_SECRET);

  it('keeps a player Blocked when they later earn points: only the 30-day restore or the Super Admin ends a block', async () => {
    const id = await createBooking();
    clock.set(minutes(70));
    const manager = await signIn(managerEmail);
    await prisma.user.update({ where: { id: playerId }, data: { creditScore: 50 } });
    await manager.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'UNPAID' }); // 50 - 50 = 0: Blocked
    const blockedAt = (await credit()).blockedAt;
    expect(blockedAt).not.toBeNull();

    // A booking of the same player that was closed automatically earlier is now confirmed as paid: +5 points.
    const old = await prisma.booking.create({ data: { bookingCode: 'OLDPAID1', courtId, playerId, startTime: new Date('2030-01-14T10:00:00Z'),
      endTime: new Date('2030-01-14T11:00:00Z'), totalPrice: '20.00', status: 'COMPLETED' } });
    const paid = await manager.post(`/api/v1/operations/bookings/${old.id}/outcome`).send({ outcome: 'PAID' });
    expect(paid.body).toMatchObject({ creditScore: 5, creditTier: 'BLOCKED' });
    expect(await credit()).toEqual({ creditScore: 5, blockedAt });
    const summary = await (await signIn(playerEmail)).get('/api/v1/me/credit');
    expect(summary.body).toMatchObject({ score: 5, tier: 'BLOCKED' });
    clock.set(minutes(-6 * 60)); // a fresh booking is refused while Blocked
    const refused = await (await signIn(playerEmail)).post('/api/v1/bookings').send({ courtId, startsAt: '2030-01-17T17:00:00.000Z', slots: 1 });
    expect(refused.body.error?.code).toBe('TIER_LIMIT');
  });

  it('restores to 20 after 30 days, keeping points earned while Blocked when they are higher', async () => {
    const blockedAt = new Date('2030-01-01T00:00:00.000Z');
    await prisma.user.update({ where: { id: playerId }, data: { creditScore: 25, blockedAt } });
    clock.set(new Date(blockedAt.getTime() + 30 * 86400000));
    await tick();
    expect(await credit()).toEqual({ creditScore: 25, blockedAt: null });
    expect(await prisma.creditEvent.findMany({ where: { userId: playerId }, select: { eventType: true, points: true, scoreAfter: true } }))
      .toEqual([{ eventType: 'AUTO_RESTORE', points: 0, scoreAfter: 25 }]);

    const other = await createUser(prisma);
    await prisma.user.update({ where: { id: other.id }, data: { creditScore: 5, blockedAt } });
    await tick(); // the first player is not touched twice; the second rises from 5 to 20
    expect(await prisma.user.findUniqueOrThrow({ where: { id: other.id }, select: { creditScore: true, blockedAt: true } })).toEqual({ creditScore: 20, blockedAt: null });
    expect(await prisma.creditEvent.count({ where: { userId: playerId } })).toBe(1);
  });
});

describe('arena limits (Table 11, FR-1.18)', () => {
  it('allows 3 venues per manager, 10 courts per venue and 5 staff per venue, and refuses one more', async () => {
    const manager = await signIn(managerEmail);
    const cityId = (await prisma.city.findFirstOrThrow()).id;
    const sportId = (await prisma.sport.findFirstOrThrow()).id;
    const venue = (n: number) => ({ name: `Limit Venue ${n}`, address: 'Street 5', cityId, phone: '923001111111', openHour: 9, closeHour: 21 });
    // The fixture already gave this manager one venue.
    for (const n of [2, 3]) expect((await manager.post('/api/v1/manager/venues').send(venue(n))).status).toBe(201);
    const fourth = await manager.post('/api/v1/manager/venues').send(venue(4));
    expect(fourth.status).toBe(409);
    expect(await prisma.venue.count({ where: { name: { startsWith: 'Limit Venue' } } })).toBe(2);

    // The fixture venue has one court.
    for (let n = 2; n <= 10; n++) {
      expect((await manager.post(`/api/v1/manager/venues/${venueId}/courts`).send({ name: `Court ${n}`, sportId, priceRegular: '20.00' })).status).toBe(201);
    }
    expect((await manager.post(`/api/v1/manager/venues/${venueId}/courts`).send({ name: 'Court 11', sportId, priceRegular: '20.00' })).status).toBe(409);
    expect(await prisma.court.count({ where: { venueId } })).toBe(10);

    for (let n = 1; n <= 5; n++) {
      const invite = await manager.post(`/api/v1/manager/venues/${venueId}/staff`).send({ fullName: `Desk Agent ${'abcde'[n - 1]}`, email: `desk${n}@example.com`, phone: `92300777000${n}` });
      expect(invite.status).toBe(201);
    }
    const sixth = await manager.post(`/api/v1/manager/venues/${venueId}/staff`).send({ fullName: 'Desk Agent Six', email: 'desk6@example.com', phone: '923007770006' });
    expect(sixth.status).toBe(409);
    expect(await prisma.staffProfile.count({ where: { venueId } })).toBe(5);
  });
});

describe('My Bookings (FR-2.13)', () => {
  it("returns the player's own bookings with status and payment status, and none of anyone else's", async () => {
    const upcoming = await createBooking();
    const other = await createUser(prisma);
    await prisma.booking.create({ data: { bookingCode: 'OTHER001', courtId, playerId: other.id, startTime: new Date('2030-01-16T19:00:00.000Z'),
      endTime: new Date('2030-01-16T20:00:00.000Z'), totalPrice: '20.00' } });
    await prisma.booking.create({ data: { bookingCode: 'CANCEL01', courtId, playerId, startTime: new Date('2030-01-17T10:00:00.000Z'),
      endTime: new Date('2030-01-17T11:00:00.000Z'), totalPrice: '20.00', status: 'CANCELLED', cancelledAt: new Date('2030-01-15T12:00:00.000Z'), cancelledById: playerId } });
    const list = await (await signIn(playerEmail)).get('/api/v1/me/bookings');
    expect(list.status).toBe(200);
    const byCode = Object.fromEntries(list.body.items.map((b: { code: string; status: string; paymentStatus: string }) => [b.code, [b.status, b.paymentStatus]]));
    expect(Object.keys(byCode)).toHaveLength(2);
    expect(byCode.CANCEL01).toEqual(['CANCELLED', 'PENDING']);
    expect(byCode.OTHER001).toBeUndefined();
    expect(list.body.items.some((b: { id: string }) => b.id === upcoming)).toBe(true);
  });

  it('is for players only', async () => {
    expect((await (await signIn(managerEmail)).get('/api/v1/me/bookings')).status).toBe(403);
  });
});

describe('booking detail with status history (FR-5.3)', () => {
  const detail = async (agent: ReturnType<typeof browser>, id: string) => (await agent.get(`/api/v1/operations/bookings/${id}`));
  const events = (body: { history: { event: string }[] }) => body.history.map(h => h.event);

  it('shows the player badge and phone, then created, paid with the amount and who took it, and the credit points', async () => {
    const id = await createBooking();
    await prisma.user.update({ where: { id: playerId }, data: { creditScore: 60 } });
    const staff = await createStaff();
    clock.set(minutes(70));
    const desk = await signIn(staff.email);
    await desk.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'PAID', amount: '18.50' });
    const response = await detail(desk, id);
    expect(response.status).toBe(200);
    const player = await prisma.user.findUniqueOrThrow({ where: { id: playerId } });
    expect(response.body).toMatchObject({ status: 'COMPLETED', paymentStatus: 'PAID', amountReceived: '18.50', cancelReason: null,
      player: { fullName: player.fullName, phone: player.phone, creditScore: 65, creditTier: 'CAUTION' } });
    expect(response.body.history).toEqual([
      expect.objectContaining({ event: 'CREATED', by: { name: player.fullName, role: 'PLAYER' } }),
      expect.objectContaining({ event: 'PAID', by: { name: staff.fullName, role: 'STAFF' }, amount: '18.50', at: minutes(70) }),
      expect.objectContaining({ event: 'CREDIT', by: null, reason: 'RECOVERY', points: 5 }),
    ]);
    expect(JSON.stringify(response.body)).not.toContain(player.email); // e-mail is never shown to other users (FR-1.16)
  });

  it('records a player cancellation and its penalty', async () => {
    const id = await createBooking();
    clock.set(minutes(-3 * 60));
    await (await signIn(playerEmail)).post(`/api/v1/me/bookings/${id}/cancel`);
    const body = (await detail(await signIn(managerEmail), id)).body;
    expect(events(body)).toEqual(['CREATED', 'PLAYER_CANCELLED', 'CREDIT']);
    expect(body.history[2]).toMatchObject({ reason: 'LATE_CANCEL', points: -10 });
  });

  it('records a venue cancellation with its reason and no credit entry', async () => {
    const id = await createBooking();
    const manager = await signIn(managerEmail);
    await manager.post(`/api/v1/operations/bookings/${id}/cancel`).send({ reason: 'Lights broken' });
    const body = (await detail(manager, id)).body;
    expect(body.cancelReason).toBe('Lights broken');
    expect(events(body)).toEqual(['CREATED', 'VENUE_CANCELLED']);
    expect(body.history[1]).toMatchObject({ reason: 'Lights broken', by: { role: 'MANAGER' } });
  });

  it('shows the automatic closure by the system, then a later cash confirmation by the manager', async () => {
    const id = await createBooking();
    clock.set(minutes(60 + 24 * 60));
    await request(app).post('/api/jobs/tick').set('X-Job-Secret', TEST_JOB_SECRET);
    expect(await prisma.auditLog.count({ where: { action: 'BOOKING_AUTO_CLOSED', targetId: id, actorId: null } })).toBe(1);
    const manager = await signIn(managerEmail);
    await manager.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'PAID' });
    const body = (await detail(manager, id)).body;
    expect(events(body)).toEqual(['CREATED', 'AUTO_CLOSED', 'PAID', 'CREDIT']);
    expect(body.history[1]).toMatchObject({ by: null, at: minutes(60 + 24 * 60) });
    expect(body.history[2]).toMatchObject({ amount: '20.00', by: { role: 'MANAGER' } });
  });

  it('lists a status change before the points it caused, even when the clock moves between writes (real clock)', async () => {
    const id = await createBooking();
    // Like the system clock, this one moves forward on every call, so writes inside one transaction get different times.
    let t = Date.parse(minutes(70));
    const ticking = testDeps({ prisma }, {});
    ticking.deps.clock = { now: () => new Date(t++) };
    const live = createApp(ticking.deps);
    const agent = browser(live);
    expect((await agent.post('/api/v1/auth/login').send({ email: managerEmail, password: PASSWORD })).status).toBe(200);
    expect((await agent.post(`/api/v1/operations/bookings/${id}/outcome`).send({ outcome: 'NO_SHOW' })).status).toBe(200);
    const body = (await agent.get(`/api/v1/operations/bookings/${id}`)).body;
    expect(events(body)).toEqual(['CREATED', 'NO_SHOW', 'CREDIT']);
  });

  it('is refused for another venue (403, logged), unknown bookings (404) and players', async () => {
    const id = await createBooking();
    const stranger = await createUser(prisma, { role: 'MANAGER' });
    expect((await detail(await signIn(stranger.email), id)).status).toBe(403);
    expect((await detail(await signIn(managerEmail), '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await detail(await signIn(playerEmail), id)).status).toBe(403);
  });
});

describe('manager home (FR-5.1)', () => {
  // The fake clock starts at 2030-01-15 12:00 UTC (PLATFORM_TZ is UTC in tests), so "today" is 15 January.
  let n = 0;
  async function book(court: string, startIso: string, extra: Record<string, unknown> = {}) {
    const start = new Date(startIso);
    return (await prisma.booking.create({ data: { bookingCode: `MH${String(++n).padStart(6, '0')}`, courtId: court, playerId,
      startTime: start, endTime: new Date(start.getTime() + 3600000), totalPrice: '20.00', ...extra } })).bookingCode;
  }
  const codes = (list: { code: string }[]) => list.map(b => b.code);

  it("lists today's bookings by court (empty courts included) and the bookings needing an action", async () => {
    const court2 = (await prisma.court.create({ data: { venueId, name: 'Court 2', sportId: (await prisma.sport.findFirstOrThrow()).id, priceRegular: '20.00' } })).id;
    const started = await book(courtId, '2030-01-15T10:00:00.000Z'); // started, no outcome yet
    const later = await book(courtId, '2030-01-15T14:00:00.000Z');
    await book(courtId, '2030-01-15T16:00:00.000Z', { status: 'CANCELLED', cancelledAt: new Date('2030-01-14T00:00:00Z'), cancelledById: playerId });
    await book(courtId, '2030-01-16T10:00:00.000Z'); // tomorrow
    const closed = await book(courtId, '2030-01-10T10:00:00.000Z', { status: 'COMPLETED' }); // auto-closed 5 days ago
    await book(courtId, '2030-01-07T10:00:00.000Z', { status: 'COMPLETED' }); // past the 7-day window
    await book(courtId, '2030-01-11T10:00:00.000Z', { status: 'COMPLETED', paymentStatus: 'PAID', amountReceived: '20.00', handledAt: new Date('2030-01-11T11:00:00Z') });

    const response = await (await signIn(managerEmail)).get('/api/v1/manager/home');
    expect(response.status).toBe(200);
    expect(response.body.date).toBe('2030-01-15');
    expect(response.body.venues).toEqual([{ id: venueId, name: 'Operations Arena' }]);
    expect(response.body.courts.map((c: { name: string; bookings: { code: string }[] }) => [c.name, codes(c.bookings)]))
      .toEqual([['Court 1', [started, later]], ['Court 2', []]]);
    expect(response.body.courts[1].id).toBe(court2);
    expect(codes(response.body.needsOutcome)).toEqual([started]);
    expect(codes(response.body.awaitingCash)).toEqual([closed]);
    expect(response.body.needsOutcome[0].player).toMatchObject({ creditTier: 'GOOD' });
  });

  it("narrows to one of the manager's venues and refuses a venue of someone else", async () => {
    const managerId = (await prisma.venue.findUniqueOrThrow({ where: { id: venueId } })).managerId;
    const second = await prisma.venue.create({ data: { managerId, cityId: (await prisma.city.findFirstOrThrow()).id, name: 'Second Arena', address: 'B Lane', phone: '923007777777', openHour: 8, closeHour: 23 } });
    const secondCourt = (await prisma.court.create({ data: { venueId: second.id, name: 'Main', sportId: (await prisma.sport.findFirstOrThrow()).id, priceRegular: '15.00' } })).id;
    const there = await book(secondCourt, '2030-01-15T13:00:00.000Z');
    const here = await book(courtId, '2030-01-15T15:00:00.000Z');
    const manager = await signIn(managerEmail);
    const all = (await manager.get('/api/v1/manager/home')).body;
    expect(all.venues.map((v: { name: string }) => v.name)).toEqual(['Operations Arena', 'Second Arena']);
    expect(all.courts.flatMap((c: { bookings: { code: string }[] }) => codes(c.bookings)).sort()).toEqual([there, here].sort());
    const one = (await manager.get(`/api/v1/manager/home?venueId=${second.id}`)).body;
    expect(one.courts.map((c: { venueName: string }) => c.venueName)).toEqual(['Second Arena']);
    expect(one.courts[0].bookings.map((b: { code: string }) => b.code)).toEqual([there]);

    const otherManager = await createUser(prisma, { role: 'MANAGER' });
    const foreign = await prisma.venue.create({ data: { managerId: otherManager.id, cityId: (await prisma.city.findFirstOrThrow()).id, name: 'Foreign Arena', address: 'C Lane', phone: '923006666666', openHour: 8, closeHour: 23 } });
    expect((await manager.get(`/api/v1/manager/home?venueId=${foreign.id}`)).status).toBe(403);
  });

  it('is for managers only', async () => {
    const staff = await createStaff();
    expect((await (await signIn(staff.email)).get('/api/v1/manager/home')).status).toBe(403);
    expect((await (await signIn(playerEmail)).get('/api/v1/manager/home')).status).toBe(403);
  });
});

describe('Super Admin accounts list (FR-1.20, FR-5.10)', () => {
  async function adminAgent() {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const agent = browser(app);
    expect((await agent.post('/api/v1/auth/admin/request-otp').send({ email: admin.email, password: PASSWORD })).status).toBe(200);
    const code = mailer.lastCodeFor(admin.email);
    expect((await agent.post('/api/v1/auth/admin/verify-otp').send({ email: admin.email, password: PASSWORD, code })).status).toBe(200);
    return { agent, admin };
  }
  const list = async (agent: ReturnType<typeof browser>, query = '') => (await agent.get(`/api/v1/admin/accounts${query}`)).body;

  it('lists every account with its role and status, shows credit for players and the venue for staff, and hides secrets', async () => {
    const staff = await createStaff();
    const { agent } = await adminAgent();
    const body = await list(agent);
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 4 }); // manager, player, staff, admin
    const player = body.items.find((a: { id: string }) => a.id === playerId);
    expect(player).toMatchObject({ role: 'PLAYER', status: 'ACTIVE', creditScore: 100, venueName: null, isOwner: false });
    expect(body.items.find((a: { id: string }) => a.id === staff.id)).toMatchObject({ role: 'STAFF', venueName: 'Operations Arena', creditScore: null });
    expect(JSON.stringify(body)).not.toMatch(/password|Hash|nationalId/i);
  });

  it('filters by role and status and searches name, e-mail and phone (wildcards are plain text)', async () => {
    await createUser(prisma, { role: 'MANAGER', status: 'PENDING_APPROVAL', email: 'waiting.manager@example.com', phone: '923005550001' });
    const { agent } = await adminAgent();
    expect((await list(agent, '?role=MANAGER')).total).toBe(2);
    const pending = await list(agent, '?role=MANAGER&status=PENDING_APPROVAL');
    expect(pending.items.map((a: { email: string }) => a.email)).toEqual(['waiting.manager@example.com']);
    expect((await list(agent, '?q=WAITING.manager')).total).toBe(1); // e-mail, any case
    expect((await list(agent, '?q=5550001')).total).toBe(1); // phone
    const player = await prisma.user.findUniqueOrThrow({ where: { id: playerId } });
    expect((await list(agent, `?q=${encodeURIComponent(player.fullName.toLowerCase())}`)).items.map((a: { id: string }) => a.id)).toEqual([playerId]);
    expect((await list(agent, '?q=%25')).total).toBe(0);
    expect((await agent.get('/api/v1/admin/accounts?role=OWNER')).status).toBe(422);
  });

  it('pages 20 at a time and leaves out soft-deleted accounts', async () => {
    for (let i = 0; i < 22; i++) await createUser(prisma);
    await createUser(prisma, { email: 'gone@example.com' }).then(u => prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date('2030-01-01T00:00:00Z') } }));
    const { agent } = await adminAgent();
    const first = await list(agent, '?role=PLAYER');
    expect(first.total).toBe(23); // fixture player + 22
    expect(first.items).toHaveLength(20);
    const second = await list(agent, '?role=PLAYER&page=2');
    expect(second.items).toHaveLength(3);
    const ids = new Set([...first.items, ...second.items].map((a: { id: string }) => a.id));
    expect(ids.size).toBe(23); // no account twice, none missing
    expect((await list(agent, '?q=gone@')).total).toBe(0);
  });

  it('is for the Super Admin only', async () => {
    expect((await (await signIn(managerEmail)).get('/api/v1/admin/accounts')).status).toBe(403);
    expect((await (await signIn(playerEmail)).get('/api/v1/admin/accounts')).status).toBe(403);
  });
});

/** Inserts `count` one-hour past bookings, back to back from 1 January 2029, so a venue has a long history. */
async function insertHistory(count: number) {
  const start = Date.parse('2029-01-01T00:00:00.000Z');
  await prisma.booking.createMany({ data: Array.from({ length: count }, (_, i) => ({
    bookingCode: `H${String(i).padStart(7, '0')}`, courtId, playerId,
    startTime: new Date(start + i * 3600000), endTime: new Date(start + (i + 1) * 3600000),
    totalPrice: '20.00', amountReceived: '20.00', status: 'COMPLETED' as const, paymentStatus: 'PAID' as const,
  })) });
}

describe('front-desk booking list with a long venue history (D1, FR-5.3)', () => {
  it("still lists the day's bookings when the venue has more than 200 older ones", async () => {
    await insertHistory(250);
    const id = await createBooking(); // 2030-01-16 17:00 UTC
    const manager = await signIn(managerEmail);
    const byDate = await manager.get(`/api/v1/operations/venues/${venueId}/bookings?date=2030-01-16`);
    expect(byDate.status).toBe(200);
    expect(byDate.body.items.map((b: { id: string }) => b.id)).toEqual([id]);
  });

  it('finds the newest booking by code or phone when there is no date', async () => {
    await insertHistory(250);
    const id = await createBooking();
    const code = (await prisma.booking.findUniqueOrThrow({ where: { id } })).bookingCode;
    const manager = await signIn(managerEmail);
    const byCode = await manager.get(`/api/v1/operations/venues/${venueId}/bookings?search=${code}`);
    expect(byCode.body.items.map((b: { id: string }) => b.id)).toEqual([id]);
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: playerId } })).phone;
    const byPhone = await manager.get(`/api/v1/operations/venues/${venueId}/bookings?search=${phone}`);
    expect(byPhone.body.items.map((b: { id: string }) => b.id)).toContain(id);
  });

  it('pages 20 at a time in time order for a day, with the total (PERF-4)', async () => {
    const court2 = (await prisma.court.create({ data: { venueId, name: 'Court 2', sportId: (await prisma.sport.findFirstOrThrow()).id, priceRegular: '20.00' } })).id;
    const other = await createUser(prisma);
    const rows = [
      ...Array.from({ length: 13 }, (_, h) => ({ court: courtId, player: playerId, h })),
      ...Array.from({ length: 12 }, (_, h) => ({ court: court2, player: other.id, h })),
    ];
    await prisma.booking.createMany({ data: rows.map((r, i) => ({ bookingCode: `PG${String(i).padStart(6, '0')}`, courtId: r.court, playerId: r.player,
      startTime: new Date(Date.UTC(2030, 0, 16, r.h)), endTime: new Date(Date.UTC(2030, 0, 16, r.h + 1)), totalPrice: '20.00' })) });
    const manager = await signIn(managerEmail);
    const first = (await manager.get(`/api/v1/operations/venues/${venueId}/bookings?date=2030-01-16`)).body;
    expect(first).toMatchObject({ page: 1, pageSize: 20, total: 25 });
    expect(first.items).toHaveLength(20);
    const starts = first.items.map((b: { startsAt: string }) => b.startsAt);
    expect([...starts].sort()).toEqual(starts);
    const second = (await manager.get(`/api/v1/operations/venues/${venueId}/bookings?date=2030-01-16&page=2`)).body;
    expect(second.items).toHaveLength(5);
    expect(new Set([...first.items, ...second.items].map((b: { id: string }) => b.id)).size).toBe(25);
    expect((await manager.get(`/api/v1/operations/venues/${venueId}/bookings?page=0`)).status).toBe(422);
  });

  it('treats % and _ in a search as plain characters, not wildcards', async () => {
    await createBooking();
    const manager = await signIn(managerEmail);
    for (const wildcard of ['%', '_', '%%']) {
      const response = await manager.get(`/api/v1/operations/venues/${venueId}/bookings?search=${encodeURIComponent(wildcard)}`);
      expect(response.status).toBe(200);
      expect(response.body.items, wildcard).toEqual([]);
    }
  });

  it('keeps the date in the platform time zone: a booking just after local midnight belongs to the new day', async () => {
    const t = testDeps({ prisma }, { PLATFORM_TZ: 'Asia/Karachi' }); // UTC+5
    const karachi = createApp(t.deps);
    await prisma.booking.create({ data: { bookingCode: 'TZ000001', courtId, playerId, startTime: new Date('2030-01-15T19:00:00.000Z'),
      endTime: new Date('2030-01-15T20:00:00.000Z'), totalPrice: '20.00' } }); // 00:00 on 16 January in Karachi
    const agent = browser(karachi);
    expect((await agent.post('/api/v1/auth/login').send({ email: managerEmail, password: PASSWORD })).status).toBe(200);
    const day16 = await agent.get(`/api/v1/operations/venues/${venueId}/bookings?date=2030-01-16`);
    const day15 = await agent.get(`/api/v1/operations/venues/${venueId}/bookings?date=2030-01-15`);
    expect(day16.body.items.map((b: { code: string }) => b.code)).toEqual(['TZ000001']);
    expect(day15.body.items).toEqual([]);
  });
});

describe('MVP onboarding and role safeguards', () => {
  it('requires email OTP, owner approval with a reason, and invitation-only venue staff', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const submitted = await browser(app).post('/api/v1/auth/register-manager').send({
      fullName: 'Arena Owner', email: 'newmanager@example.com', phone: '923009888888',
      password: PASSWORD, acceptTerms: true, confirmAge16: true,
      businessName: 'Arena Company', nationalIdNo: '123450000001', businessAddress: 'Some office address',
    });
    expect(submitted.status).toBe(201);
    const managerCode = mailer.lastCodeFor('newmanager@example.com');
    expect(managerCode).toMatch(/^\d{6}$/);
    const verified = await browser(app).post('/api/v1/auth/verify-email').send({ email: 'newmanager@example.com', code: managerCode });
    expect(verified.status).toBe(200);
    expect(verified.body.user.status).toBe('PENDING_APPROVAL');
    const pendingManager = await signIn('newmanager@example.com');
    const forbiddenCreate = await pendingManager.post('/api/v1/manager/venues').send({
      name: 'Future Venue', address: 'Street 5', cityId: 1, phone: '923001111111', openHour: 9, closeHour: 21,
    });
    expect(forbiddenCreate.status).toBe(403);

    const administrator = browser(app);
    const firstFactor = await administrator.post('/api/v1/auth/admin/request-otp').send({ email: admin.email, password: PASSWORD });
    expect(firstFactor.status).toBe(200);
    const adminCode = mailer.lastCodeFor(admin.email);
    expect(adminCode).toMatch(/^\d{6}$/);
    const authenticated = await administrator.post('/api/v1/auth/admin/verify-otp').send({ email: admin.email, password: PASSWORD, code: adminCode });
    expect(authenticated.status).toBe(200);
    const submittedUser = await prisma.user.findUniqueOrThrow({ where: { email: 'newmanager@example.com' } });
    const approval = await administrator.post(`/api/v1/admin/managers/${submittedUser.id}/decision`).send({ decision: 'APPROVE', reason: 'Verified business identity' });
    expect(approval.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: submittedUser.id } })).status).toBe('ACTIVE');
    expect(await prisma.auditLog.count({ where: { action: 'MANAGER_APPROVE', targetId: submittedUser.id } })).toBe(1);

    const manager = await signIn('newmanager@example.com');
    const cities = await prisma.city.findMany();
    const newVenue = await manager.post('/api/v1/manager/venues').send({
      name: 'New Court House', address: 'Street 5', cityId: cities[0]!.id, phone: '923001111111', openHour: 9, closeHour: 21,
    });
    expect(newVenue.status).toBe(201);
    const invitation = await manager.post(`/api/v1/manager/venues/${newVenue.body.id}/staff`).send({
      fullName: 'Reception Agent', email: 'reception@example.com', phone: '923002222222',
    });
    expect(invitation.status).toBe(201);
    expect(mailer.sent.some(m => m.to === 'reception@example.com' && m.text.includes('/accept-invite?'))).toBe(true);
    const staff = await prisma.user.findUniqueOrThrow({ where: { email: 'reception@example.com' } });
    expect(staff.status).toBe('UNVERIFIED');
    expect((await prisma.staffProfile.findUnique({ where: { userId: staff.id } }))?.venueId).toBe(newVenue.body.id);
  });
});
