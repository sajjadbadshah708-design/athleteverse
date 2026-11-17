// Authentication and authorisation for every non-public route (SRS FR-1.11, FR-1.12, SEC-3). One query loads the session, the
// user and, for staff, the assignment, so a revoked session, a suspended account or a disabled staff member is refused
// on the very next request, not when the token expires.
import type { Client, Role, UserStatus } from '@athleteverse/shared';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import type { AppDeps } from '../lib/deps';
import { AppError, forbidden } from '../lib/errors';
import type { Access } from '../lib/route';
import { ACCESS_COOKIE, readCookie } from '../modules/auth/cookies';
import { verifyAccessToken } from '../modules/auth/tokens';

export interface AuthContext {
  userId: string;
  sessionId: string;
  role: Role;
  status: UserStatus;
  fullName: string;
  client: Client;
  staffVenueId: string | null;
}

export interface SessionRow {
  sessionId: string;
  userId: string;
  client: Client;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date;
  role: Role;
  status: UserStatus;
  fullName: string;
  deletedAt: Date | null;
  staffVenueId: string | null;
  staffDisabledAt: Date | null;
}

export async function findSession(
  prisma: PrismaClient,
  by: { sessionId: string } | { refreshTokenHash: string },
): Promise<SessionRow | null> {
  const sid = 'sessionId' in by ? by.sessionId : null;
  const hash = 'refreshTokenHash' in by ? by.refreshTokenHash : null;
  const rows = await prisma.$queryRaw<SessionRow[]>`
    SELECT s.id AS "sessionId", s.user_id AS "userId", s.client::text AS client, s.expires_at AS "expiresAt",
           s.revoked_at AS "revokedAt", s.last_used_at AS "lastUsedAt", u.role::text AS role, u.status::text AS status, u.full_name AS "fullName",
           u.deleted_at AS "deletedAt", sp.venue_id AS "staffVenueId", sp.disabled_at AS "staffDisabledAt"
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN staff_profiles sp ON sp.user_id = u.id
     WHERE (${sid}::uuid IS NULL OR s.id = ${sid}::uuid)
       AND (${hash}::text IS NULL OR s.refresh_token_hash = ${hash}::text)`;
  return rows[0] ?? null;
}

/** Throws unless the account may use the app right now. `allowed` lists the statuses this route accepts. */
export function assertUsable(row: SessionRow, allowed: readonly UserStatus[]): void {
  if (row.deletedAt || row.status === 'UNVERIFIED') throw new AppError('UNAUTHENTICATED', 'Sign in again');
  if (row.status === 'SUSPENDED' || (row.role === 'STAFF' && row.staffDisabledAt)) {
    throw new AppError('ACCOUNT_SUSPENDED', 'Your account has been suspended');
  }
  if (!allowed.includes(row.status)) {
    throw new AppError('FORBIDDEN', 'This function is not available for your account status', { status: row.status });
  }
}

/** Bearer token first (the mobile app, Sprint 3b), then the web cookie. */
export function extractAccessToken(req: Request): string | undefined {
  const header = req.header('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim() || undefined;
  return readCookie(req, ACCESS_COOKIE);
}

export async function authenticate(deps: AppDeps, req: Request, allowed: readonly UserStatus[]): Promise<AuthContext> {
  const token = extractAccessToken(req);
  if (!token) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
  const claims = await verifyAccessToken(deps, token);
  const row = await findSession(deps.prisma, { sessionId: claims.sessionId });
  if (!row || row.userId !== claims.userId || row.revokedAt || row.expiresAt <= deps.clock.now()) {
    throw new AppError('UNAUTHENTICATED', 'Sign in again');
  }
  assertUsable(row, allowed);
  if (row.role === 'ADMIN') {
    if (deps.clock.now().getTime() - row.lastUsedAt.getTime() > 15 * 60000) {
      await deps.prisma.userSession.updateMany({ where: { id: row.sessionId, revokedAt: null }, data: { revokedAt: deps.clock.now() } });
      throw new AppError('UNAUTHENTICATED', 'Super Admin signed out after 15 minutes of inactivity');
    }
    await deps.prisma.userSession.update({ where: { id: row.sessionId }, data: { lastUsedAt: deps.clock.now() } });
  }
  return {
    userId: row.userId,
    sessionId: row.sessionId,
    role: row.role,
    status: row.status,
    fullName: row.fullName,
    client: row.client,
    staffVenueId: row.staffVenueId,
  };
}

/** Authenticates, then checks the role. A refused attempt is logged (FR-1.12); T14 also writes it to the audit log. */
export async function authorize(
  deps: AppDeps,
  req: Request,
  res: Response,
  access: Exclude<Access, 'public'>,
  routeLabel: string,
): Promise<AuthContext> {
  const auth = await authenticate(deps, req, access.statuses ?? ['ACTIVE']);
  if (!access.roles.includes(auth.role)) {
    deps.logger.warn('access denied', { requestId: res.locals.requestId, userId: auth.userId, role: auth.role, route: routeLabel });
    throw forbidden();
  }
  return auth;
}
