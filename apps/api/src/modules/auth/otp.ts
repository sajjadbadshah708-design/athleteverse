// E-mail one-time codes (SRS FR-1.3): 6 digits, valid 10 minutes, 5 attempts, a new code at most every 60 seconds.
// Only an HMAC of the code is stored (keyed with OTP_PEPPER and bound to the user and purpose), never the code itself.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_AFTER_MS = 60_000;

export const generateOtp = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

export function hashOtp(pepper: string, userId: string, purpose: string, code: string): string {
  return createHmac('sha256', pepper).update(`${userId}:${purpose}:${code}`).digest('hex');
}

export function otpMatches(storedHash: string, pepper: string, userId: string, purpose: string, code: string): boolean {
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashOtp(pepper, userId, purpose, code), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
