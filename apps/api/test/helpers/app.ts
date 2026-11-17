import type { PrismaClient } from '@prisma/client';
import { loadEnv } from '../../src/config/env';
import { FakeClock } from '../../src/lib/clock';
import type { AppDeps } from '../../src/lib/deps';
import { createLogger } from '../../src/lib/logger';
import { FakeMailer } from '../../src/lib/mailer/mailer';
import { staticSettings } from '../../src/config/settings';
import { RATE_LIMIT_DEFAULTS, type RateLimits } from '../../src/middleware/rateLimit';
import { TEST_DATABASE_URL } from './db';

export type LogLine = Record<string, unknown>;

/** A database stand-in that only answers `SELECT 1` (or fails), for tests that must not need PostgreSQL. */
export const fakePrisma = (up: boolean) =>
  ({
    $queryRaw: async () => {
      if (!up) throw new Error('database is down');
      return [{ ok: 1 }];
    },
  }) as unknown as PrismaClient;

/** Limits so high that ordinary tests never meet them; rate-limit tests pass their own. */
export const HIGH_LIMITS = Object.fromEntries(
  Object.keys(RATE_LIMIT_DEFAULTS).map((name) => [name, { windowMs: 60_000, limit: 1_000_000 }]),
) as RateLimits;

export const TEST_JOB_SECRET = 'test-job-secret-0123456789abcdef0123';

/** Dependencies with a fake clock and a capturing logger. `envVars` are extra environment variables for loadEnv. */
export function testDeps(overrides: Partial<AppDeps> = {}, envVars: Record<string, string> = {}) {
  const logs: LogLine[] = [];
  const clock = new FakeClock();
  const logger = createLogger('debug', { clock, write: (line) => logs.push(JSON.parse(line) as LogLine) });
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL || 'postgresql://unused/unused',
    JOB_SECRET: TEST_JOB_SECRET,
    BCRYPT_COST: '4', // bcrypt at cost 4 keeps the suite fast; production uses 10
    ...envVars,
  });
  const mailer = new FakeMailer();
  const deps: AppDeps = { env, prisma: fakePrisma(true), clock, logger, mailer, settings: staticSettings(), rateLimits: HIGH_LIMITS, ...overrides };
  return { deps, logs, clock, mailer };
}
