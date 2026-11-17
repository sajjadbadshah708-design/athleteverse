// FR-2.7 to FR-2.11, FR-2.9, FR-2.25, FR-1.15, REL-1, SRS 5.3: creating a booking.
import { BOOKING_MESSAGES, sumAmounts, type UserStatus } from '@athleteverse/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { staticSettings } from '../src/config/settings';
import { createDb } from '../src/db/prisma';
import { BOOKING_CODE_ALPHABET } from '../src/modules/bookings/code';
import { translateBookingConflict } from '../src/modules/bookings/bookings.service';
import { testDeps } from './helpers/app';
import { browser, createApp, createUser, PASSWORD } from './helpers/auth';
import { TEST_DATABASE_URL, pool, resetDb } from './helpers/db';
import { insertBooking, insertUser } from './helpers/fixtures';

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.close());
const prisma = db.prisma;

let t: ReturnType<typeof testDeps>;
let app: ReturnType<typeof createApp>;
let W: Awaited<ReturnType<typeof world>>;

function start(overrides: Parameters<typeof testDeps>[0] = {}, envVars: Record<string, string> = {}) {
  t = testDeps({ prisma, ...overrides }, envVars); // the fake clock reads 2030-01-15 12:00 UTC
  app = createApp(t.deps);
}

/** One venue (08:00 to 23:00, peak from 18:00) with two futsal courts and one badminton court. */
async function world() {
  const city = await prisma.city.create({ data: { name: 'Test City' } });
  const futsal = await prisma.sport.create({ data: { name: 'Futsal', minTeamSize: 5, maxTeamSize: 10 } });
  const badminton = await prisma.sport.create({ data: { name: 'Badminton', minTeamSize: 2, maxTeamSize: 4 } });
  const manager = await insertUser('MANAGER');
  const venue = await prisma.venue.create({
    data: { managerId: manager, name: 'Arena One', address: '1 Main St', cityId: city.id, phone: '920000000100', openHour: 8, closeHour: 23, peakStartHour: 18, peakEndHour: 23 },
  });
  const court = (name: string, sportId: number, priceRegular: string, pricePeak: string, extra: object = {}) =>
    prisma.court.create({ data: { venueId: venue.id, name, sportId, priceRegular, pricePeak, ...extra } });
  return {
    city, futsal, badminton, manager, venue,
    courtA: await court('Court A', futsal.id, '20.00', '30.00'),
    courtA2: await court('Court A2', futsal.id, '20.00', '30.00'),
    courtB: await court('Court B', badminton.id, '10.00', '15.00'),
  };
}

beforeEach(async () => {
  await resetDb();
  start();
  W = await world();
});

interface PlayerOptions { score?: number; blockedAt?: Date; profile?: boolean; status?: UserStatus }
/** A signed-in player. By default: a complete profile and a perfect credit score. */
async function player(opts: PlayerOptions = {}) {
  const user = await createUser(prisma, {});
  if (opts.score !== undefined || opts.blockedAt) await prisma.user.update({ where: { id: user.id }, data: { creditScore: opts.score, blockedAt: opts.blockedAt } });
  if (opts.profile !== false) await prisma.playerProfile.create({ data: { userId: user.id, cityId: W.city.id, dateOfBirth: new Date('2000-01-01T00:00:00Z') } });
  const agent = browser(app);
  await agent.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
  if (opts.status) await prisma.user.update({ where: { id: user.id }, data: { status: opts.status } });
  return { user, agent };
}

