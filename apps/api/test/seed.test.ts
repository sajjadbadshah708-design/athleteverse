// Runs the real seed CLI against the test database: idempotent, owner flagged, production guard (SA-1, MNT-3).
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createDb } from '../src/db/prisma';
import { testDeps } from './helpers/app';
import { browser } from './helpers/auth';
import { SETTING_DEFAULTS } from '../src/config/settingsDefaults';
import { pool, resetDb, TEST_DATABASE_URL } from './helpers/db';

const apiDir = fileURLToPath(new URL('..', import.meta.url));

function runSeed(extraEnv: Record<string, string> = {}) {
  return execSync('npx tsx prisma/seed.ts', {
    cwd: apiDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      DIRECT_URL: TEST_DATABASE_URL,
      NODE_ENV: 'test',
      OWNER_EMAIL: '',
      OWNER_PHONE: '',
      OWNER_PASSWORD: '',
      SEED_DEMO: '',
      SEED_PASSWORD: '',
      ...extraEnv,
    },
  });
}

async function counts() {
  const q = async (sql: string) => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n);
  return {
    users: await q('SELECT count(*) n FROM users'),
    venues: await q('SELECT count(*) n FROM venues'),
    courts: await q('SELECT count(*) n FROM courts'),
    settings: await q('SELECT count(*) n FROM settings'),
    sports: await q('SELECT count(*) n FROM sports'),
    cities: await q('SELECT count(*) n FROM cities'),
    staff: await q('SELECT count(*) n FROM staff_profiles'),
    players: await q('SELECT count(*) n FROM player_profiles'),
  };
}

describe('seed script', () => {
  beforeAll(async () => {
    await resetDb();
    runSeed();
  });

  it('creates the reference data, settings, owner and demo data', async () => {
    expect(await counts()).toEqual({
      users: 5, venues: 1, courts: 2, settings: Object.keys(SETTING_DEFAULTS).length,
      sports: 2, cities: 1, staff: 1, players: 2,
    });
    const owner = (await pool.query(`SELECT role, status, is_owner, credit_score, password_hash FROM users WHERE is_owner`)).rows;
    expect(owner).toHaveLength(1);
    expect(owner[0]).toMatchObject({ role: 'ADMIN', status: 'ACTIVE', is_owner: true, credit_score: 100 });
    expect(owner[0].password_hash).toMatch(/^\$2[aby]\$/); // bcrypt (FR-1.4), never plain text
  });

  it('scopes the staff member to the demo venue and the venue to the demo manager', async () => {
    const { rows } = await pool.query(
      `SELECT v.name, m.email AS manager, s.email AS staff
         FROM staff_profiles sp
         JOIN venues v ON v.id = sp.venue_id
         JOIN users m ON m.id = v.manager_id
         JOIN users s ON s.id = sp.user_id`,
    );
    expect(rows).toEqual([{ name: 'Demo Arena', manager: 'manager@athleteverse.test', staff: 'staff@athleteverse.test' }]);
  });

  it('is idempotent: a second run changes nothing and keeps existing values', async () => {
    const before = await counts();
    await pool.query(`UPDATE settings SET value = '99'::jsonb WHERE key = 'advance_days'`);
    runSeed();
    expect(await counts()).toEqual(before);
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'advance_days'`);
    expect(rows[0].value).toBe(99); // an edited setting is not overwritten
  });

  it('refuses to run in production without owner credentials', () => {
    expect(() => runSeed({ NODE_ENV: 'production' })).toThrow();
  });

  it('seeds only the owner in production when credentials are given', async () => {
    await resetDb();
    runSeed({
      NODE_ENV: 'production',
      OWNER_EMAIL: 'boss@athleteverse.test',
      OWNER_PHONE: '921234567890',
      OWNER_PASSWORD: 'Str0ngPassw0rd',
    });
    const c = await counts();
    expect(c.users).toBe(1);
    expect(c.venues).toBe(0);
    expect(c.settings).toBe(Object.keys(SETTING_DEFAULTS).length);
  });
});

describe('seeded accounts can sign in (the demo for T14, T15 and T19 depends on it)', () => {
  const db = createDb(TEST_DATABASE_URL);
  afterAll(() => db.close());

  it('lets the demo manager, staff and players in with the demo password, and still refuses the Super Admin', async () => {
    await resetDb();
    runSeed();
    const app = createApp(testDeps({ prisma: db.prisma }, { BCRYPT_COST: '10' }).deps); // the seed hashes at cost 10; the cost is read from the hash itself
    const signIn = (email: string, password: string) => browser(app).post('/api/v1/auth/login').send({ email, password });

    const expected = [
      ['manager@athleteverse.test', 'MANAGER'],
      ['staff@athleteverse.test', 'STAFF'],
      ['player1@athleteverse.test', 'PLAYER'],
      ['player2@athleteverse.test', 'PLAYER'],
    ] as const;
    for (const [email, role] of expected) {
      const res = await signIn(email, 'Demo12345');
      expect(res.status, email).toBe(200);
      expect(res.body.user.role).toBe(role);
    }
    expect((await signIn('staff@athleteverse.test', 'Demo12345')).body.user.staffVenueId).not.toBeNull();
    expect((await signIn('manager@athleteverse.test', 'wrong-password1')).status).toBe(401);
    expect((await signIn('owner@athleteverse.test', 'ChangeMe12345')).body.error.code).toBe('FORBIDDEN'); // SA-3: second step comes in T18
  });
});
