import { describe, expect, it } from 'vitest';
import { generateOtp, hashOtp, otpMatches } from '../src/modules/auth/otp';
import { hashPassword, verifyPassword } from '../src/modules/auth/password';
import { hashRefreshToken, newRefreshToken, signAccessToken, verifyAccessToken } from '../src/modules/auth/tokens';
import { testDeps } from './helpers/app';

describe('one-time codes (FR-1.3)', () => {
  it('are six digits, zero-padded, and not all the same', () => {
    const codes = Array.from({ length: 300 }, generateOtp);
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(250);
  });

  it('are stored as a keyed hash bound to the user and the purpose', () => {
    const pepper = 'p'.repeat(32);
    const stored = hashOtp(pepper, 'user-1', 'EMAIL_VERIFY', '123456');
    expect(otpMatches(stored, pepper, 'user-1', 'EMAIL_VERIFY', '123456')).toBe(true);
    expect(otpMatches(stored, pepper, 'user-1', 'EMAIL_VERIFY', '123457')).toBe(false);
    expect(otpMatches(stored, pepper, 'user-2', 'EMAIL_VERIFY', '123456')).toBe(false); // another user's code does not fit
    expect(otpMatches(stored, pepper, 'user-1', 'LOGIN_OTP', '123456')).toBe(false); // nor another purpose
    expect(otpMatches(stored, 'q'.repeat(32), 'user-1', 'EMAIL_VERIFY', '123456')).toBe(false); // nor another pepper
    expect(otpMatches('not-hex', pepper, 'user-1', 'EMAIL_VERIFY', '123456')).toBe(false); // a corrupt row cannot crash it
  });
});

describe('passwords (FR-1.4)', () => {
  it('verify against their bcrypt hash and differ between users with the same password', async () => {
    const a = await hashPassword('Passw0rdOK', 4);
    const b = await hashPassword('Passw0rdOK', 4);
    expect(a).not.toBe(b); // salted
    expect(await verifyPassword('Passw0rdOK', a, 4)).toBe(true);
    expect(await verifyPassword('passw0rdok', a, 4)).toBe(false);
  });

  it('fail for a missing hash after doing the same bcrypt work, so timing does not reveal unknown accounts', async () => {
    const real = await hashPassword('Passw0rdOK', 8);
    const time = async (fn: () => Promise<boolean>) => {
      const start = performance.now();
      const result = await fn();
      return { result, ms: performance.now() - start };
    };
    await verifyPassword('x', null, 8); // warm the cached dummy hash
    const missing = await time(() => verifyPassword('Passw0rdOK', null, 8));
    const wrong = await time(() => verifyPassword('Wrong1234', real, 8));
    expect(missing.result).toBe(false);
    expect(missing.ms).toBeGreaterThan(wrong.ms / 4); // same order of magnitude, not an instant return
  });
});

describe('tokens (FR-1.8)', () => {
  const { deps, clock } = testDeps();

  it('access tokens carry the user and session and live exactly 15 minutes on the injected clock', async () => {
    const token = await signAccessToken(deps, 'user-1', 'session-1');
    expect(await verifyAccessToken(deps, token)).toEqual({ userId: 'user-1', sessionId: 'session-1' });
    clock.advance(15 * 60_000 - 1000);
    await expect(verifyAccessToken(deps, token)).resolves.toBeDefined();
    clock.advance(1000);
    await expect(verifyAccessToken(deps, token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refresh tokens are unguessable and only their hash is kept', () => {
    const tokens = Array.from({ length: 50 }, newRefreshToken);
    expect(new Set(tokens).size).toBe(50);
    expect(tokens[0]!.length).toBeGreaterThanOrEqual(43); // 256 bits, base64url
    expect(hashRefreshToken(tokens[0]!)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(tokens[0]!)).not.toContain(tokens[0]!);
  });
});
