// Error codes returned in the API error envelope { error: { code, message, details? } } (USA-3).
// The HTTP status is part of the contract, so both sides import it from here.

export const ERROR_HTTP_STATUS = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401, // wrong e-mail or password: deliberately the same answer for both
  FORBIDDEN: 403,
  EMAIL_NOT_VERIFIED: 403, // correct password, but the e-mail OTP was never entered (FR-1.3)
  ACCOUNT_SUSPENDED: 403, // suspended or disabled: the UI shows a suspension notice (FR-1.21)
  OTP_INVALID: 422, // wrong code; details.attemptsLeft
  OTP_EXPIRED: 422, // expired, used up (5 attempts) or no code pending: ask for a new one
  NOT_FOUND: 404,
  ACCOUNT_LOCKED: 423,
  RATE_LIMITED: 429,
  PROFILE_INCOMPLETE: 403,
  SLOT_TAKEN: 409, // details: { alternatives }
  TIER_LIMIT: 409, // details: { tier, limit, upcoming }
  BOOKING_OVERLAP: 409, // the player already holds a booking at that time (N3)
  BOOKING_STARTED: 409,
  TOO_EARLY: 409,
  ALREADY_RECORDED: 409,
  PENALTY_CHANGED: 409,
  CREDIT_ALREADY_APPLIED: 409,
  CONFLICT: 409,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;
export const ERROR_CODES = Object.keys(ERROR_HTTP_STATUS) as [ErrorCode, ...ErrorCode[]];

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details?: unknown };
}
