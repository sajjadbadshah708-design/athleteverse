import { createHash, timingSafeEqual } from 'node:crypto';

/** Constant-time comparison of a presented secret with the expected one. Hashing first makes lengths equal. */
export function secretsMatch(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
