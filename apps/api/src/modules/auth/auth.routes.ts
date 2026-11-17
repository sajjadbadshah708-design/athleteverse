import {
  authResponseSchema,
  loginRequestSchema,
  okResponseSchema,
  registerRequestSchema,
  registerResponseSchema,
  resendOtpRequestSchema,
  verifyEmailRequestSchema,
} from '@athleteverse/shared';
import type { Response } from 'express';
import type { AppDeps } from '../../lib/deps';
import { defineRoute } from '../../lib/route';
import { extractAccessToken, type AuthContext } from '../../middleware/authenticate';
import { limit } from '../../middleware/rateLimit';
import { loadAuthUser, login, logout, refreshSession, registerPlayer, resendOtp, verifyEmail, type SignedIn } from './auth.service';
import { clearAuthCookies, readCookie, REFRESH_COOKIE, setAccessCookie, setRefreshCookie } from './cookies';
import { sessionMeta } from './sessions';

function startWebSession(deps: AppDeps, res: Response, s: SignedIn): void {
  setAccessCookie(deps, res, s.accessToken);
  setRefreshCookie(deps, res, s.session.refreshToken, s.session.refreshExpiresAt);
}

export const registerRoute = defineRoute({
  method: 'post',
  path: '/auth/register',
  summary: 'Register a player; an e-mail code follows',
  tags: ['auth'],
  srs: ['FR-1.1', 'FR-1.2', 'FR-1.3', 'FR-1.4', 'FR-5.15', 'SEC-5'],
  access: 'public',
  middleware: [limit('register')],
  status: 201,
  body: registerRequestSchema,
  response: registerResponseSchema,
  async handler({ deps, body }) {
    await registerPlayer(deps, body);
    return { status: 'VERIFICATION_REQUIRED' as const, email: body.email };
  },
});

export const verifyEmailRoute = defineRoute({
  method: 'post',
  path: '/auth/verify-email',
  summary: 'Enter the e-mail code: activates a player and signs in',
  tags: ['auth'],
  srs: ['FR-1.3', 'FR-1.8', 'FR-1.24', 'SEC-5'],
  access: 'public',
  middleware: [limit('verify')],
  body: verifyEmailRequestSchema,
  response: authResponseSchema,
  async handler({ deps, body, req, res }) {
    const out = await verifyEmail(deps, body, sessionMeta(req));
    startWebSession(deps, res, out);
    return { user: out.user };
  },
});

export const resendOtpRoute = defineRoute({
  method: 'post',
  path: '/auth/resend-otp',
  summary: 'Send a new e-mail code (at most one a minute; same answer for every e-mail)',
  tags: ['auth'],
  srs: ['FR-1.3', 'SEC-5'],
  access: 'public',
  middleware: [limit('resend')],
  body: resendOtpRequestSchema,
  response: okResponseSchema,
  async handler({ deps, body }) {
    await resendOtp(deps, body.email);
    return { ok: true as const };
  },
});

export const loginRoute = defineRoute({
  method: 'post',
  path: '/auth/login',
  summary: 'Sign in with e-mail and password; five failures lock the account for 15 minutes',
  tags: ['auth'],
  srs: ['FR-1.7', 'FR-1.8', 'FR-1.24', 'SEC-5'],
  access: 'public',
  middleware: [limit('loginIp'), limit('loginEmail')],
  body: loginRequestSchema,
  response: authResponseSchema,
  async handler({ deps, body, req, res }) {
    const out = await login(deps, body, sessionMeta(req));
    startWebSession(deps, res, out);
    return { user: out.user };
  },
});

export const refreshRoute = defineRoute({
  method: 'post',
  path: '/auth/refresh',
  summary: 'Exchange the refresh cookie for a new 15-minute access token',
  tags: ['auth'],
  srs: ['FR-1.8'],
  access: 'public', // authenticated by the refresh cookie itself
  middleware: [limit('refresh')],
  response: authResponseSchema,
  async handler({ deps, req, res }) {
    const out = await refreshSession(deps, readCookie(req, REFRESH_COOKIE));
    setAccessCookie(deps, res, out.accessToken);
    return { user: out.user };
  },
});

export const logoutRoute = defineRoute({
  method: 'post',
  path: '/auth/logout',
  summary: 'End this session and clear the cookies',
  tags: ['auth'],
  srs: ['FR-1.8'],
  access: 'public', // must work even when the access token has expired
  response: okResponseSchema,
  async handler({ deps, req, res }) {
    await logout(deps, { accessToken: extractAccessToken(req), refreshToken: readCookie(req, REFRESH_COOKIE) });
    clearAuthCookies(deps, res);
    return { ok: true as const };
  },
});

export const meRoute = defineRoute({
  method: 'get',
  path: '/me',
  summary: 'The signed-in user (also for managers waiting for approval)',
  tags: ['auth'],
  srs: ['FR-1.11', 'FR-1.15', 'FR-2.27'],
  access: { roles: ['PLAYER', 'MANAGER', 'STAFF', 'ADMIN'], statuses: ['ACTIVE', 'PENDING_APPROVAL', 'REJECTED'] },
  response: authResponseSchema,
  async handler({ deps, auth }) {
    return { user: await loadAuthUser(deps.prisma, (auth as AuthContext).userId) };
  },
});

export const AUTH_ROUTES = [registerRoute, verifyEmailRoute, resendOtpRoute, loginRoute, refreshRoute, logoutRoute, meRoute];
