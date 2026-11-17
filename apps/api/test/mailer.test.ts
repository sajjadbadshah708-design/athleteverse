import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config/env';
import { createConsoleMailer, createMailer, FakeMailer, sendSafely } from '../src/lib/mailer/mailer';
import { MailError } from '../src/lib/mailer/providers';
import { otpMessage } from '../src/lib/mailer/templates';
import { testDeps } from './helpers/app';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('templates', () => {
  it('put the code, the lifetime and a safety line in plain text', () => {
    const m = otpMessage('ali@example.com', '123456', 10);
    expect(m.to).toBe('ali@example.com');
    expect(m.text).toContain('123456');
    expect(m.text).toContain('10 minutes');
    expect(m.text).not.toMatch(/<[a-z]/i); // no markup
    expect(m.subject).not.toContain('123456'); // the code is not in the subject line (lock screens, notification previews)
  });
});

describe('console mailer (development, tests, explicit demos)', () => {
  it('writes the e-mail to the log instead of sending it', async () => {
    const { deps, logs } = testDeps();
    await createConsoleMailer(deps.logger).send(otpMessage('ali@example.com', '654321', 10));
    expect(logs.find((l) => l.msg === 'e-mail not sent (console mailer)')).toMatchObject({ to: 'ali@example.com' });
  });

  it('warns loudly when chosen in production', () => {
    const { deps, logs } = testDeps();
    const env = loadEnv({ ...base, NODE_ENV: 'production', JOB_SECRET: 'j'.repeat(32), JWT_SECRET: 'j'.repeat(32), OTP_PEPPER: 'o'.repeat(32), MAIL_PROVIDER: 'console', WEB_BASE_URL: 'https://athleteverse.example.com' });
    createMailer(env, deps.logger);
    expect(logs.some((l) => l.level === 'warn' && String(l.msg).includes('MAIL_PROVIDER=console in production'))).toBe(true);
  });
});

describe('provider mailer', () => {
  it('sends through the provider API with the configured key and sender', async () => {
    const { deps } = testDeps();
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response('{"messageId":"m1"}', { status: 201 })));
    try {
      const env = loadEnv({ ...base, MAIL_PROVIDER: 'brevo', MAIL_API_KEY: 'xkeysib-secret', MAIL_FROM: 'AthleteVerse <noreply@example.com>' });
      await createMailer(env, deps.logger).send(otpMessage('ali@example.com', '123456', 10));
      expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
      expect((calls[0]!.init.headers as Record<string, string>)['api-key']).toBe('xkeysib-secret');
      expect(JSON.parse(calls[0]!.init.body as string).sender).toEqual({ name: 'AthleteVerse', email: 'noreply@example.com' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('sendSafely (REL-4)', () => {
  it('returns true on success', async () => {
    const { deps } = testDeps();
    expect(await sendSafely(deps, otpMessage('ali@example.com', '123456', 10))).toBe(true);
    expect((deps.mailer as FakeMailer).sent).toHaveLength(1);
  });

  it('never throws: it logs the provider status and explanation, never the key or the code', async () => {
    const { deps, logs, mailer } = testDeps();
    mailer.failWith = new MailError('brevo rejected the message (HTTP 401)', 'brevo', 401, '{"message":"Key not found"}');
    expect(await sendSafely(deps, otpMessage('ali@example.com', '123456', 10))).toBe(false);
    const log = logs.find((l) => l.msg === 'e-mail could not be sent');
    expect(log).toMatchObject({ error: { provider: 'brevo', status: 401, body: '{"message":"Key not found"}' } });
    expect(JSON.stringify(log)).not.toContain('123456');

    mailer.failWith = new Error('socket hang up');
    expect(await sendSafely(deps, otpMessage('ali@example.com', '123456', 10))).toBe(false);
  });
});
