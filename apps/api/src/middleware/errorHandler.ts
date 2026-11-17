import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from '../lib/logger';
import { AppError } from '../lib/errors';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
};

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const type = (err as { type?: unknown } | null)?.type; // body-parser errors carry a `type`
  if (type === 'entity.parse.failed') return new AppError('VALIDATION_ERROR', 'Request body is not valid JSON');
  if (type === 'entity.too.large') return new AppError('VALIDATION_ERROR', 'Request body is too large');
  return new AppError('INTERNAL', 'Internal server error');
}

/** Everything that escapes a handler ends here. 5xx details go to the log, never to the client. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const appError = toAppError(err);
    if (appError.status >= 500) {
      logger.error('unhandled error', {
        requestId: res.locals.requestId,
        error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
      });
    }
    res.status(appError.status).json({
      error: {
        code: appError.code,
        message: appError.expose ? appError.message : 'Internal server error',
        ...(appError.expose && appError.details !== undefined ? { details: appError.details } : {}),
      },
    });
  };
}
