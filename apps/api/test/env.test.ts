import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };
const SECRET = 'x'.repeat(32);
const PRODUCTION = { NODE_ENV: 'production', JOB_SECRET: SECRET, JWT_SECRET: SECRET, OTP_PEPPER: SECRET, MAIL_PROVIDER: 'console' };

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv(base)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: base.DATABASE_URL,
      LOG_LEVEL: 'info',
      PLATFORM_TZ: 'UTC',
      TRUST_PROXY_HOPS: 0,
      JOB_SECRET: undefined,
      ENABLE_SPIKES: false,
      JWT_SECRET: expect.stringContaining('dev-only'),
      OTP_PEPPER: expect.stringContaining('dev-only'),
      BCRYPT_COST: 10,
      MAIL_PROVIDER: 'console',
      MAIL_API_KEY: undefined,
      MAIL_FROM: undefined,
      WEB_BASE_URL: 'http://localhost:5173',
      APP_VERSION: 'dev',
    });
  });

  it('is silent by default in tests and uses the short git commit as the version', () => {
    expect(loadEnv({ ...base, NODE_ENV: 'test' }).LOG_LEVEL).toBe('silent');
    expect(loadEnv({ ...base, RENDER_GIT_COMMIT: 'abcdef1234567890' }).APP_VERSION).toBe('abcdef1');
  });

  it('treats empty strings as not set', () => {
    const env = loadEnv({ ...base, PORT: '', PLATFORM_TZ: '', LOG_LEVEL: '' });
    expect(env.PORT).toBe(3000);
    expect(env.PLATFORM_TZ).toBe('UTC');
  });

  it('coerces numbers and accepts a real IANA time zone', () => {
    const env = loadEnv({ ...base, PORT: '8080', PLATFORM_TZ: 'Europe/Paris', TRUST_PROXY_HOPS: '2' });
    expect(env).toMatchObject({ PORT: 8080, PLATFORM_TZ: 'Europe/Paris', TRUST_PROXY_HOPS: 2 });
  });

  it('rejects bad values and names the variable', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...base, PORT: '99999' })).toThrow(/PORT/);
    expect(() => loadEnv({ ...base, PLATFORM_TZ: 'Mars/Olympus' })).toThrow(/PLATFORM_TZ/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('requires a long JOB_SECRET in production (SRS 3.4: the tick endpoint is secret-protected)', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/JOB_SECRET.*required in production/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', JOB_SECRET: 'too-short' })).toThrow(/JOB_SECRET/);
    const secret = 'x'.repeat(32);
    expect(loadEnv({ ...base, ...PRODUCTION, JOB_SECRET: secret }).JOB_SECRET).toBe(secret);
    expect(loadEnv(base).JOB_SECRET).toBeUndefined(); // optional in development and tests
  });

  it('parses ENABLE_SPIKES as a boolean, off by default', () => {
    expect(loadEnv(base).ENABLE_SPIKES).toBe(false);
    expect(loadEnv({ ...base, ENABLE_SPIKES: 'true' }).ENABLE_SPIKES).toBe(true);
    expect(loadEnv({ ...base, ENABLE_SPIKES: 'false' }).ENABLE_SPIKES).toBe(false);
    expect(() => loadEnv({ ...base, ENABLE_SPIKES: 'perhaps' })).toThrow(/ENABLE_SPIKES/);
  });

  it('requires every secret and a mail provider in production (SEC-2, FR-1.8, FR-1.3)', () => {
    for (const missing of ['JOB_SECRET', 'JWT_SECRET', 'OTP_PEPPER', 'MAIL_PROVIDER'] as const) {
      const env: Record<string, string | undefined> = { ...base, ...PRODUCTION, [missing]: undefined };
      expect(() => loadEnv(env), missing).toThrow(new RegExp(`${missing}: is required in production`));
    }
    expect(loadEnv({ ...base, ...PRODUCTION }).NODE_ENV).toBe('production');
  });

  it('a real mail provider also needs its key and sender address', () => {
    expect(() => loadEnv({ ...base, MAIL_PROVIDER: 'brevo' })).toThrow(/MAIL_API_KEY/);
    expect(() => loadEnv({ ...base, MAIL_PROVIDER: 'brevo', MAIL_API_KEY: 'k' })).toThrow(/MAIL_FROM/);
    expect(loadEnv({ ...base, MAIL_PROVIDER: 'brevo', MAIL_API_KEY: 'k', MAIL_FROM: 'AthleteVerse <a@b.co>' }).MAIL_PROVIDER).toBe('brevo');
  });

  it('never uses the development secrets when real ones are given', () => {
    const env = loadEnv({ ...base, JWT_SECRET: 'j'.repeat(40), OTP_PEPPER: 'o'.repeat(40) });
    expect(env.JWT_SECRET).toBe('j'.repeat(40));
    expect(env.OTP_PEPPER).toBe('o'.repeat(40));
    expect(() => loadEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('never echoes values in the error (they may be secrets)', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://user:topsecret@host/db' })).not.toThrow(/topsecret/);
  });
});
