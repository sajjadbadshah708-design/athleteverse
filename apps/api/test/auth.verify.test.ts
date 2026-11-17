// FR-1.3: the e-mail code. 10 minutes, 5 attempts (counted atomically), resend after 60 seconds. FR-1.8 and FR-1.24: success signs in.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/prisma';
import { testDeps } from './helpers/app';
import { browser, cookieNamed, createApp, registerViaApi } from './helpers/auth';
import { TEST_DATABASE_URL, pool, resetDb } from './helpers/db';

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.close());

let t: ReturnType<typeof testDeps>;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  await resetDb();
  t = testDeps({ prisma: db.prisma });
  app = createApp(t.deps);
});

const verify = (email: string, code: string, agent = browser(app)) => agent.post('/api/v1/auth/verify-email').send({ email, code });
const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');
const attempts = async () => (await pool.query(`SELECT attempts FROM auth_tokens`)).rows[0].attempts as number;

describe('POST /api/v1/auth/verify-email', () => {
  it('activates the player, signs in with HttpOnly SameSite=Strict cookies and records the session', async () => {
    const { email, code } = await registerViaApi(app, t.mailer);
    const agent = browser(app);
    const res = await verify(email, code, agent);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email, role: 'PLAYER', status: 'ACTIVE', emailVerified: true, creditScore: 100, profileComplete: false });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);

    const access = cookieNamed(res, 'av_access')!;
    const refresh = cookieNamed(res, 'av_refresh')!;
    for (const cookie of [access, refresh]) expect(cookie).toMatch(/HttpOnly/i);
    for (const cookie of [access, refresh]) expect(cookie).toMatch(/SameSite=Strict/i);
    expect(access).toMatch(/Path=\/api\/v1(;|$)/);
    expect(access).toMatch(/Max-Age=900/); // 15 minutes
    expect(refresh).toMatch(/Path=\/api\/v1\/auth(;|$)/); // the refresh token never travels with ordinary requests

    expect((await agent.get('/api/v1/me')).status).toBe(200); // the cookie really works
    const session = (await pool.query(`SELECT client, revoked_at FROM user_sessions`)).rows;
    expect(session).toMatchObject([{ client: 'WEB', revoked_at: null }]);
  });

  it('counts a wrong code and tells how many attempts are left', async () => {
    const { email, code } = await registerViaApi(app, t.mailer);
    const res = await verify(email, wrongCode(code));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'OTP_INVALID', details: { attemptsLeft: 4 } });
    expect((await verify(email, code)).status).toBe(200); // the right code still works afterwards
  });

  it('kills the code after 5 attempts, even for the correct code', async () => {
    const { email, code } = await registerViaApi(app, t.mailer);
    const left: number[] = [];
    for (let i = 0; i < 5; i++) left.push((await verify(email, wrongCode(code))).body.error.details.attemptsLeft);
    expect(left).toEqual([4, 3, 2, 1, 0]);
    const res = await verify(email, code);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('cannot be brute-forced in parallel: at most 5 guesses are ever counted', async () => {
    const { email, code } = await registerViaApi(app, t.mailer);
    const results = await Promise.all(Array.from({ length: 15 }, () => verify(email, wrongCode(code))));
    expect(results.filter((r) => r.body.error.code === 'OTP_INVALID')).toHaveLength(5);
    expect(results.filter((r) => r.body.error.code === 'OTP_EXPIRED')).toHaveLength(10);
    expect(await attempts()).toBe(5);
    expect((await verify(email, code)).body.error.code).toBe('OTP_EXPIRED');
  });

  it('expires after 10 minutes', async () => {
    const { email, code } = await registerViaApi(app, t.mailer);
    t.clock.advance(10 * 60_000 - 1000);
    expect((await verify(email, wrongCode(code))).body.error.code).toBe('OTP_INVALID'); // 9:59, still alive
    t.clock.advance(1000);
    const res = await verify(email, code);
    expect(res.body.error.code).toBe('OTP_EXPIRED'); // exactly 10:00
  });

  it('works once: a used code, or two correct submissions at once, sign in only one', async () => {
    const { email, code } = await registerViaApi(app, t.mailer);
    const both = await Promise.all([verify(email, code), verify(email, code)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 422]);
    expect((await verify(email, code)).body.error.code).toBe('OTP_EXPIRED');
    expect(await pool.query(`SELECT 1 FROM user_sessions`).then((r) => r.rowCount)).toBe(1);
  });

  it('answers an unknown e-mail like an expired code, so it reveals nothing', async () => {
    const res = await verify('nobody@example.com', '123456');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });
});

describe('POST /api/v1/auth/resend-otp', () => {
  const resend = (email: string) => browser(app).post('/api/v1/auth/resend-otp').send({ email });

  it('waits 60 seconds between codes, silently, and the old code stops working', async () => {
    const { email, code: first } = await registerViaApi(app, t.mailer);
    expect((await resend(email)).status).toBe(200);
    expect(t.mailer.sent).toHaveLength(1); // too early: nothing sent

    t.clock.advance(60_000);
    expect((await resend(email)).body).toEqual({ ok: true });
    expect(t.mailer.sent).toHaveLength(2);
    const second = t.mailer.lastCodeFor(email)!;

    expect(first === second ? 'same' : 'different').toBe('different');
    expect((await verify(email, first)).status).toBe(422); // the first code is dead
    expect((await verify(email, second)).status).toBe(200);
  });

  it('gives the same answer for unknown, verified and unverified e-mails, and sends nothing for the first two', async () => {
    const { email, code } = await registerViaApi(app, t.mailer);
    await verify(email, code); // now ACTIVE
    t.mailer.sent.length = 0;
    t.clock.advance(120_000);
    const unknown = await resend('nobody@example.com');
    const verified = await resend(email);
    expect(unknown.status).toBe(200);
    expect(verified.status).toBe(200);
    expect(unknown.body).toEqual(verified.body);
    expect(t.mailer.sent).toHaveLength(0);
  });
});
