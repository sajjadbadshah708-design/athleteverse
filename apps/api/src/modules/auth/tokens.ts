// Access tokens (JWT, HS256, 15 minutes) and refresh tokens (opaque, 7 days) for the web cookies (FR-1.8, SEC-1).
// Verification uses the injected clock, so tests can move time. The algorithm is pinned: "none" and other algorithms are refused.
import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { AppDeps } from '../../lib/deps';
import { AppError } from '../../lib/errors';

const ISSUER = 'athleteverse';
const AUDIENCE = 'athleteverse-api';
export const ACCESS_TTL_SECONDS = 15 * 60;

const key = (deps: AppDeps) => new TextEncoder().encode(deps.env.JWT_SECRET);

export async function signAccessToken(deps: AppDeps, userId: string, sessionId: string): Promise<string> {
  const issuedAt = Math.floor(deps.clock.now().getTime() / 1000);
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ACCESS_TTL_SECONDS)
    .sign(key(deps));
}

export async function verifyAccessToken(deps: AppDeps, token: string): Promise<{ userId: string; sessionId: string }> {
  try {
    const { payload } = await jwtVerify(token, key(deps), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: deps.clock.now(),
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw new Error('claims missing');
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Sign in again');
  }
}

export const newRefreshToken = (): string => randomBytes(32).toString('base64url');

/** The database keeps only this hash. The token has 256 bits of entropy, so a plain SHA-256 is enough. */
export const hashRefreshToken = (token: string): string => createHash('sha256').update(token).digest('hex');
