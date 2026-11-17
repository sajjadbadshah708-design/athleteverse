import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../lib/logger';

/** Gives every request an id (header X-Request-Id) and writes one access-log line. Query strings are never logged. */
export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header('x-request-id');
    const id = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = id;
    res.setHeader('X-Request-Id', id);
    const start = performance.now();
    res.on('finish', () => {
      logger.info('request', {
        requestId: id,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Math.round(performance.now() - start),
      });
    });
    next();
  };
}
