import { describe, expect, it } from 'vitest';
import { MailError, parseFrom, sendEmail } from '../src/lib/mailer/providers';

const msg = { to: 'player@example.com', subject: 'Your code', text: 'Your code is 123456' };

function fakeFetch(status: number, body: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('parseFrom', () => {
  it('splits display name and address', () => {
    expect(parseFrom('AthleteVerse <noreply@example.com>')).toEqual({ name: 'AthleteVerse', email: 'noreply@example.com' });
    expect(parseFrom('"Athlete, Verse" <noreply@example.com>')).toEqual({ name: 'Athlete, Verse', email: 'noreply@example.com' });
    expect(parseFrom('<noreply@example.com>')).toEqual({ email: 'noreply@example.com' });
    expect(parseFrom(' noreply@example.com ')).toEqual({ email: 'noreply@example.com' });
  });
});

describe('sendEmail', () => {
  it('builds a Brevo request and returns the message id', async () => {
    const { calls, fetchImpl } = fakeFetch(201, '{"messageId":"<abc@brevo>"}');
    const out = await sendEmail({ provider: 'brevo', apiKey: 'xkeysib-secret', from: 'AthleteVerse <noreply@example.com>', fetchImpl }, msg);
    expect(out).toEqual({ id: '<abc@brevo>' });
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('xkeysib-secret');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      sender: { name: 'AthleteVerse', email: 'noreply@example.com' },
      to: [{ email: 'player@example.com' }],
      subject: 'Your code',
      textContent: 'Your code is 123456',
    });
  });

  it('builds a Resend request and returns the id', async () => {
    const { calls, fetchImpl } = fakeFetch(200, '{"id":"re_123"}');
    const out = await sendEmail({ provider: 'resend', apiKey: 're_secret', from: 'AthleteVerse <noreply@example.com>', fetchImpl }, msg);
    expect(out).toEqual({ id: 're_123' });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer re_secret');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      from: 'AthleteVerse <noreply@example.com>',
      to: ['player@example.com'],
      subject: 'Your code',
      text: 'Your code is 123456',
    });
  });

  it('throws MailError with the status and provider explanation, never with the API key', async () => {
    const body = '{"name":"validation_error","message":"You can only send testing emails to your own email address"}';
    const { fetchImpl } = fakeFetch(403, body);
    const err = (await sendEmail({ provider: 'resend', apiKey: 're_topsecret', from: 'a@b.co', fetchImpl }, msg).catch((e: unknown) => e)) as MailError;
    expect(err).toBeInstanceOf(MailError);
    expect(err).toMatchObject({ provider: 'resend', status: 403 });
    expect(err.body).toContain('only send testing emails');
    expect(err.message).not.toContain('topsecret');
    expect(err.body).not.toContain('topsecret');
  });

  it('succeeds with an empty result when the provider answers 2xx without JSON', async () => {
    const { fetchImpl } = fakeFetch(202, '');
    expect(await sendEmail({ provider: 'brevo', apiKey: 'k', from: 'a@b.co', fetchImpl }, msg)).toEqual({});
  });

  it('honours a base URL override (used only by tests and the spike script)', async () => {
    const { calls, fetchImpl } = fakeFetch(200, '{}');
    await sendEmail({ provider: 'resend', apiKey: 'k', from: 'a@b.co', fetchImpl, baseUrl: 'http://localhost:9999' }, msg);
    expect(calls[0]!.url).toBe('http://localhost:9999/emails');
  });
});
