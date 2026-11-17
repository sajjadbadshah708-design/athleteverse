// SEC-5: the endpoints an attacker would hammer are rate limited, with the standard error envelope.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/prisma';
import type { RateLimits } from '../src/middleware/rateLimit';
import { HIGH_LIMITS, testDeps } from './helpers/app';
import { browser, createApp, createUser, PASSWORD, REGISTRATION } from './helpers/auth';
import { TEST_DATABASE_URL, resetDb } from './helpers/db';

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.close());
beforeEach(() => resetDb());

const window = 60_000;
const appWith = (limits: Partial<RateLimits>, envVars: Record<string, string> = {}) =>
  createApp(testDeps({ prisma: db.prisma, rateLimits: { ...HIGH_LIMITS, ...limits } }, envVars).deps);
const login = (app: ReturnType<typeof createApp>, email: string, headers: Record<string, string> = {}) =>
  browser(app).post('/api/v1/auth/login').set(headers).send({ email, password: 'Wrong1234' });

describe('rate limits', () => {
  it('limit sign-in attempts per e-mail, with the error envelope and a Retry-After header', async () => {
    const app = appWith({ loginEmail: { windowMs: window, limit: 3 } });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await login(app, 'ali@example.com')).status);
    expect(statuses).toEqual([401, 401, 401, 429]);

    const blocked = await login(app, 'ali@example.com');
    expect(blocked.body.error).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: expect.any(Number) } });
    expect(blocked.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await login(app, 'someone.else@example.com')).status).toBe(401); // other e-mails are unaffected
  });

  it('the per-e-mail limit also covers e-mails that do not exist, and cannot be dodged by changing the IP header', async () => {
    const app = appWith({ loginEmail: { windowMs: window, limit: 2 } }, { TRUST_PROXY_HOPS: '1' });
    const out = [];
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) out.push((await login(app, 'ghost@example.com', { 'X-Forwarded-For': ip })).status);
    expect(out).toEqual([401, 401, 429]);
  });

  it('limit sign-in attempts per IP', async () => {
    const app = appWith({ loginIp: { windowMs: window, limit: 2 } });
    const out = [];
    for (const email of ['a@example.com', 'b@example.com', 'c@example.com']) out.push((await login(app, email)).status);
    expect(out).toEqual([401, 401, 429]);
  });

  it('use the real client IP only when proxies are trusted (spike S2): otherwise X-Forwarded-For is ignored', async () => {
    const attempts = async (hops: string) => {
      const app = appWith({ loginIp: { windowMs: window, limit: 2 } }, { TRUST_PROXY_HOPS: hops });
      const out = [];
      for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) out.push((await login(app, `${ip}@example.com`, { 'X-Forwarded-For': ip })).status);
      return out;
    };
    expect(await attempts('0')).toEqual([401, 401, 429]); // header ignored: one shared bucket, so a spoofed header buys nothing
    expect(await attempts('1')).toEqual([401, 401, 401]); // header trusted: three different clients
  });

  it('limit registrations per IP and code checks per IP', async () => {
    const app = appWith({ register: { windowMs: window, limit: 1 }, verify: { windowMs: window, limit: 1 } });
    const register = (n: number) => browser(app).post('/api/v1/auth/register').send({ ...REGISTRATION, email: `p${n}@example.com`, phone: `92300000000${n}` });
    expect([(await register(1)).status, (await register(2)).status]).toEqual([201, 429]);

    const verify = () => browser(app).post('/api/v1/auth/verify-email').send({ email: 'p1@example.com', code: '000000' });
    expect([(await verify()).status, (await verify()).status]).toEqual([422, 429]);
  });

  it('count each app instance separately and let a signed-in user keep working under the default limits', async () => {
    const user = await createUser(db.prisma);
    const app = createApp(testDeps({ prisma: db.prisma, rateLimits: undefined }).deps); // the real defaults
    for (let i = 0; i < 3; i++) {
      expect((await browser(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(200);
    }
  });
});
