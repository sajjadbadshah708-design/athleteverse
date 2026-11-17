// Regression tests for the added MVP booking/credit operations.
// Requires the PostgreSQL _test database and db:init just like bookings.test.ts.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/prisma';
import { createApp, createUser, browser, PASSWORD } from './helpers/auth';
import { TEST_DATABASE_URL, resetDb } from './helpers/db';
import { testDeps } from './helpers/app';
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
