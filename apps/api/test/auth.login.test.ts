// FR-1.7 (lockout), FR-1.8 (cookies), FR-1.24 (sessions, cap of 5), and who may sign in (Phase 2: auth rules).
import type { Role, UserStatus } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { staticSettings } from '../src/config/settings';
import { createDb } from '../src/db/prisma';
import { testDeps } from './helpers/app';
import { browser, cookieNamed, createApp, createUser, PASSWORD } from './helpers/auth';
import { TEST_DATABASE_URL, pool, resetDb } from './helpers/db';
import { createWorld } from './helpers/fixtures';

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.close());

let t: ReturnType<typeof testDeps>;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  await resetDb();
  t = testDeps({ prisma: db.prisma });
  app = createApp(t.deps);
});

const login = (email: string, password = PASSWORD, agent = browser(app)) => agent.post('/api/v1/auth/login').send({ email, password });

describe('POST /api/v1/auth/login', () => {
  it('signs in with HttpOnly cookies, ignoring the letter case of the e-mail', async () => {
    const user = await createUser(db.prisma, { email: 'ali@example.com' });
    const res = await login('ALI@Example.com');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, role: 'PLAYER', status: 'ACTIVE', creditScore: 100, profileComplete: false });
    expect(cookieNamed(res, 'av_access')).toMatch(/HttpOnly/i);
    expect(cookieNamed(res, 'av_refresh')).toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
  });

  it('gives the same answer for a wrong password and for an unknown e-mail', async () => {
    await createUser(db.prisma, { email: 'ali@example.com' });
    const wrong = await login('ali@example.com', 'Wrong1234');
    const unknown = await login('nobody@example.com');
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account for 15 minutes after the fifth consecutive failure (FR-1.7)', async () => {
    await createUser(db.prisma, { email: 'ali@example.com' });
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) codes.push((await login('ali@example.com', 'Wrong1234')).body.error.code);
    expect(codes).toEqual(['INVALID_CREDENTIALS', 'INVALID_CREDENTIALS', 'INVALID_CREDENTIALS', 'INVALID_CREDENTIALS', 'ACCOUNT_LOCKED']);

    const locked = await login('ali@example.com'); // the RIGHT password is refused while locked
    expect(locked.status).toBe(423);
    expect(locked.body.error.details.lockedUntil).toBe(new Date(t.clock.now().getTime() + 15 * 60_000).toISOString());

    t.clock.advance(14 * 60_000 + 59_000);
    expect((await login('ali@example.com')).status).toBe(423); // 14:59
    t.clock.advance(2000);
    expect((await login('ali@example.com')).status).toBe(200); // 15:01
  });

  it('counts only CONSECUTIVE failures: a success starts the count again', async () => {
    await createUser(db.prisma, { email: 'ali@example.com' });
    for (let i = 0; i < 4; i++) await login('ali@example.com', 'Wrong1234');
    expect((await login('ali@example.com')).status).toBe(200);
    const next = [];
    for (let i = 0; i < 4; i++) next.push((await login('ali@example.com', 'Wrong1234')).status);
    expect(next).toEqual([401, 401, 401, 401]); // not locked: the earlier four were forgiven
  });

  it('counts parallel wrong passwords atomically', async () => {
    await createUser(db.prisma, { email: 'ali@example.com' });
    const results = await Promise.all(Array.from({ length: 5 }, () => login('ali@example.com', 'Wrong1234')));
    expect(results.filter((r) => r.status === 423)).toHaveLength(1); // exactly the fifth one locks
    expect(results.filter((r) => r.status === 401)).toHaveLength(4);
  });

  it.each<[string, Role, UserStatus, string | undefined, number, string | undefined]>([
    ['verified player', 'PLAYER', 'ACTIVE', undefined, 200, undefined],
    ['manager waiting for approval', 'MANAGER', 'PENDING_APPROVAL', undefined, 200, undefined],
    ['rejected manager (sees the reason later)', 'MANAGER', 'REJECTED', undefined, 200, undefined],
    ['unverified e-mail, right password', 'PLAYER', 'UNVERIFIED', undefined, 403, 'EMAIL_NOT_VERIFIED'],
    ['unverified e-mail, wrong password', 'PLAYER', 'UNVERIFIED', 'Wrong1234', 401, 'INVALID_CREDENTIALS'],
    ['suspended account', 'PLAYER', 'SUSPENDED', undefined, 403, 'ACCOUNT_SUSPENDED'],
    ['Super Admin (second step arrives in T18)', 'ADMIN', 'ACTIVE', undefined, 403, 'FORBIDDEN'],
  ])('%s', async (_label, role, status, password, httpStatus, code) => {
    const user = await createUser(db.prisma, { role, status });
    const res = await login(user.email, password);
    expect(res.status).toBe(httpStatus);
    expect(res.body.error?.code).toBe(code);
  });

  it('refuses a disabled staff member, admits an active one, and gives staff their venue', async () => {
    const w = await createWorld();
    const active = await createUser(db.prisma, { role: 'STAFF' });
    const disabled = await createUser(db.prisma, { role: 'STAFF' });
    await db.prisma.staffProfile.create({ data: { userId: active.id, venueId: w.venueId, invitedById: w.managerId } });
    await db.prisma.staffProfile.create({ data: { userId: disabled.id, venueId: w.venueId, invitedById: w.managerId, disabledAt: t.clock.now() } });

    const ok = await login(active.email);
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ role: 'STAFF', staffVenueId: w.venueId, creditScore: null, profileComplete: null });
    expect((await login(disabled.email)).body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('treats a deleted account and a password-less (invited, not yet accepted) account as wrong credentials', async () => {
    const gone = await createUser(db.prisma);
    await db.prisma.user.update({ where: { id: gone.id }, data: { deletedAt: t.clock.now() } });
    const invited = await createUser(db.prisma, { role: 'STAFF', password: null });
    expect((await login(gone.email)).body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await login(invited.email)).body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('sessions (FR-1.24)', () => {
  const activeSessions = async () => Number((await pool.query(`SELECT count(*) n FROM user_sessions WHERE revoked_at IS NULL`)).rows[0].n);

  it('records the client, the device and the app version', async () => {
    const user = await createUser(db.prisma);
    await browser(app).post('/api/v1/auth/login').set('X-Client', 'android').set('X-App-Version', '1.2.3').set('User-Agent', 'Pixel 8').send({ email: user.email, password: PASSWORD });
    const row = (await pool.query(`SELECT client, device_name, app_version FROM user_sessions`)).rows[0];
    expect(row).toEqual({ client: 'ANDROID', device_name: 'Pixel 8', app_version: '1.2.3' });
  });

  it('allows five devices and signs the least recently used one out when a sixth signs in', async () => {
    const user = await createUser(db.prisma);
    const agents = [];
    for (let i = 0; i < 6; i++) {
      const agent = browser(app);
      expect((await login(user.email, PASSWORD, agent)).status).toBe(200);
      agents.push(agent);
      t.clock.advance(1000); // a distinct "last used" time for each device
      if (i < 5) expect(await activeSessions()).toBe(i + 1);
    }
    expect(await activeSessions()).toBe(5);
    expect((await agents[0]!.get('/api/v1/me')).status).toBe(401); // the oldest was signed out at once
    for (const agent of agents.slice(1)) expect((await agent.get('/api/v1/me')).status).toBe(200);
  });

  it('keeps to the cap when sign-ins happen at the same moment', async () => {
    const user = await createUser(db.prisma);
    const results = await Promise.all(Array.from({ length: 8 }, () => login(user.email)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await activeSessions()).toBe(5);
  });

  it('honours the sessions_per_user setting', async () => {
    t = testDeps({ prisma: db.prisma, settings: staticSettings({ sessions_per_user: 2 }) });
    app = createApp(t.deps);
    const user = await createUser(db.prisma);
    for (let i = 0; i < 4; i++) {
      await login(user.email);
      t.clock.advance(1000);
    }
    expect(await activeSessions()).toBe(2);
  });
});
