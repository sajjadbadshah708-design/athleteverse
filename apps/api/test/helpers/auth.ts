import type { PrismaClient, Role, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app';
import type { FakeMailer } from '../../src/lib/mailer/mailer';

let seq = 0;

export const PASSWORD = 'Passw0rdOK';

export const REGISTRATION = {
  fullName: 'Test Player',
  email: 'player@example.com',
  phone: '923001234567',
  password: PASSWORD,
  acceptTerms: true,
  confirmAge16: true,
};

/** A supertest agent that keeps cookies, like a browser, and names itself as the web client. */
export const browser = (app: Express) => request.agent(app).set('X-Client', 'web');

/** Inserts a user that can sign in with PASSWORD (bcrypt cost 4). */
export async function createUser(
  prisma: PrismaClient,
  opts: { role?: Role; status?: UserStatus; email?: string; phone?: string; password?: string | null } = {},
) {
  const n = ++seq;
  const email = opts.email ?? `user${n}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      phone: opts.phone ?? `9210${String(n).padStart(8, '0')}`,
      role: opts.role ?? 'PLAYER',
      status: opts.status ?? 'ACTIVE',
      fullName: `User ${n}`,
      passwordHash: opts.password === null ? null : await bcrypt.hash(opts.password ?? PASSWORD, 4),
      emailVerified: opts.status !== 'UNVERIFIED',
    },
  });
  return { ...user, password: opts.password ?? PASSWORD };
}

/** Registers through the API and returns the code from the e-mail the fake mailer captured. */
export async function registerViaApi(app: Express, mailer: FakeMailer, overrides: Partial<typeof REGISTRATION> = {}) {
  const body = { ...REGISTRATION, ...overrides };
  const res = await request(app).post('/api/v1/auth/register').set('X-Client', 'web').send(body);
  const email = body.email.trim().toLowerCase(); // the API normalises it, so the e-mail goes to this address
  return { res, email, code: mailer.lastCodeFor(email) ?? '' };
}

/** All Set-Cookie headers of a response as one string per cookie. */
export const setCookies = (res: { headers: Record<string, unknown> }): string[] => (res.headers['set-cookie'] as string[] | undefined) ?? [];

export const cookieNamed = (res: { headers: Record<string, unknown> }, name: string) => setCookies(res).find((c) => c.startsWith(`${name}=`));

export const cookieValue = (res: { headers: Record<string, unknown> }, name: string) => cookieNamed(res, name)?.split(';')[0]?.slice(name.length + 1);

export { createApp };