const day = (n: number) => new Date(Date.UTC(2030, 0, 16 + n)).toISOString().slice(0, 10); // day(0) = 2030-01-16
const startsAt = (hour: number, date = day(0)) => `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;
type Agent = ReturnType<typeof browser>;
const book = (agent: Agent, courtId: string, hour: number, slots = 1, date = day(0)) =>
  agent.post('/api/v1/bookings').send({ courtId, startsAt: startsAt(hour, date), slots });
const rows = () => pool.query(`SELECT * FROM bookings ORDER BY start_time`).then((r) => r.rows);
const issues = (res: { body: { error: { details: { issues: { path: string; message: string }[] } } } }) => res.body.error.details.issues;
const grid = (date = day(0)) => request(app).get(`/api/v1/venues/${W.venue.id}/availability?date=${date}`);

describe('POST /api/v1/bookings: a successful booking', () => {
  it('confirms at once, prices each hour at its own rate, stores exact UTC times and a code (FR-2.8, FR-2.10)', async () => {
    const { agent, user } = await player();
    const res = await book(agent, W.courtA.id, 17, 2); // 17:00 regular (20) + 18:00 peak (30)
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      code: expect.stringMatching(new RegExp(`^[${BOOKING_CODE_ALPHABET}]{8}$`)),
      status: 'CONFIRMED',
      paymentStatus: 'PENDING', // nothing is paid online (FR-2.15)
      startsAt: '2030-01-16T17:00:00.000Z',
      endsAt: '2030-01-16T19:00:00.000Z',
      date: '2030-01-16',
      startHour: 17,
      endHour: 19,
      hours: 2,
      totalPrice: '50.00',
      court: { id: W.courtA.id, name: 'Court A', sportName: 'Futsal' },
      venue: { id: W.venue.id, name: 'Arena One', address: '1 Main St', cityName: 'Test City', contactPhone: '920000000100' },
      createdAt: '2030-01-15T12:00:00.000Z',
    });
    const [row] = await rows();
    expect(row).toMatchObject({ booking_code: res.body.code, court_id: W.courtA.id, player_id: user.id, status: 'CONFIRMED', payment_status: 'PENDING' });
    expect(row.total_price).toBe('50.00');
    expect(row.start_time.toISOString()).toBe('2030-01-16T17:00:00.000Z');
    expect(row.end_time.toISOString()).toBe('2030-01-16T19:00:00.000Z');
    expect(sumAmounts(['20.00', '30.00'])).toBe(res.body.totalPrice); // the web shows the same total before booking
  });

  it('e-mails the confirmation with the code and the pay-cash note, after the commit (FR-5.15)', async () => {
    const { agent, user } = await player();
    const res = await book(agent, W.courtA.id, 10);
    const mail = t.mailer.sent.find((m) => m.subject.startsWith('Your AthleteVerse booking'))!;
    expect(mail.to).toBe(user.email);
    expect(mail.subject).toContain(res.body.code);
    expect(mail.text).toContain('Pay cash at the venue after the match');
    expect(mail.text).toContain('Wednesday, 16 January 2030, 10:00 to 11:00');
    expect(mail.text).toContain('Cancel more than 6 hours');
  });

  it('is not undone by a failing mail provider (REL-4)', async () => {
    const { agent } = await player();
    t.mailer.failWith = new Error('provider down');
    expect((await book(agent, W.courtA.id, 10)).status).toBe(201);
    expect(await rows()).toHaveLength(1);
  });

  it('turns the hours into Booked on the availability grid', async () => {
    const { agent } = await player();
    await book(agent, W.courtA.id, 10, 2);
    const slots = (await grid()).body.courts.find((c: { name: string }) => c.name === 'Court A').slots;
    const state = (h: number) => slots.find((s: { startHour: number }) => s.startHour === h).state;
    expect([9, 10, 11, 12].map(state)).toEqual(['AVAILABLE', 'BOOKED', 'BOOKED', 'AVAILABLE']);
  });

  it('keeps the price it was booked at when the court price changes later (FR-2.10)', async () => {
    const { agent } = await player();
    await book(agent, W.courtA.id, 10);
    await prisma.court.update({ where: { id: W.courtA.id }, data: { priceRegular: '99.00' } });
    expect((await rows())[0].total_price).toBe('20.00');
  });

  it('allows back-to-back bookings: touching is not overlapping', async () => {
    const { agent } = await player();
    expect((await book(agent, W.courtA.id, 10)).status).toBe(201);
    expect((await book(agent, W.courtA.id, 11)).status).toBe(201);
    expect((await book(agent, W.courtA2.id, 12)).status).toBe(201);
  });

  it('can book the last hour of the day, and up to three hours', async () => {
    const { agent } = await player();
    expect((await book(agent, W.courtA.id, 22)).body).toMatchObject({ startHour: 22, endHour: 23 });
    expect((await book(agent, W.courtA.id, 9, 3)).body).toMatchObject({ hours: 3, endHour: 12, totalPrice: '60.00' });
  });
});

describe('the rules of when and what may be booked', () => {
  it('refuses an hour that is too close, and accepts one exactly 30 minutes away (FR-2.7)', async () => {
    t.clock.set('2030-01-15T12:30:00Z'); // sign in AFTER moving the clock: access tokens last 15 minutes
    const early = await player();
    expect((await book(early.agent, W.courtA.id, 13, 1, '2030-01-15')).status).toBe(201); // 13:00 is exactly 30 minutes away

    t.clock.set('2030-01-15T14:30:01Z');
    const late = await player();
    const res = await book(late.agent, W.courtA.id, 15, 1, '2030-01-15'); // 15:00, one second short of 30 minutes
    expect(res.status).toBe(422);
    expect(issues(res)).toEqual([{ in: 'body', path: 'startsAt', message: BOOKING_MESSAGES.tooLate(30) }]);
  });

  it('refuses hours in the past', async () => {
    const { agent } = await player();
    const res = await book(agent, W.courtA.id, 9, 1, '2030-01-15'); // 09:00, three hours ago
    expect(issues(res)[0]!.message).toBe(BOOKING_MESSAGES.tooLate(30));
    expect((await book(agent, W.courtA.id, 10, 1, '2030-01-10')).status).toBe(422);
  });

  it('allows up to 14 days ahead and refuses day 15 (FR-2.7)', async () => {
    const { agent } = await player();
    expect((await book(agent, W.courtA.id, 10, 1, '2030-01-29')).status).toBe(201);
    const res = await book(agent, W.courtA.id, 10, 1, '2030-01-30');
    expect(issues(res)).toEqual([{ in: 'body', path: 'startsAt', message: BOOKING_MESSAGES.tooFar(14) }]);
  });

  it('only accepts real hours of this court: whole hours, inside opening hours, never crossing closing time', async () => {
    const { agent } = await player();
    const wrong = async (iso: string, slots = 1) => {
      const res = await agent.post('/api/v1/bookings').send({ courtId: W.courtA.id, startsAt: iso, slots });
      expect(res.status, iso).toBe(422);
      expect(issues(res), iso).toEqual([{ in: 'body', path: 'startsAt', message: BOOKING_MESSAGES.notASlot }]);
    };
    await wrong('2030-01-16T18:30:00.000Z'); // half past
    await wrong('2030-01-16T18:00:01.000Z'); // one second late
    await wrong('2030-01-16T07:00:00.000Z'); // before opening (08:00)
    await wrong('2030-01-16T23:00:00.000Z'); // the closing hour itself
    await wrong('2030-01-16T22:00:00.000Z', 2); // 22:00 to 24:00 runs past closing time (23:00)
    expect(await rows()).toHaveLength(0);
  });

  it('limits the hours per booking by the platform setting, and the schema caps it at three', async () => {
    const { agent } = await player();
    const four = await agent.post('/api/v1/bookings').send({ courtId: W.courtA.id, startsAt: startsAt(10), slots: 4 });
    expect(four.status).toBe(422);
    expect(issues(four)[0]!.path).toBe('slots');

    start({ settings: staticSettings({ max_slots: 2 }) });
    const { agent: other } = await player();
    const res = await book(other, W.courtA.id, 10, 3);
    expect(issues(res)).toEqual([{ in: 'body', path: 'slots', message: BOOKING_MESSAGES.tooManySlots(2) }]);
    expect((await book(other, W.courtA.id, 10, 2)).status).toBe(201);
  });

  it('judges opening hours in the platform time zone (Karachi is UTC+5)', async () => {
    start({}, { PLATFORM_TZ: 'Asia/Karachi' });
    const { agent } = await player();
    expect((await book(agent, W.courtA.id, 3)).body).toMatchObject({ startHour: 8, date: '2030-01-16' }); // 03:00Z is 08:00 there
    expect((await book(agent, W.courtA.id, 2)).status).toBe(422); // 02:00Z is 07:00 there, before opening
    expect((await book(agent, W.courtA.id, 17)).body).toMatchObject({ startHour: 22 }); // 17:00Z is 22:00, the last hour
    expect((await book(agent, W.courtA.id, 18)).status).toBe(422); // 23:00 local: closed
  });

  it('can book across the hour that does not exist when clocks go forward (New York, 10 March 2030)', async () => {
    await prisma.venue.update({ where: { id: W.venue.id }, data: { openHour: 0, closeHour: 24, peakStartHour: null, peakEndHour: null } });
    start({}, { PLATFORM_TZ: 'America/New_York' });
    t.clock.set('2030-03-08T12:00:00Z');
    const { agent } = await player();
    const res = await agent.post('/api/v1/bookings').send({ courtId: W.courtA.id, startsAt: '2030-03-10T06:00:00.000Z', slots: 2 }); // 01:00 EST and 03:00 EDT
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ date: '2030-03-10', startHour: 1, endHour: 4, hours: 2, endsAt: '2030-03-10T08:00:00.000Z' });
  });

  it('refuses malformed requests with a 422', async () => {
    const { agent } = await player();
    for (const body of [{}, { courtId: 'nope', startsAt: startsAt(10), slots: 1 }, { courtId: W.courtA.id, startsAt: '2030-01-16 10:00', slots: 1 }, { courtId: W.courtA.id, startsAt: '2030-01-16T10:00:00+05:00', slots: 1 }, { courtId: W.courtA.id, startsAt: startsAt(10), slots: 0 }, { courtId: W.courtA.id, startsAt: startsAt(10), slots: 1.5 }]) {
      expect((await agent.post('/api/v1/bookings').send(body)).status, JSON.stringify(body)).toBe(422);
    }
  });

  it('answers 404 for a court that is missing, inactive, under maintenance, or in a venue that is not open', async () => {
    const { agent } = await player();
    const inactive = await prisma.court.create({ data: { venueId: W.venue.id, name: 'Old', sportId: W.futsal.id, priceRegular: '5.00', status: 'INACTIVE' } });
    const repairs = await prisma.court.create({ data: { venueId: W.venue.id, name: 'Repairs', sportId: W.futsal.id, priceRegular: '5.00', status: 'UNDER_MAINTENANCE' } });
    for (const id of ['00000000-0000-4000-8000-000000000000', inactive.id, repairs.id]) {
      const res = await book(agent, id, 10);
      expect(res.status, id).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    for (const status of ['INACTIVE', 'SUSPENDED'] as const) {
      await prisma.venue.update({ where: { id: W.venue.id }, data: { status } });
      expect((await book(agent, W.courtA.id, 10)).status, status).toBe(404);
    }
    expect(await rows()).toHaveLength(0);
  });
});

describe('who may book', () => {
  it('needs a session and the client header', async () => {
    const body = { courtId: W.courtA.id, startsAt: startsAt(10), slots: 1 };
    expect((await request(app).post('/api/v1/bookings').set('X-Client', 'web').send(body)).status).toBe(401);
    expect((await request(app).post('/api/v1/bookings').send(body)).status).toBe(403); // no X-Client header (SEC-1)
  });

  it('is for player accounts only (manager, staff and Super Admin are refused)', async () => {
    for (const role of ['MANAGER', 'STAFF', 'ADMIN'] as const) {
      const user = await createUser(prisma, { role });
      const agent = browser(app);
      if (role === 'STAFF') await prisma.staffProfile.create({ data: { userId: user.id, venueId: W.venue.id, invitedById: W.manager } });
      const login = await agent.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
      if (login.status !== 200) continue; // the Super Admin cannot sign in until T18, so cannot book either
      expect((await book(agent, W.courtA.id, 10)).status, role).toBe(403);
    }
    expect(await rows()).toHaveLength(0);
  });

  it('needs a complete profile (FR-1.15)', async () => {
    const { agent } = await player({ profile: false });
    const res = await book(agent, W.courtA.id, 10);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(await rows()).toHaveLength(0);
  });

  it('refuses an account suspended after signing in, at once', async () => {
    const { agent } = await player({ status: 'SUSPENDED' });
    const res = await book(agent, W.courtA.id, 10);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('credit tiers limit upcoming bookings (FR-2.11, FR-2.25, Figure 7)', () => {
  it.each([
    ['Good', 100, 3], ['Good, exactly 70', 70, 3],
    ['Caution', 69, 2], ['Caution, exactly 40', 40, 2],
    ['Restricted', 39, 1], ['Restricted, exactly 1', 1, 1],
    ['Blocked', 0, 0],
  ])('%s (score %i) may hold %i upcoming bookings', async (_name, score, limit) => {
    const { agent } = await player({ score });
    for (let i = 0; i < limit; i++) expect((await book(agent, W.courtA.id, 10, 1, day(i))).status, `booking ${i + 1}`).toBe(201);
    const res = await book(agent, W.courtA.id, 10, 1, day(limit));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'TIER_LIMIT', details: { limit, upcoming: limit } });
    expect(await rows()).toHaveLength(limit);
  });

  it('names the tier in the answer', async () => {
    const { agent } = await player({ score: 39 });
    await book(agent, W.courtA.id, 10);
    expect((await book(agent, W.courtA.id, 12)).body.error.details).toEqual({ tier: 'RESTRICTED', limit: 1, upcoming: 1 });
  });

  it('treats an account with a blocked date as Blocked, whatever the score says', async () => {
    const { agent } = await player({ score: 80, blockedAt: new Date('2030-01-01T00:00:00Z') });
    expect((await book(agent, W.courtA.id, 10)).body.error.details).toMatchObject({ tier: 'BLOCKED', limit: 0 });
  });

  it('counts only upcoming confirmed bookings: cancelled, completed and past ones do not use up the limit', async () => {
    const { agent, user } = await player({ score: 39 }); // limit 1
    await insertBooking({ courtId: W.courtA.id, playerId: user.id, start: '2030-01-10T10:00:00Z', end: '2030-01-10T11:00:00Z', status: 'CONFIRMED' }); // already started
    await insertBooking({ courtId: W.courtA.id, playerId: user.id, start: '2030-01-17T10:00:00Z', end: '2030-01-17T11:00:00Z', status: 'CANCELLED' });
    await insertBooking({ courtId: W.courtA.id, playerId: user.id, start: '2030-01-14T10:00:00Z', end: '2030-01-14T11:00:00Z', status: 'COMPLETED' });
    expect((await book(agent, W.courtA.id, 10)).status).toBe(201);
    expect((await book(agent, W.courtA.id, 12)).status).toBe(409); // now it is used up
  });

  it('follows the platform setting, not a constant', async () => {
    start({ settings: staticSettings({ upcoming_limits: { GOOD: 1, CAUTION: 1, RESTRICTED: 1, BLOCKED: 0 } }) });
    const { agent } = await player();
    expect((await book(agent, W.courtA.id, 10)).status).toBe(201);
    expect((await book(agent, W.courtA.id, 12)).body.error.code).toBe('TIER_LIMIT');
  });

  it('is checked before the court or the hour, so a blocked player learns why', async () => {
    const { agent } = await player({ score: 0 });
    const res = await agent.post('/api/v1/bookings').send({ courtId: '00000000-0000-4000-8000-000000000000', startsAt: '2030-01-16T18:30:00.000Z', slots: 1 });
    expect(res.body.error.code).toBe('TIER_LIMIT');
  });
});

describe('clashes (FR-2.9, SRS 5.3)', () => {
  it('refuses an hour that overlaps one of the player\'s own bookings, on any court (N3), but not one that merely touches', async () => {
    const { agent } = await player();
    await book(agent, W.courtA.id, 18, 2).expect(201); // 18:00 to 20:00
    for (const [court, hour, slots] of [[W.courtA2, 18, 1], [W.courtB, 19, 1], [W.courtA2, 17, 2], [W.courtA, 19, 2], [W.courtB, 18, 3]] as const) {
      const res = await book(agent, court.id, hour, slots);
      expect(res.status, `${court.name} ${hour}`).toBe(409);
      expect(res.body.error.code).toBe('BOOKING_OVERLAP');
    }
    expect((await book(agent, W.courtA2.id, 20)).status).toBe(201); // starts when the other ends
    expect((await book(agent, W.courtB.id, 16, 2)).status).toBe(201); // ends when the other starts
  });

  it('tells the second player the hour is taken and offers the nearest alternatives on courts of the same sport', async () => {
    const first = await player();
    const second = await player();
    await book(first.agent, W.courtA.id, 18).expect(201);
    const res = await book(second.agent, W.courtA.id, 18);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_TAKEN');
    const alt = res.body.error.details.alternatives as { courtName: string; startHour: number; endHour: number; slots: number; price: string; startsAt: string }[];
    // nearest first: the same hour on the other futsal court, then the neighbouring hours, nearest court name first; never the badminton court
    expect(alt.map((a) => `${a.courtName} ${a.startHour}`)).toEqual(['Court A2 18', 'Court A 17', 'Court A 19', 'Court A2 17', 'Court A2 19']);
    expect(alt[0]).toEqual({ courtId: W.courtA2.id, courtName: 'Court A2', startsAt: '2030-01-16T18:00:00.000Z', startHour: 18, endHour: 19, slots: 1, price: '30.00' });
    expect(alt[1]!.price).toBe('20.00'); // 17:00 is not peak
    expect(await rows()).toHaveLength(1);
  });

  it('offers windows as long as the one wanted, never overlapping existing bookings', async () => {
    const first = await player();
    const second = await player();
    await book(first.agent, W.courtA.id, 18, 2).expect(201); // 18:00 to 20:00 on Court A
    const res = await book(second.agent, W.courtA.id, 19, 2); // 19:00 to 21:00 clashes at 19:00
    const alt = res.body.error.details.alternatives as { courtName: string; startHour: number; slots: number; price: string }[];
    expect(alt.every((a) => a.slots === 2)).toBe(true);
    expect(alt[0]).toMatchObject({ courtName: 'Court A2', startHour: 19, price: '60.00' }); // same time, other futsal court
    expect(alt.some((a) => a.courtName === 'Court A' && a.startHour >= 17 && a.startHour <= 19)).toBe(false); // those would overlap 18:00 to 20:00
  });

  it('offers nothing when nothing else is free', async () => {
    const first = await player();
    const second = await player();
    await book(first.agent, W.courtA.id, 18).expect(201);
    const wholeDay = (courtId: string, from: string, to: string) =>
      prisma.courtBlock.create({ data: { courtId, startTime: from, endTime: to, reason: 'MANAGER', createdById: W.manager } });
    await wholeDay(W.courtA2.id, '2030-01-16T00:00:00Z', '2030-01-17T00:00:00Z'); // the other futsal court is closed all day
    await wholeDay(W.courtA.id, '2030-01-16T00:00:00Z', '2030-01-16T18:00:00Z'); // and Court A is blocked around the booked hour
    await wholeDay(W.courtA.id, '2030-01-16T19:00:00Z', '2030-01-17T00:00:00Z');
    const res = await book(second.agent, W.courtA.id, 18);
    expect(res.body.error.code).toBe('SLOT_TAKEN');
    expect(res.body.error.details.alternatives).toEqual([]);
  });

  it('refuses hours on a blocked court (manager and tournament blocks)', async () => {
    const { agent } = await player();
    await prisma.courtBlock.create({ data: { courtId: W.courtA.id, startTime: '2030-01-16T09:00:00Z', endTime: '2030-01-16T11:00:00Z', reason: 'MANAGER', createdById: W.manager } });
    await prisma.courtBlock.create({ data: { courtId: W.courtA.id, startTime: '2030-01-16T14:00:00Z', endTime: '2030-01-16T15:00:00Z', reason: 'TOURNAMENT', createdById: W.manager } });
    for (const [hour, slots] of [[9, 1], [10, 1], [8, 2], [10, 2], [14, 1], [13, 2]] as const) {
      expect((await book(agent, W.courtA.id, hour, slots)).body.error?.code, `${hour}+${slots}`).toBe('SLOT_TAKEN');
    }
    expect((await book(agent, W.courtA.id, 11)).status).toBe(201); // right after the block
    expect((await book(agent, W.courtA.id, 8)).status).toBe(201); // right before it
  });

  it('frees the hour again when a booking is cancelled, and keeps it taken when it is completed', async () => {
    const owner = await insertUser();
    await insertBooking({ courtId: W.courtA.id, playerId: owner, start: startsAt(10), end: startsAt(11), status: 'CANCELLED' });
    await insertBooking({ courtId: W.courtA.id, playerId: owner, start: startsAt(12), end: startsAt(13), status: 'COMPLETED' });
    const { agent } = await player();
    expect((await book(agent, W.courtA.id, 10)).status).toBe(201);
    expect((await book(agent, W.courtA.id, 12)).body.error.code).toBe('SLOT_TAKEN');
  });
});

describe('simultaneous bookings (the double-booking guarantee; T10 goes further)', () => {
  const statuses = (results: { status: number }[]) => results.map((r) => r.status).sort();

  it('lets exactly one of ten players have the same hour, and tells the other nine what is free', async () => {
    const players = await Promise.all(Array.from({ length: 10 }, () => player()));
    const results = await Promise.all(players.map((p) => book(p.agent, W.courtA.id, 18)));
    expect(statuses(results)).toEqual([201, ...Array(9).fill(409)]);
    const losers = results.filter((r) => r.status === 409);
    expect(losers.every((r) => r.body.error.code === 'SLOT_TAKEN')).toBe(true);
    expect(losers.every((r) => r.body.error.details.alternatives.length > 0)).toBe(true);
    expect(await rows()).toHaveLength(1);
  });

  it('gives one booking, not five, when a player taps five times at once', async () => {
    const { agent } = await player();
    const results = await Promise.all(Array.from({ length: 5 }, () => book(agent, W.courtA.id, 18)));
    expect(statuses(results)).toEqual([201, 409, 409, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'BOOKING_OVERLAP')).toBe(true);
    expect(await rows()).toHaveLength(1);
    expect(t.mailer.sent.filter((m) => m.subject.startsWith('Your AthleteVerse booking'))).toHaveLength(1); // one e-mail
  });

  it('cannot be tricked into a second overlapping booking by two different requests at once', async () => {
    const { agent } = await player();
    // All three requests overlap pairwise. Using 17:00-19:00 for the third request was incorrect:
    // that interval only TOUCHES the second request (19:00-21:00), so both could legally succeed.
    const results = await Promise.all([book(agent, W.courtA.id, 18, 2), book(agent, W.courtA2.id, 19, 2), book(agent, W.courtB.id, 18, 2)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1); // all three overlap each other in time
    expect(await rows()).toHaveLength(1);
  });

  it('holds the credit-tier limit even when a player books many different hours at once', async () => {
    const { agent } = await player(); // Good: three upcoming bookings
    const results = await Promise.all([8, 10, 12, 14, 16, 20].map((h) => book(agent, W.courtA.id, h)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409 && r.body.error.code === 'TIER_LIMIT')).toHaveLength(3);
    expect(await rows()).toHaveLength(3);
  });

  it('does not invent conflicts: players booking different hours at the same time all succeed, with no server errors', async () => {
    const players = await Promise.all(Array.from({ length: 8 }, () => player()));
    const results = await Promise.all(players.map((p, i) => book(p.agent, i % 2 ? W.courtA.id : W.courtA2.id, 8 + Math.floor(i / 2) * 2, 2)));
    expect(statuses(results)).toEqual(Array(8).fill(201));
    expect(await rows()).toHaveLength(8);
  });

  it('never answers with a server error under a mixed storm of bookings', async () => {
    const players = await Promise.all(Array.from({ length: 6 }, () => player()));
    const calls = players.flatMap((p) => [10, 11, 12].map((h) => book(p.agent, h % 2 ? W.courtA.id : W.courtA2.id, h, 1 + (h % 2))));
    const results = await Promise.all(calls);
    expect(results.some((r) => r.status >= 500)).toBe(false);
    const all = await rows();
    // whatever happened, no court and no player ever holds two overlapping bookings
    for (const a of all) for (const b of all) {
      if (a.id === b.id) continue;
      const overlap = a.start_time < b.end_time && b.start_time < a.end_time;
      expect(overlap && (a.court_id === b.court_id || a.player_id === b.player_id), `${a.booking_code} vs ${b.booking_code}`).toBe(false);
    }
  });
});

describe('layer 3: the database constraints (FR-2.9)', () => {
  async function violation(sql: string, params: unknown[]) {
    try {
      await pool.query(sql, params);
    } catch (err) {
      return err;
    }
    throw new Error('the database accepted a double booking');
  }
  const INSERT = `INSERT INTO bookings (booking_code, court_id, player_id, start_time, end_time, total_price) VALUES ($1, $2, $3, $4, $5, 20)`;

  it('turns an overlapping court booking into "slot taken", whatever the application layer did', async () => {
    const [a, b] = [await insertUser(), await insertUser()];
    await pool.query(INSERT, ['AAAAAAAA', W.courtA.id, a, startsAt(18), startsAt(19)]);
    const err = await violation(INSERT, ['BBBBBBBB', W.courtA.id, b, startsAt(18), startsAt(20)]);
    expect(translateBookingConflict(err)).toMatchObject({ code: 'SLOT_TAKEN', status: 409 });
  });

  it('turns an overlapping booking of one player on two courts into "you already have a booking"', async () => {
    const a = await insertUser();
    await pool.query(INSERT, ['AAAAAAAA', W.courtA.id, a, startsAt(18), startsAt(19)]);
    const err = await violation(INSERT, ['BBBBBBBB', W.courtB.id, a, startsAt(18), startsAt(19)]);
    expect(translateBookingConflict(err)).toMatchObject({ code: 'BOOKING_OVERLAP', status: 409 });
  });

  it('leaves every other error alone', async () => {
    const a = await insertUser();
    await pool.query(INSERT, ['AAAAAAAA', W.courtA.id, a, startsAt(18), startsAt(19)]);
    const duplicateCode = await violation(INSERT, ['AAAAAAAA', W.courtB.id, await insertUser(), startsAt(10), startsAt(11)]);
    expect(translateBookingConflict(duplicateCode)).toBeNull();
    expect(translateBookingConflict(new Error('anything else'))).toBeNull();
    expect(translateBookingConflict(undefined)).toBeNull();
  });
});
