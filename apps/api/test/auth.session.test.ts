// FR-1.8 (access 15 min, refresh 7 days, logout), FR-1.11 (status checked on every request), SEC-1, SEC-3.
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/prisma';
import { testDeps } from './helpers/app';
import { browser, cookieNamed, cookieValue, createApp, createUser, PASSWORD } from './helpers/auth';
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

async function signedIn(opts: Parameters<typeof createUser>[1] = {}) {
  const user = await createUser(db.prisma, opts);
  const agent = browser(app);
  const res = await agent.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
  return { user, agent, res, access: cookieValue(res, 'av_access')!, refresh: cookieValue(res, 'av_refresh')! };
}
const MS = { minute: 60_000, day: 24 * 60 * 60_000 };

describe('GET /api/v1/me', () => {
  it('needs a session, and returns only the user\'s own data', async () => {
    const anonymous = await request(app).get('/api/v1/me');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');

    const { agent, user } = await signedIn();
    const me = await agent.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(Object.keys(me.body.user).sort()).toEqual(['creditScore', 'email', 'emailVerified', 'fullName', 'id', 'phone', 'profileComplete', 'role', 'staffVenueId', 'status']);
    expect(me.body.user.id).toBe(user.id);
  });

  it('also serves a manager who is still waiting for approval', async () => {
    const { agent } = await signedIn({ role: 'MANAGER', status: 'PENDING_APPROVAL' });
    const me = await agent.get('/api/v1/me');
    expect(me.body.user.status).toBe('PENDING_APPROVAL');
  });

  it('accepts a Bearer access token (the mobile app, Sprint 3b)', async () => {
    const { access } = await signedIn();
    const res = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${access}`);
    expect(res.status).toBe(200);
  });
});

describe('access token: 15 minutes, then refresh (FR-1.8)', () => {
  it('expires after 15 minutes and a refresh brings a new one', async () => {
    const { agent } = await signedIn();
    t.clock.advance(15 * MS.minute - 1000);
    expect((await agent.get('/api/v1/me')).status).toBe(200); // 14:59
    t.clock.advance(2000);
    expect((await agent.get('/api/v1/me')).status).toBe(401); // 15:01

    const refreshed = await agent.post('/api/v1/auth/refresh');
    expect(refreshed.status).toBe(200);
    expect(cookieNamed(refreshed, 'av_access')).toBeDefined();
    expect(cookieNamed(refreshed, 'av_refresh')).toBeUndefined(); // the refresh token is not rotated on the web (D6)
    expect((await agent.get('/api/v1/me')).status).toBe(200);
  });

  it('refuses a refresh without a cookie, with a made-up token, after 7 days, and after logout', async () => {
    expect((await request(app).post('/api/v1/auth/refresh').set('X-Client', 'web')).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').set('X-Client', 'web').set('Cookie', 'av_refresh=made-up')).status).toBe(401);

    const { agent } = await signedIn();
    t.clock.advance(7 * MS.day - 1000);
    expect((await agent.post('/api/v1/auth/refresh')).status).toBe(200);
    t.clock.advance(2000);
    expect((await agent.post('/api/v1/auth/refresh')).status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('signs out immediately: the old access token and the refresh token both stop working', async () => {
    const { agent, access, refresh } = await signedIn();
    const res = await agent.post('/api/v1/auth/logout');
    expect(res.body).toEqual({ ok: true });
    expect(cookieNamed(res, 'av_access')).toMatch(/Expires=Thu, 01 Jan 1970/); // cleared

    const replay = (path: string, method: 'get' | 'post', cookie: string) => request(app)[method](path).set('X-Client', 'web').set('Cookie', cookie);
    expect((await replay('/api/v1/me', 'get', `av_access=${access}`)).status).toBe(401); // still within 15 minutes, yet refused
    expect((await replay('/api/v1/auth/refresh', 'post', `av_refresh=${refresh}`)).status).toBe(401);
    expect((await pool.query(`SELECT revoked_at FROM user_sessions`)).rows[0].revoked_at).not.toBeNull();
  });

  it('works with an expired access token (the refresh cookie identifies the session) and twice in a row', async () => {
    const { agent, refresh } = await signedIn();
    t.clock.advance(20 * MS.minute);
    expect((await agent.post('/api/v1/auth/logout')).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/refresh').set('X-Client', 'web').set('Cookie', `av_refresh=${refresh}`)).status).toBe(401);
    expect((await agent.post('/api/v1/auth/logout')).status).toBe(200); // idempotent
  });

  it('only ends its own session', async () => {
    const first = await signedIn();
    const other = browser(app);
    await other.post('/api/v1/auth/login').send({ email: first.user.email, password: PASSWORD });
    await first.agent.post('/api/v1/auth/logout');
    expect((await other.get('/api/v1/me')).status).toBe(200);
  });
});

describe('the account is checked on every request (FR-1.11, FR-1.21)', () => {
  it('a suspension takes effect at once, and a refresh then ends the session for good', async () => {
    const { agent, user } = await signedIn();
    await db.prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    const me = await agent.get('/api/v1/me');
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect((await agent.post('/api/v1/auth/refresh')).body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect((await pool.query(`SELECT revoked_at FROM user_sessions`)).rows[0].revoked_at).not.toBeNull();
  });

  it('disabling a staff member takes effect at once', async () => {
    const w = await createWorld();
    const user = await createUser(db.prisma, { role: 'STAFF' });
    await db.prisma.staffProfile.create({ data: { userId: user.id, venueId: w.venueId, invitedById: w.managerId } }); // assigned BEFORE signing in
    const agent = browser(app);
    await agent.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
    expect((await agent.get('/api/v1/me')).status).toBe(200);
    await db.prisma.staffProfile.update({ where: { userId: user.id }, data: { disabledAt: t.clock.now() } });
    expect((await agent.get('/api/v1/me')).body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('a deleted account is signed out', async () => {
    const { agent, user } = await signedIn();
    await db.prisma.user.update({ where: { id: user.id }, data: { deletedAt: t.clock.now() } });
    expect((await agent.get('/api/v1/me')).status).toBe(401);
  });
});

describe('forged and foreign tokens are refused (SEC-3)', () => {
  const secret = (s: string) => new TextEncoder().encode(s);
  const claims = { sid: '00000000-0000-4000-8000-000000000000' };

  async function forged(overrides: { key?: string; aud?: string; iss?: string; sid?: unknown; sub?: string }, userId: string, sessionId: string) {
    const iat = Math.floor(t.clock.now().getTime() / 1000);
    return new SignJWT({ sid: overrides.sid === undefined ? sessionId : overrides.sid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(overrides.sub ?? userId)
      .setIssuer(overrides.iss ?? 'athleteverse')
      .setAudience(overrides.aud ?? 'athleteverse-api')
      .setIssuedAt(iat)
      .setExpirationTime(iat + 900)
      .sign(secret(overrides.key ?? t.deps.env.JWT_SECRET));
  }
  const me = (token: string) => request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);

  it('accepts only a token signed with our secret for our audience, bound to a real session of that user', async () => {
    const { user } = await signedIn();
    const sessionId = (await pool.query(`SELECT id FROM user_sessions`)).rows[0].id as string;

    expect((await me(await forged({}, user.id, sessionId))).status).toBe(200); // the control: a correctly forged token IS valid
    for (const bad of [{ key: 'x'.repeat(40) }, { aud: 'someone-else' }, { iss: 'someone-else' }, { sid: undefined, sub: undefined }, { sid: 42 }]) {
      const token = bad.sid === undefined && 'sub' in bad ? 'not.a.jwt' : await forged(bad, user.id, sessionId);
      expect((await me(token)).status, JSON.stringify(bad)).toBe(401);
    }
    const otherUser = await createUser(db.prisma);
    expect((await me(await forged({ sub: otherUser.id }, otherUser.id, sessionId))).status).toBe(401); // right session id, wrong user
    expect((await me(await forged({}, user.id, claims.sid))).status).toBe(401); // a session that does not exist
  });

  it('refuses an unsigned token (alg "none") and a token that has been tampered with', async () => {
    const { user, access } = await signedIn();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const payload = JSON.parse(Buffer.from(access.split('.')[1]!, 'base64url').toString());
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...payload, sub: user.id })}.`;
    expect((await me(none)).status).toBe(401);

    const [h, , s] = access.split('.');
    const tampered = `${h}.${b64({ ...payload, sub: '11111111-1111-4111-8111-111111111111' })}.${s}`;
    expect((await me(tampered)).status).toBe(401);
  });
});

describe('cookies in production (SEC-1)', () => {
  it('are Secure over HTTPS', async () => {
    const prod = testDeps({ prisma: db.prisma }, { NODE_ENV: 'production', JWT_SECRET: 'j'.repeat(40), OTP_PEPPER: 'o'.repeat(40), MAIL_PROVIDER: 'console' });
    const user = await createUser(db.prisma);
    const res = await browser(createApp(prod.deps)).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(cookieNamed(res, 'av_access')).toMatch(/; Secure/i);
    expect(cookieNamed(res, 'av_refresh')).toMatch(/; Secure/i);
  });
});
