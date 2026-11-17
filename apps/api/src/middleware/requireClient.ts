// SEC-1 (defence in depth next to SameSite=Strict cookies): every state-changing request must name its client in the
// X-Client header. A browser form or cross-site fetch cannot add a custom header without a CORS pre-flight, and no CORS is enabled.
import type { Client } from '@athleteverse/shared';
import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/errors';

const CLIENTS: Record<string, Client> = { web: 'WEB', android: 'ANDROID', ios: 'IOS' };
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function clientFromRequest(req: Request): Client | undefined {
  return CLIENTS[(req.header('x-client') ?? '').toLowerCase()];
}

export const requireClientHeader: RequestHandler = (req, _res, next) => {
  if (!SAFE_METHODS.has(req.method) && !clientFromRequest(req)) {
    next(new AppError('FORBIDDEN', 'Missing or invalid X-Client header'));
    return;
  }
  next();
};
