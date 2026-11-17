import { ApiError, ERROR_MESSAGES, STRINGS } from '@athleteverse/shared';

const formatTime = (iso: string) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** One plain-language sentence, with a next step, for whatever went wrong (USA-3). Never shows codes or technical text. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return STRINGS.network.unreachable; // fetch itself failed: offline, or the server is unreachable
  const details = error.details as { lockedUntil?: unknown; retryAfterSeconds?: unknown } | undefined;
  if (error.code === 'ACCOUNT_LOCKED' && typeof details?.lockedUntil === 'string') return STRINGS.auth.login.lockedUntil(formatTime(details.lockedUntil));
  if (error.code === 'RATE_LIMITED' && typeof details?.retryAfterSeconds === 'number') return STRINGS.auth.login.tryAgainIn(details.retryAfterSeconds);
  return ERROR_MESSAGES[error.code];
}
