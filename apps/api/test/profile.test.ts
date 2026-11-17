// FR-1.14, FR-1.15, FR-1.16, A7: the narrowed profile (city, area, date of birth) and the 16-year age check.
import { PROFILE_MESSAGES } from '@athleteverse/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/prisma';
import { testDeps } from './helpers/app';
import { browser, createApp, createUser, PASSWORD } from './helpers/auth';
import { TEST_DATABASE_URL, pool, resetDb } from './helpers/db';

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.close());

let t: ReturnType<typeof testDeps>;
let app: ReturnType<typeof createApp>;
let cityId: number;

async function setup(envVars: Record<string, string> = {}) {
  await resetDb();
  t = testDeps({ prisma: db.prisma }, envVars); // the fake clock reads 2030-01-15 12:00 UTC
  app = createApp(t.deps);
  cityId = (await db.prisma.city.create({ data: { name: 'Demo City' } })).id;
}
beforeEach(() => setup());

/** A fresh signed-in player (each age case needs its own, because the date of birth is saved only once). */
async function player(role: 'PLAYER' | 'MANAGER' = 'PLAYER') {
  const user = await createUser(db.prisma, { role });
  const agent = browser(app);
  await agent.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
  return { user, agent };
}
const save = (agent: ReturnType<typeof browser>, body: object) => agent.patch('/api/v1/me/profile').send(body);
const issuesOf = (res: { body: { error: { details: { issues: { path: string; message: string }[] } } } }) => res.body.error.details.issues;

describe('GET /api/v1/me/profile', () => {
  it('is empty for a new player', async () => {
    const { agent } = await player();
    const res = await agent.get('/api/v1/me/profile');
    expect(res.body).toEqual({ cityId: null, cityName: null, area: null, dateOfBirthProvided: false, complete: false });
  });
});

