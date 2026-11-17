// Passwords are stored as bcrypt hashes only (FR-1.4, SEC-2). bcryptjs is the same algorithm as native bcrypt, without a build step.
import bcrypt from 'bcryptjs';

export const hashPassword = (password: string, cost: number): Promise<string> => bcrypt.hash(password, cost);

const dummyHashes = new Map<number, Promise<string>>();

/**
 * Checks a password. When there is no hash (unknown e-mail, or a staff account without a password yet) it still does a full
 * bcrypt comparison against a dummy, so the response time does not reveal whether the account exists.
 */
export async function verifyPassword(password: string, hash: string | null, cost: number): Promise<boolean> {
  if (hash) return bcrypt.compare(password, hash);
  let dummy = dummyHashes.get(cost);
  if (!dummy) dummyHashes.set(cost, (dummy = bcrypt.hash('not-a-real-password', cost)));
  await bcrypt.compare(password, await dummy);
  return false;
}
