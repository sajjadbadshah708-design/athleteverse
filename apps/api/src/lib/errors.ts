// One error type for everything the API deliberately rejects. The envelope is { error: { code, message, details? } } (USA-3).
import { ERROR_HTTP_STATUS, type ErrorCode } from '@athleteverse/shared';

export interface FieldIssue {
  in: 'body' | 'query' | 'params';
  path: string; // e.g. "email" or "slots", so the UI can show the message next to the field
  message: string;
}

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_HTTP_STATUS[code];
  }

  /** 5xx messages are never sent to clients. */
  get expose(): boolean {
    return this.status < 500;
  }
}

export const validationError = (issues: FieldIssue[]) => new AppError('VALIDATION_ERROR', 'Some fields are invalid', { issues });
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have access to this resource') => new AppError('FORBIDDEN', message);
