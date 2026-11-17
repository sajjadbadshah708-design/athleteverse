// FR-1.1, FR-1.2, FR-1.4, FR-5.15, REL-4: registration creates an UNVERIFIED player and e-mails a code after the commit.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/prisma';
import { hashOtp } from '../src/modules/auth/otp';
import { testDeps } from './helpers/app';
import { browser, createApp, REGISTRATION, registerViaApi, setCookies } from './helpers/auth';
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

describe('POST /api/v1/auth/register', () => {
  it('creates an unverified player and e-mails a six-digit code', async () => {
    const { res, code } = await registerViaApi(app, t.mailer, { email: 'Player@Example.com', phone: '+92 300 123 4567' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: 'VERIFICATION_REQUIRED', email: 'player@example.com' }); // normalised
    expect(setCookies(res)).toEqual([]); // not signed in until the code is entered

    const { rows } = await pool.query(`SELECT * FROM users`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'player@example.com', phone: '923001234567', role: 'PLAYER', status: 'UNVERIFIED', credit_score: 100 });
    expect(rows[0].terms_accepted_at.toISOString()).toBe(t.clock.now().toISOString());

    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sent[0]!.to).toBe('player@example.com');
    expect(code).toMatch(/^\d{6}$/);
  });

  it('never stores the password or the code in readable form (FR-1.4, SEC-2)', async () => {
    const { code } = await registerViaApi(app, t.mailer);
    const user = (await pool.query(`SELECT id, password_hash FROM users`)).rows[0];
    expect(user.password_hash).toMatch(/^\$2[aby]\$04\$/); // bcrypt
    expect(user.password_hash).not.toContain(REGISTRATION.password);

    const token = (await pool.query(`SELECT token_hash, purpose, attempts, expires_at FROM auth_tokens`)).rows[0];
    expect(token.token_hash).toBe(hashOtp(t.deps.env.OTP_PEPPER, user.id, 'EMAIL_VERIFY', code));
    expect(token.token_hash).not.toContain(code);
    expect(token).toMatchObject({ purpose: 'EMAIL_VERIFY', attempts: 0 });
    expect(token.expires_at.getTime() - t.clock.now().getTime()).toBe(10 * 60_000); // valid 10 minutes
  });

  it('reports every invalid field at once, next to the field (USA-3)', async () => {
    const res = await browser(app).post('/api/v1/auth/register').send({
      fullName: 'R2-D2',
      email: 'not-an-email',
      phone: '12345',
      password: 'short',
      acceptTerms: false,
      confirmAge16: false,
    });
    expect(res.status).toBe(422);
    const paths = (res.body.error.details.issues as { path: string }[]).map((i) => i.path);
    expect(new Set(paths)).toEqual(new Set(['fullName', 'email', 'phone', 'password', 'acceptTerms', 'confirmAge16']));
    expect(await pool.query(`SELECT 1 FROM users`).then((r) => r.rowCount)).toBe(0);
  });

  it('rejects an e-mail or phone already used by any account, whatever the letter case (FR-1.2)', async () => {
    await registerViaApi(app, t.mailer);
    const sameEmail = await browser(app).post('/api/v1/auth/register').send({ ...REGISTRATION, email: 'PLAYER@example.com', phone: '923009999999' });
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.error).toMatchObject({ code: 'CONFLICT', details: { issues: [{ path: 'email' }] } });

    const samePhone = await browser(app).post('/api/v1/auth/register').send({ ...REGISTRATION, email: 'other@example.com' });
    expect(samePhone.body.error.details.issues).toMatchObject([{ path: 'phone' }]);

    const both = await browser(app).post('/api/v1/auth/register').send(REGISTRATION);
    expect((both.body.error.details.issues as { path: string }[]).map((i) => i.path).sort()).toEqual(['email', 'phone']);
    expect(await pool.query(`SELECT 1 FROM users`).then((r) => r.rowCount)).toBe(1);
  });

  it('lets exactly one of two simultaneous registrations win; the database constraint decides', async () => {
    const attempt = () => browser(app).post('/api/v1/auth/register').send(REGISTRATION);
    const results = await Promise.all([attempt(), attempt(), attempt()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await pool.query(`SELECT 1 FROM users`).then((r) => r.rowCount)).toBe(1);
  });

  it('still succeeds when the e-mail provider fails, and says so in the log (REL-4)', async () => {
    t.mailer.failWith = new Error('provider is down');
    const res = await browser(app).post('/api/v1/auth/register').send(REGISTRATION);
    expect(res.status).toBe(201);
    expect(t.logs.some((l) => l.msg === 'e-mail could not be sent')).toBe(true);
    expect(await pool.query(`SELECT 1 FROM users`).then((r) => r.rowCount)).toBe(1); // the account exists; "resend" can recover
  });

  it('keeps the code and the password out of the application log (the e-mail itself is the only place the code appears)', async () => {
    await registerViaApi(app, t.mailer);
    const logged = JSON.stringify(t.logs);
    expect(logged).not.toContain(t.mailer.lastCodeFor(REGISTRATION.email)!);
    expect(logged).not.toContain(REGISTRATION.password);
  });
});
