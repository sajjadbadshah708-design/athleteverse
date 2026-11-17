import { config } from 'dotenv';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { createDb } from './db/prisma';
import { systemClock } from './lib/clock';
import { createLogger } from './lib/logger';
import { createMailer } from './lib/mailer/mailer';
import { createSettings } from './config/settings';

config({ quiet: true });

let env;
try {
  env = loadEnv();
} catch (e) {
  console.error((e as Error).message); // one clear line instead of a stack trace
  process.exit(1);
}
const logger = createLogger(env.LOG_LEVEL);
const db = createDb(env.DATABASE_URL, logger);
const mailer = createMailer(env, logger);
const settings = createSettings(db.prisma, systemClock, logger);
if (env.NODE_ENV === 'production' && env.TRUST_PROXY_HOPS === 0) {
  // Behind Vercel and Render every client then looks like the same IP, so the per-IP rate limits become one shared bucket.
  logger.warn('TRUST_PROXY_HOPS is 0 in production: set it from spike S2 before real users arrive (docs/DEPLOY.md)');
}
const app = createApp({ env, prisma: db.prisma, clock: systemClock, logger, mailer, settings });

const server = app.listen(env.PORT, () => {
  logger.info('api listening', { port: env.PORT, version: env.APP_VERSION, timeZone: env.PLATFORM_TZ });
});

// Render sends SIGTERM on deploy: stop accepting requests, finish in-flight ones, close the pool.
function shutdown(signal: string): void {
  logger.info('shutting down', { signal });
  server.close(() => {
    void db.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
