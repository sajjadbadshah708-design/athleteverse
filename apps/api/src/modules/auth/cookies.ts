// The web client holds its tokens in HttpOnly, SameSite=Strict cookies (FR-1.8, SEC-1). The refresh cookie is only sent to
// /api/v1/auth, so it never travels with ordinary requests.
import { parseCookie } from 'cookie';
import type { Request, Response } from 'express';
import type { AppDeps } from '../../lib/deps';
import { ACCESS_TTL_SECONDS } from './tokens';

export const ACCESS_COOKIE = 'av_access';
export const REFRESH_COOKIE = 'av_refresh';
const ACCESS_PATH = '/api/v1';
const REFRESH_PATH = '/api/v1/auth';

export const readCookie = (req: Request, name: string): string | undefined => parseCookie(req.headers.cookie ?? '')[name];

function options(deps: AppDeps, path: string) {
  // Browsers refuse Secure cookies on plain http, so only production (HTTPS) sets the flag.
  return { httpOnly: true, secure: deps.env.NODE_ENV === 'production', sameSite: 'strict' as const, path };
}

export function setAccessCookie(deps: AppDeps, res: Response, accessToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, { ...options(deps, ACCESS_PATH), maxAge: ACCESS_TTL_SECONDS * 1000 });
}

export function setRefreshCookie(deps: AppDeps, res: Response, refreshToken: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, refreshToken, { ...options(deps, REFRESH_PATH), expires: expiresAt });
}

export function clearAuthCookies(deps: AppDeps, res: Response): void {
  res.clearCookie(ACCESS_COOKIE, options(deps, ACCESS_PATH));
  res.clearCookie(REFRESH_COOKIE, options(deps, REFRESH_PATH));
}
