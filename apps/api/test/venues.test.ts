// FR-2.1, FR-2.2, FR-2.3, FR-2.5, FR-2.7: public venue search, the venue page and the availability grid.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { staticSettings } from '../src/config/settings';
import { createDb } from '../src/db/prisma';
import { testDeps } from './helpers/app';
import { createApp } from './helpers/auth';
import { TEST_DATABASE_URL, resetDb } from './helpers/db';
import { insertBooking, insertUser } from './helpers/fixtures';

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.close());

let t: ReturnType<typeof testDeps>;
let app: ReturnType<typeof createApp>;
const prisma = db.prisma;

function start(overrides: Parameters<typeof testDeps>[0] = {}, envVars: Record<string, string> = {}) {
  t = testDeps({ prisma, ...overrides }, envVars); // the fake clock reads 2030-01-15 12:00 UTC
  app = createApp(t.deps);
}
beforeEach(async () => {
  await resetDb();
  start();
});

/** Two cities, two sports, and venues in every state a player should or should not see. */
async function seed() {
  const alpha = await prisma.city.create({ data: { name: 'Alpha City' } });
  const beta = await prisma.city.create({ data: { name: 'Beta City' } });
  const futsal = await prisma.sport.create({ data: { name: 'Futsal', minTeamSize: 5, maxTeamSize: 10 } });
  const badminton = await prisma.sport.create({ data: { name: 'Badminton', minTeamSize: 2, maxTeamSize: 4 } });
  const manager = await insertUser('MANAGER');
  const venue = (name: string, cityId: number, extra: object = {}) =>
    prisma.venue.create({ data: { managerId: manager, name, address: `1 ${name} Street`, cityId, phone: '920000000100', openHour: 8, closeHour: 23, ...extra } });
  const court = (venueId: string, name: string, sportId: number, priceRegular: string, extra: object = {}) =>
    prisma.court.create({ data: { venueId, name, sportId, priceRegular, ...extra } });

  const arena = await venue('Arena One', alpha.id, { peakStartHour: 18, peakEndHour: 23, address: '1 Main St' });
  const courtA = await court(arena.id, 'Court A', futsal.id, '20.00', { pricePeak: '30.00' });
  const courtB = await court(arena.id, 'Court B', badminton.id, '10.00', { pricePeak: '15.00' });
  await court(arena.id, 'Court C (repairs)', futsal.id, '5.00', { status: 'UNDER_MAINTENANCE' });
  const hall = await venue('Beta Sports Hall', beta.id, { openHour: 10, closeHour: 22, address: '9 River Rd' });
  await court(hall.id, 'Main Court', futsal.id, '35.00');
  const closed = await venue('Closed Venue', alpha.id, { status: 'INACTIVE' });
  await court(closed.id, 'Court 1', futsal.id, '1.00');
  const suspended = await venue('Suspended Venue', alpha.id, { status: 'SUSPENDED' });
  await court(suspended.id, 'Court 1', futsal.id, '1.00');
  const empty = await venue('Venue Without Courts', alpha.id);
  await court(empty.id, 'Old Court', futsal.id, '1.00', { status: 'INACTIVE' });
  return { alpha, beta, futsal, badminton, manager, arena, courtA, courtB, hall, closed, suspended, empty };
}

const list = (qs = '') => request(app).get(`/api/v1/venues${qs}`);
const names = (res: { body: { items: { name: string }[] } }) => res.body.items.map((v) => v.name);

