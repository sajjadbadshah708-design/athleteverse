// Vercel function entry (decision 2026-11-17, docs/DEPLOY.md): the API runs as a Vercel function in the same project as
// the web app, because Render requires a payment card even for its free plan. Same app, routes and rules as server.ts;
// only the process model differs: Vercel calls handler() per request, so nothing listens on a port and there is no
// shutdown hook. One instance is reused for many requests while it stays warm, so the app is built once per instance.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { createSettings } from './config/settings';
import { createDb } from './db/prisma';
import { systemClock } from './lib/clock';
import { createLogger } from './lib/logger';
import { createMailer } from './lib/mailer/mailer';

let app: Express | undefined;

function build(): Express {
  const env = loadEnv(); // throws with one clear line (no values) when the configuration is incomplete
  const logger = createLogger(env.LOG_LEVEL);
  const db = createDb(env.DATABASE_URL, logger);
  const mailer = createMailer(env, logger);
  const settings = createSettings(db.prisma, systemClock, logger);
  if (env.NODE_ENV === 'production' && env.TRUST_PROXY_HOPS === 0) {
    logger.warn('TRUST_PROXY_HOPS is 0 in production: on Vercel set it to 1 so rate limits see the client address');
  }
  return createApp({ env, prisma: db.prisma, clock: systemClock, logger, mailer, settings });
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  try {
    app ??= build();
  } catch (err) {
    console.error((err as Error).message); // configuration problem: visible in the Vercel logs, never in the response
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'The server is not configured correctly.' } }));
    return;
  }
  app(req, res);
}
