// Validated environment (SEC-2: secrets only in environment variables). Later tasks add their own keys here
// (WEB_BASE_URL for invitation links). Error messages never echo values.
import { z } from 'zod';
import type { LogLevel } from '../lib/logger';

const timeZone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'must be an IANA time zone such as UTC or Europe/Paris');

// Development and test convenience ONLY. In production the real secrets are required (see superRefine) and these are never used.
const DEV_JWT_SECRET = 'dev-only-jwt-secret-never-use-in-production-0001';
const DEV_OTP_PEPPER = 'dev-only-otp-pepper-never-use-in-production-0001';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// URL'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),
    PLATFORM_TZ: timeZone.default('UTC'), // one platform time zone until OI-1 is answered (N4)
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0), // measured with spike S2 (docs/DEPLOY.md)
    JOB_SECRET: z.string().min(32, 'must be at least 32 characters').optional(), // header X-Job-Secret for POST /api/jobs/tick (SRS 3.4)
    // Minimum minutes between runs of the jobs that query the database (decision Q5, docs/DEPLOY.md). The tick still comes
    // every 10 minutes to keep the API awake; 30 here keeps the free Neon database asleep most of the time. 0 = every tick.
    JOB_DB_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(0),
    ENABLE_SPIKES: z.stringbool().default(false), // temporary diagnostic endpoint (spike S2); keep false otherwise
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters').optional(), // signs 15-minute access tokens (FR-1.8)
    OTP_PEPPER: z.string().min(32, 'must be at least 32 characters').optional(), // keys the HMAC of stored OTP codes
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(10), // tests use 4 for speed
    MAIL_PROVIDER: z.enum(['brevo', 'resend', 'console']).optional(), // "console" prints e-mails to the log: development, or an explicit demo choice
    MAIL_API_KEY: z.string().min(1).optional(),
    MAIL_FROM: z.string().min(3).optional(), // "AthleteVerse <address@your-validated-sender>"
    WEB_BASE_URL: z.string().url().default('http://localhost:5173'),
    RENDER_GIT_COMMIT: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const requireInProduction = (key: 'JOB_SECRET' | 'JWT_SECRET' | 'OTP_PEPPER' | 'MAIL_PROVIDER') => {
      if (env.NODE_ENV === 'production' && !env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production' });
    };
    requireInProduction('JOB_SECRET');
    requireInProduction('JWT_SECRET');
    requireInProduction('OTP_PEPPER');
    requireInProduction('MAIL_PROVIDER');
    // Invitation e-mails link to WEB_BASE_URL (FR-1.6). The development default would send every invited staff member to
    // localhost, so production needs the real public https address of the web app.
    if (env.NODE_ENV === 'production' && (!env.WEB_BASE_URL.startsWith('https://') || /^https:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(env.WEB_BASE_URL))) {
      ctx.addIssue({ code: 'custom', path: ['WEB_BASE_URL'], message: 'must be the public https address of the web app in production' });
    }
    if (env.MAIL_PROVIDER === 'brevo' || env.MAIL_PROVIDER === 'resend') {
      if (!env.MAIL_API_KEY) ctx.addIssue({ code: 'custom', path: ['MAIL_API_KEY'], message: `is required for MAIL_PROVIDER=${env.MAIL_PROVIDER}` });
      if (!env.MAIL_FROM) ctx.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: `is required for MAIL_PROVIDER=${env.MAIL_PROVIDER}` });
    }
  });

export interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  LOG_LEVEL: LogLevel;
  PLATFORM_TZ: string;
  TRUST_PROXY_HOPS: number;
  JOB_SECRET: string | undefined;
  JOB_DB_INTERVAL_MINUTES: number;
  ENABLE_SPIKES: boolean;
  JWT_SECRET: string;
  OTP_PEPPER: string;
  BCRYPT_COST: number;
  MAIL_PROVIDER: 'brevo' | 'resend' | 'console';
  MAIL_API_KEY: string | undefined;
  MAIL_FROM: string | undefined;
  APP_VERSION: string;
  WEB_BASE_URL: string;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // An empty string means "not set" (a blank line in .env must not count as a value).
  const present = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  const e = parsed.data;
  return {
    NODE_ENV: e.NODE_ENV,
    PORT: e.PORT,
    DATABASE_URL: e.DATABASE_URL,
    LOG_LEVEL: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    PLATFORM_TZ: e.PLATFORM_TZ,
    TRUST_PROXY_HOPS: e.TRUST_PROXY_HOPS,
    JOB_SECRET: e.JOB_SECRET,
    JOB_DB_INTERVAL_MINUTES: e.JOB_DB_INTERVAL_MINUTES,
    ENABLE_SPIKES: e.ENABLE_SPIKES,
    JWT_SECRET: e.JWT_SECRET ?? DEV_JWT_SECRET,
    OTP_PEPPER: e.OTP_PEPPER ?? DEV_OTP_PEPPER,
    BCRYPT_COST: e.BCRYPT_COST,
    MAIL_PROVIDER: e.MAIL_PROVIDER ?? 'console',
    MAIL_API_KEY: e.MAIL_API_KEY,
    MAIL_FROM: e.MAIL_FROM,
    WEB_BASE_URL: e.WEB_BASE_URL,
    APP_VERSION: e.RENDER_GIT_COMMIT ? e.RENDER_GIT_COMMIT.slice(0, 7) : 'dev',
  };
}