describe('GET /api/v1/venues', () => {
  it('lists only active venues that have an active court, by name, with no sign-in needed', async () => {
    await seed();
    const res = await list();
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Arena One', 'Beta Sports Hall']); // not inactive, suspended, or court-less venues
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
  });

  it('describes each venue: city, hours, the sports and cheapest price of its active courts', async () => {
    const w = await seed();
    const arena = (await list()).body.items[0];
    expect(arena).toEqual({
      id: w.arena.id,
      name: 'Arena One',
      address: '1 Main St',
      cityId: w.alpha.id,
      cityName: 'Alpha City',
      openHour: 8,
      closeHour: 23,
      sports: [{ id: w.badminton.id, name: 'Badminton' }, { id: w.futsal.id, name: 'Futsal' }], // the repairs court is ignored
      courtCount: 2,
      fromPrice: '10.00',
    });
  });

  it('is empty, not an error, when there are no venues', async () => {
    expect((await list()).body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  describe('search and filters (FR-2.2)', () => {
    it('finds a venue by part of its name or address, ignoring letter case', async () => {
      await seed();
      expect(names(await list('?q=ARENA'))).toEqual(['Arena One']);
      expect(names(await list('?q=river'))).toEqual(['Beta Sports Hall']);
      expect(names(await list('?q=%20%20sports%20'))).toEqual(['Beta Sports Hall']); // surrounding spaces are ignored
      expect(names(await list('?q=zzz'))).toEqual([]);
    });

    it('treats % and _ as ordinary characters, not as wildcards', async () => {
      const w = await seed();
      const odd = await prisma.venue.create({ data: { managerId: w.manager, name: '100% Fun_Hall', address: 'Elsewhere', cityId: w.alpha.id, phone: '1', openHour: 8, closeHour: 20 } });
      await prisma.court.create({ data: { venueId: odd.id, name: 'C', sportId: w.futsal.id, priceRegular: '9.00' } });
      expect(names(await list('?q=%25'))).toEqual(['100% Fun_Hall']); // "%" alone must not match everything
      expect(names(await list('?q=_'))).toEqual(['100% Fun_Hall']);
    });

    it('filters by city', async () => {
      const w = await seed();
      expect(names(await list(`?cityId=${w.beta.id}`))).toEqual(['Beta Sports Hall']);
      expect(names(await list(`?cityId=${w.alpha.id}`))).toEqual(['Arena One']);
    });

    it('filters by sport and then describes only the matching courts', async () => {
      const w = await seed();
      const res = await list(`?sportId=${w.badminton.id}`);
      expect(names(res)).toEqual(['Arena One']);
      expect(res.body.items[0]).toMatchObject({ sports: [{ name: 'Badminton' }], courtCount: 1, fromPrice: '10.00' });
      const futsal = await list(`?sportId=${w.futsal.id}`);
      expect(futsal.body.items.map((v: { fromPrice: string }) => v.fromPrice)).toEqual(['20.00', '35.00']); // the cheaper badminton court is not counted
    });

    it('filters by the regular hourly price of a court, inclusive at both ends', async () => {
      await seed();
      expect(names(await list('?maxPrice=10'))).toEqual(['Arena One']); // 10.00 is within the limit
      expect(names(await list('?minPrice=35'))).toEqual(['Beta Sports Hall']);
      expect(names(await list('?minPrice=11&maxPrice=34'))).toEqual(['Arena One']); // the futsal court at 20.00
      expect(names(await list('?minPrice=36'))).toEqual([]);
    });

    it('sorts by cheapest court price, then name', async () => {
      const w = await seed();
      const cheap = await prisma.venue.create({ data: { managerId: w.manager, name: 'Zed Cheap Hall', address: 'x', cityId: w.alpha.id, phone: '1', openHour: 8, closeHour: 20 } });
      await prisma.court.create({ data: { venueId: cheap.id, name: 'C', sportId: w.futsal.id, priceRegular: '10.00' } });
      expect(names(await list('?sort=price'))).toEqual(['Arena One', 'Zed Cheap Hall', 'Beta Sports Hall']); // both 10.00: name breaks the tie
      expect(names(await list())).toEqual(['Arena One', 'Beta Sports Hall', 'Zed Cheap Hall']);
    });

    it('combines filters', async () => {
      const w = await seed();
      expect(names(await list(`?cityId=${w.alpha.id}&sportId=${w.futsal.id}&maxPrice=25&q=main`))).toEqual(['Arena One']);
      expect(names(await list(`?cityId=${w.beta.id}&sportId=${w.badminton.id}`))).toEqual([]);
    });
  });

  it('pages 20 at a time with a stable order and the true total (PERF-4)', async () => {
    const w = await seed();
    for (let i = 0; i < 43; i++) {
      const v = await prisma.venue.create({ data: { managerId: w.manager, name: `Hall ${String(i).padStart(2, '0')}`, address: 'x', cityId: w.alpha.id, phone: '1', openHour: 8, closeHour: 20 } });
      await prisma.court.create({ data: { venueId: v.id, name: 'C', sportId: w.futsal.id, priceRegular: '9.00' } });
    }
    const pages = await Promise.all([1, 2, 3, 4].map((p) => list(`?page=${p}`)));
    expect(pages.map((p) => p.body.items.length)).toEqual([20, 20, 5, 0]); // 45 venues in all
    expect(pages.every((p) => p.body.total === 45)).toBe(true);
    const all = pages.flatMap((p) => names(p));
    expect(new Set(all).size).toBe(45); // no venue twice, none missing
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b)));
  });

  it('refuses nonsense in the query with a 422 that names the field', async () => {
    for (const qs of ['?page=0', '?page=abc', '?sort=rating', '?maxPrice=abc', '?minPrice=-1', '?cityId=0', `?q=${'x'.repeat(81)}`]) {
      const res = await list(qs);
      expect(res.status, qs).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('GET /api/v1/venues/:id', () => {
  const detail = (id: string) => request(app).get(`/api/v1/venues/${id}`);

  it('shows the venue, its active courts with prices, the booking window and the cancellation and credit policy (FR-2.3)', async () => {
    const w = await seed();
    const res = await detail(w.arena.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: w.arena.id,
      name: 'Arena One',
      description: null,
      address: '1 Main St',
      cityName: 'Alpha City',
      contactPhone: '920000000100',
      openHour: 8,
      closeHour: 23,
      peakStartHour: 18,
      peakEndHour: 23,
      timeZone: 'UTC',
      bookingWindow: { today: '2030-01-15', lastDate: '2030-01-29' },
      policy: { advanceDays: 14, minLeadMinutes: 30, maxSlots: 3, freeCancelHours: 6, lastMinuteHours: 1, penaltyLate: 10, penaltyLastMinute: 20, noShowWaitMinutes: 15, penaltyNoShow: 30, penaltyUnpaid: 50 },
    });
    expect(res.body.courts).toEqual([
      { id: w.courtA.id, name: 'Court A', sportId: w.futsal.id, sportName: 'Futsal', priceRegular: '20.00', pricePeak: '30.00' },
      { id: w.courtB.id, name: 'Court B', sportId: w.badminton.id, sportName: 'Badminton', priceRegular: '10.00', pricePeak: '15.00' },
    ]); // the court under maintenance is not shown
  });

  it('reads the policy from the platform settings, not from constants', async () => {
    const w = await seed();
    start({ settings: staticSettings({ free_cancel_hours: 12, penalty_noshow: 40, advance_days: 7 }) });
    const res = await detail(w.arena.id);
    expect(res.body.policy).toMatchObject({ freeCancelHours: 12, penaltyNoShow: 40, advanceDays: 7 });
    expect(res.body.bookingWindow.lastDate).toBe('2030-01-22');
  });

  it('works out "today" in the platform time zone', async () => {
    const w = await seed();
    start({}, { PLATFORM_TZ: 'Pacific/Kiritimati' }); // 12:00 UTC on 15 January is already the 16th there
    expect((await detail(w.arena.id)).body.bookingWindow).toEqual({ today: '2030-01-16', lastDate: '2030-01-30' });
  });

  it('answers 404 for a venue that is missing, inactive or suspended, and 422 for a malformed id', async () => {
    const w = await seed();
    for (const id of ['00000000-0000-4000-8000-000000000000', w.closed.id, w.suspended.id]) {
      const res = await detail(id);
      expect(res.status, id).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await detail('not-a-uuid')).status).toBe(422);
  });

  it('shows only what is meant to be public (no manager, no internal ids)', async () => {
    const w = await seed();
    const keys = Object.keys((await detail(w.arena.id)).body).sort();
    expect(keys).toEqual(['address', 'bookingWindow', 'cityId', 'cityName', 'contactPhone', 'courts', 'description', 'id', 'name', 'openHour', 'closeHour', 'peakEndHour', 'peakStartHour', 'policy', 'timeZone'].sort());
  });
});

describe('GET /api/v1/venues/:id/availability', () => {
  const grid = (id: string, date: string) => request(app).get(`/api/v1/venues/${id}/availability?date=${date}`);
  type Grid = { courts: { courtId: string; name: string; slots: { startHour: number; startsAt: string; state: string; price: string }[] }[] };
  const stateOf = (body: Grid, courtName: string, hour: number) => body.courts.find((c) => c.name === courtName)!.slots.find((s) => s.startHour === hour)!.state;

  it('gives every active court one slot per hour with its price and exact UTC time (FR-2.5)', async () => {
    const w = await seed();
    const res = await grid(w.arena.id, '2030-01-16');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ date: '2030-01-16', timeZone: 'UTC' });
    expect(res.body.courts.map((c: { name: string }) => c.name)).toEqual(['Court A', 'Court B']); // not the one under maintenance

    const a = res.body.courts[0].slots;
    expect(a).toHaveLength(15);
    expect(a[0]).toEqual({ startHour: 8, endHour: 9, startsAt: '2030-01-16T08:00:00.000Z', endsAt: '2030-01-16T09:00:00.000Z', state: 'AVAILABLE', price: '20.00' });
    expect(a.find((s: { startHour: number }) => s.startHour === 18).price).toBe('30.00'); // peak
    expect(res.body.courts[1].slots.find((s: { startHour: number }) => s.startHour === 18).price).toBe('15.00');
    expect(a.every((s: { state: string }) => s.state === 'AVAILABLE')).toBe(true);
  });

  it('marks booked hours, including both hours of a two-hour booking, and leaves other courts and hours alone', async () => {
    const w = await seed();
    await insertBooking({ courtId: w.courtA.id, playerId: await insertUser(), start: '2030-01-16T18:00:00Z', end: '2030-01-16T20:00:00Z' });
    const body = (await grid(w.arena.id, '2030-01-16')).body as Grid;
    expect([17, 18, 19, 20].map((h) => stateOf(body, 'Court A', h))).toEqual(['AVAILABLE', 'BOOKED', 'BOOKED', 'AVAILABLE']);
    expect(stateOf(body, 'Court B', 18)).toBe('AVAILABLE');
  });

  it('treats confirmed and completed bookings as taking the slot, and cancelled and no-show ones as free', async () => {
    const w = await seed();
    const player = await insertUser();
    const slot = (hour: number) => ({ courtId: w.courtA.id, playerId: player, start: `2030-01-16T${hour}:00:00Z`, end: `2030-01-16T${hour + 1}:00:00Z` });
    await insertBooking({ ...slot(10), status: 'CONFIRMED' });
    await insertBooking({ ...slot(11), status: 'COMPLETED' });
    await insertBooking({ ...slot(12), status: 'CANCELLED' });
    await insertBooking({ ...slot(13), status: 'NO_SHOW' });
    const body = (await grid(w.arena.id, '2030-01-16')).body as Grid;
    expect([10, 11, 12, 13].map((h) => stateOf(body, 'Court A', h))).toEqual(['BOOKED', 'BOOKED', 'AVAILABLE', 'AVAILABLE']);
  });

  it('marks blocked hours (manager blocks and tournament blocks), and a booking wins over a block', async () => {
    const w = await seed();
    const block = (courtId: string, start: string, end: string, reason: 'MANAGER' | 'TOURNAMENT') =>
      prisma.courtBlock.create({ data: { courtId, startTime: start, endTime: end, reason, createdById: w.manager } });
    await block(w.courtA.id, '2030-01-16T09:00:00Z', '2030-01-16T11:00:00Z', 'MANAGER');
    await block(w.courtA.id, '2030-01-16T14:00:00Z', '2030-01-16T15:00:00Z', 'TOURNAMENT');
    await insertBooking({ courtId: w.courtA.id, playerId: await insertUser(), start: '2030-01-16T10:00:00Z', end: '2030-01-16T11:00:00Z' });
    const body = (await grid(w.arena.id, '2030-01-16')).body as Grid;
    expect([8, 9, 10, 11, 14, 15].map((h) => stateOf(body, 'Court A', h))).toEqual(['AVAILABLE', 'BLOCKED', 'BOOKED', 'AVAILABLE', 'BLOCKED', 'AVAILABLE']);
  });

  it('marks hours that cannot be booked any more as past: already started, or starting within 30 minutes (FR-2.7)', async () => {
    const w = await seed();
    t.clock.set('2030-01-15T12:30:00Z');
    let body = (await grid(w.arena.id, '2030-01-15')).body as Grid;
    expect([8, 11, 12, 13, 14].map((h) => stateOf(body, 'Court A', h))).toEqual(['PAST', 'PAST', 'PAST', 'AVAILABLE', 'AVAILABLE']); // 13:00 is exactly 30 minutes away

    t.clock.set('2030-01-15T12:30:01Z');
    body = (await grid(w.arena.id, '2030-01-15')).body as Grid;
    expect(stateOf(body, 'Court A', 13)).toBe('PAST'); // one second short of 30 minutes
    expect(stateOf(body, 'Court A', 14)).toBe('AVAILABLE');
  });

  it('shows a booked hour as past once it is past (past wins), and never reveals who booked', async () => {
    const w = await seed();
    const player = await insertUser();
    await insertBooking({ courtId: w.courtA.id, playerId: player, start: '2030-01-15T09:00:00Z', end: '2030-01-15T10:00:00Z' });
    const res = await grid(w.arena.id, '2030-01-15');
    expect(stateOf(res.body, 'Court A', 9)).toBe('PAST');
    expect(res.text).not.toContain(player);
    const slotKeys = Object.keys(res.body.courts[0].slots[0]).sort();
    expect(slotKeys).toEqual(['endHour', 'endsAt', 'price', 'startHour', 'startsAt', 'state']);
  });

  it('only shows dates from today to today plus the advance window (14 days), inclusive', async () => {
    const w = await seed();
    expect((await grid(w.arena.id, '2030-01-15')).status).toBe(200); // today
    expect((await grid(w.arena.id, '2030-01-29')).status).toBe(200); // the 14th day ahead
    for (const date of ['2030-01-14', '2030-01-30']) {
      const res = await grid(w.arena.id, date);
      expect(res.status, date).toBe(422);
      expect(res.body.error.details.issues).toEqual([{ in: 'query', path: 'date', message: 'Choose a date from 2030-01-15 to 2030-01-29.' }]);
    }
    for (const bad of ['tomorrow', '2030-02-30', '15-01-2030', '']) expect((await grid(w.arena.id, bad)).status, bad).toBe(422);
    expect((await request(app).get(`/api/v1/venues/${w.arena.id}/availability`)).status).toBe(422); // date is required
  });

  it('builds the day in the platform time zone: Karachi is five hours ahead of UTC', async () => {
    const w = await seed();
    start({}, { PLATFORM_TZ: 'Asia/Karachi' }); // 12:00 UTC is 17:00 on 15 January in Karachi
    await insertBooking({ courtId: w.courtA.id, playerId: await insertUser(), start: '2030-01-16T03:00:00Z', end: '2030-01-16T04:00:00Z' }); // 08:00 local
    const res = await grid(w.arena.id, '2030-01-16');
    expect(res.body.timeZone).toBe('Asia/Karachi');
    expect(res.body.courts[0].slots[0]).toMatchObject({ startHour: 8, startsAt: '2030-01-16T03:00:00.000Z', state: 'BOOKED' });
    // "today" is the 15th there, and its 08:00 to 16:00 hours are all past by 17:00 local
    const today = (await grid(w.arena.id, '2030-01-15')).body as Grid;
    expect([8, 16, 17, 18].map((h) => stateOf(today, 'Court A', h))).toEqual(['PAST', 'PAST', 'PAST', 'AVAILABLE']); // 17:00 starts now: too late; 18:00 is 60 minutes away
  });

  it('leaves out the hour that does not exist when clocks go forward (10 March 2030, New York)', async () => {
    const w = await seed();
    const allDay = await prisma.venue.update({ where: { id: w.arena.id }, data: { openHour: 0, closeHour: 24, peakStartHour: null, peakEndHour: null } });
    start({}, { PLATFORM_TZ: 'America/New_York' });
    t.clock.set('2030-03-08T12:00:00Z');
    const res = await grid(allDay.id, '2030-03-10');
    const hours = res.body.courts[0].slots.map((s: { startHour: number }) => s.startHour);
    expect(hours).toHaveLength(23);
    expect(hours).not.toContain(2);
    expect(res.body.courts[0].slots.find((s: { startHour: number }) => s.startHour === 3).startsAt).toBe('2030-03-10T07:00:00.000Z');
  });

  it('answers 404 for missing, inactive and suspended venues, and shows no courts for a venue without active ones', async () => {
    const w = await seed();
    for (const id of ['00000000-0000-4000-8000-000000000000', w.closed.id, w.suspended.id]) expect((await grid(id, '2030-01-16')).status, id).toBe(404);
    expect((await grid(w.empty.id, '2030-01-16')).body.courts).toEqual([]);
    expect((await grid('nope', '2030-01-16')).status).toBe(422);
  });
});
