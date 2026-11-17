import type { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env';
import type { Settings } from '../config/settings';
import type { Clock } from './clock';
import type { Logger } from './logger';
import type { Mailer } from './mailer/mailer';
import type { RateLimits } from '../middleware/rateLimit';

/** Everything a route handler may depend on. Tests build their own (fake clock, capture logger). */
export interface AppDeps {
  env: Env;
  prisma: PrismaClient;
  clock: Clock;
  logger: Logger;
  mailer: Mailer;
  settings: Settings;
  rateLimits?: Partial<RateLimits>; // tests lower or raise the defaults
}