describe('PATCH /api/v1/me/profile', () => {
  it('completes the profile, and the date of birth is stored but never sent back (FR-1.16)', async () => {
    const { agent, user } = await player();
    const res = await save(agent, { cityId, area: '  Downtown ', dateOfBirth: '2000-06-01' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cityId, cityName: 'Demo City', area: 'Downtown', dateOfBirthProvided: true, complete: true });
    expect(res.text).not.toContain('2000-06-01');
    expect(res.text).not.toMatch(/dateOfBirth"/);

    const row = (await pool.query(`SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS dob FROM player_profiles WHERE user_id = $1`, [user.id])).rows[0];
    expect(row.dob).toBe('2000-06-01'); // an exact calendar date, not shifted by any time zone

    expect((await agent.get('/api/v1/me/profile')).text).not.toContain('2000-06-01');
    expect((await agent.get('/api/v1/me')).body.user.profileComplete).toBe(true); // the gate now opens (FR-1.15)
  });

  it('asks for a city and, the first time, a date of birth, both reported at once', async () => {
    const { agent } = await player();
    const res = await save(agent, { cityId: 99999 });
    expect(res.status).toBe(422);
    expect(issuesOf(res).map((i) => i.path).sort()).toEqual(['cityId', 'dateOfBirth']);
    expect(issuesOf(res).find((i) => i.path === 'dateOfBirth')!.message).toBe(PROFILE_MESSAGES.dateRequired);
    expect(await pool.query(`SELECT 1 FROM player_profiles`).then((r) => r.rowCount)).toBe(0);
  });

  describe('the age check (A7: at least 16)', () => {
    it('accepts someone who turns 16 today and refuses someone who turns 16 tomorrow', async () => {
      const today = await player();
      expect((await save(today.agent, { cityId, dateOfBirth: '2014-01-15' })).status).toBe(200); // fake "today" is 2030-01-15

      const tomorrow = await player();
      const res = await save(tomorrow.agent, { cityId, dateOfBirth: '2014-01-16' });
      expect(res.status).toBe(422);
      expect(issuesOf(res)).toEqual([{ in: 'body', path: 'dateOfBirth', message: PROFILE_MESSAGES.tooYoung }]);
      expect((await tomorrow.agent.get('/api/v1/me')).body.user.profileComplete).toBe(false);
    });

    it('judges the age on the platform\'s calendar day, not on UTC', async () => {
      // 12:00 UTC on 15 January is already 16 January in Kiritimati (UTC+14)
      await setup({ PLATFORM_TZ: 'Pacific/Kiritimati' });
      const kiritimati = await player();
      expect((await save(kiritimati.agent, { cityId, dateOfBirth: '2014-01-16' })).status).toBe(200);

      await setup({ PLATFORM_TZ: 'UTC' });
      const utc = await player();
      expect((await save(utc.agent, { cityId, dateOfBirth: '2014-01-16' })).status).toBe(422);
    });

    it('refuses the future, dates before 1900, and dates that do not exist', async () => {
      const { agent } = await player();
      for (const dateOfBirth of ['2030-01-16', '1899-12-31', '2008-02-30', '2001-02-29', '2000-13-01', '01/06/2000', 'yesterday']) {
        const res = await save(agent, { cityId, dateOfBirth });
        expect(res.status, dateOfBirth).toBe(422);
        expect(issuesOf(res)[0]!.path, dateOfBirth).toBe('dateOfBirth');
      }
      expect(await pool.query(`SELECT 1 FROM player_profiles`).then((r) => r.rowCount)).toBe(0);
    });

    it('handles a 29 February birthday', async () => {
      const { agent } = await player();
      expect((await save(agent, { cityId, dateOfBirth: '2008-02-29' })).status).toBe(200); // sixteen since 1 March 2024
    });
  });

  it('only accepts an active city that exists', async () => {
    const inactive = await db.prisma.city.create({ data: { name: 'Closed City', isActive: false } });
    const { agent } = await player();
    for (const bad of [99999, inactive.id]) {
      const res = await save(agent, { cityId: bad, dateOfBirth: '2000-01-01' });
      expect(issuesOf(res)).toEqual([{ in: 'body', path: 'cityId', message: PROFILE_MESSAGES.chooseCity }]);
    }
  });

  it('keeps the area short, trims it, and treats an empty one as none', async () => {
    const { agent } = await player();
    expect((await save(agent, { cityId, dateOfBirth: '2000-01-01', area: 'x'.repeat(51) })).status).toBe(422);
    expect((await save(agent, { cityId, dateOfBirth: '2000-01-01', area: '   ' })).body.area).toBeNull();
  });

  it('can be updated later, but the date of birth is locked once saved', async () => {
    const other = await db.prisma.city.create({ data: { name: 'Another City' } });
    const { agent, user } = await player();
    await save(agent, { cityId, dateOfBirth: '2000-06-01', area: 'Downtown' }).expect(200);

    const moved = await save(agent, { cityId: other.id, area: 'Harbour' }); // no date of birth: fine
    expect(moved.body).toMatchObject({ cityName: 'Another City', area: 'Harbour', complete: true });

    const tryChange = await save(agent, { cityId, dateOfBirth: '1990-01-01' });
    expect(tryChange.status).toBe(422);
    expect(issuesOf(tryChange)).toEqual([{ in: 'body', path: 'dateOfBirth', message: PROFILE_MESSAGES.dateLocked }]);
    const row = (await pool.query(`SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS dob FROM player_profiles WHERE user_id = $1`, [user.id])).rows[0];
    expect(row.dob).toBe('2000-06-01');
  });

  it('creates exactly one profile when the first save is sent several times at once', async () => {
    const { agent } = await player();
    const results = await Promise.all(Array.from({ length: 6 }, () => save(agent, { cityId, dateOfBirth: '2000-06-01' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 422)).toHaveLength(5); // the others find the profile and the locked date
    expect(results.some((r) => r.status >= 500)).toBe(false);
    expect(await pool.query(`SELECT 1 FROM player_profiles`).then((r) => r.rowCount)).toBe(1);
  });

  it('is for players only, and needs a session', async () => {
    const manager = await player('MANAGER');
    expect((await save(manager.agent, { cityId, dateOfBirth: '2000-01-01' })).status).toBe(403);
    expect((await manager.agent.get('/api/v1/me/profile')).status).toBe(403);
    expect((await request(app).patch('/api/v1/me/profile').set('X-Client', 'web').send({ cityId })).status).toBe(401);
  });
});
