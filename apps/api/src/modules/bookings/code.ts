import { randomInt } from 'node:crypto';

// The 8-character booking code staff type or read out at the front desk (FR-2.8). No 0/O, 1/I/L: they are easy to confuse on a
// phone screen and when spoken. 31 characters give about 8.5e11 codes; the database also keeps them unique.
export const BOOKING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const BOOKING_CODE_LENGTH = 8;

export function generateBookingCode(): string {
  let code = '';
  for (let i = 0; i < BOOKING_CODE_LENGTH; i++) code += BOOKING_CODE_ALPHABET[randomInt(BOOKING_CODE_ALPHABET.length)];
  return code;
}
