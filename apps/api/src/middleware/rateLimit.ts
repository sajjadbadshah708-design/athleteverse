// Rate limits on the endpoints an attacker would hammer (SEC-5). In-memory counters: fine for one instance, but they reset
// when the free Render service restarts or sleeps. Two keys exist because the client IP is only as trustworthy as
// TRUST_PROXY_HOPS (spike S2): the per-e-mail limit cannot be dodged by changing X-Forwarded-For.
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import type { AppDeps } from '../lib/deps';
import { AppError } from '../lib/errors';

export interface LimitConfig {
  windowMs: number;
  limit: number;
}

const MIN = 60_000;

export const RATE_LIMIT_DEFAULTS = {
  register: { windowMs: 60 * MIN, limit: 10 },
  verify: { windowMs: 15 * MIN, limit: 30 },
  resend: { windowMs: 60 * MIN, limit: 10 },
  loginIp: { windowMs: 15 * MIN, limit: 30 },
  loginEmail: { windowMs: 15 * MIN, limit: 10 },
  refresh: { windowMs: 15 * MIN, limit: 120 },
} satisfies Record<string, LimitConfig>;

export type LimitName = keyof typeof RATE_LIMIT_DEFAULTS;
export type RateLimits = Record<LimitName, LimitConfig>;

const KEYED_BY: Record<LimitName, 'ip' | 'email'> = {
  register: 'ip',
  verify: 'ip',
  resend: 'ip',
  loginIp: 'ip',
  loginEmail: 'email',
  refresh: 'ip',
};

function emailOf(req: Request): string {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
}

/** Route middleware factory: `middleware: [limit('loginIp')]`. The limiter is created once per app. */
export function limit(name: LimitName): (deps: AppDeps) => RequestHandler {
  return (deps) => {
    const { windowMs, limit: max } = { ...RATE_LIMIT_DEFAULTS[name], ...deps.rateLimits?.[name] };
    return rateLimit({
      windowMs,
      limit: max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (req) => (KEYED_BY[name] === 'ip' ? ipKeyGenerator(req.ip ?? '') : `email:${emailOf(req)}`),
      handler: (_req, res, next) => {
        const retryAfterSeconds = Number(res.getHeader('Retry-After')) || Math.ceil(windowMs / 1000);
        next(new AppError('RATE_LIMITED', 'Too many attempts. Please wait and try again.', { retryAfterSeconds }));
      },
    });
  };
}
