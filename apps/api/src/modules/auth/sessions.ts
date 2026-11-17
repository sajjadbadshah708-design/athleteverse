// One session per signed-in browser or phone (FR-1.24). A user may hold at most `sessions_per_user` (default 5) active
// sessions; signing in on a 6th device ends the least recently used one (assumption N10).
import type { Client } from '@athleteverse/shared';
import type { Request } from 'express';
import type { Tx } from '../../db/tx';
import type { AppDeps } from '../../lib/deps';
import { AppError, notFound } from '../../lib/errors';
import { clientFromRequest } from '../../middleware/requireClient';
import { hashRefreshToken, newRefreshToken } from './tokens';

export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // web: 7 days (FR-1.8)

export interface SessionMeta {
  client: Client;
  deviceName?: string;
  appVersion?: string;
}

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export function sessionMeta(req: Request): SessionMeta {
  return {
    client: clientFromRequest(req) ?? 'WEB',
    deviceName: req.header('user-agent')?.slice(0, 120),
    appVersion: req.header('x-app-version')?.slice(0, 20),
  };
}

/** Call inside a transaction that already holds the user's row lock, so two simultaneous sign-ins cannot exceed the cap. */
export async function createSession(deps: AppDeps, tx: Tx, userId: string, meta: SessionMeta): Promise<IssuedSession> {
  const now = deps.clock.now();
  const cap = await deps.settings.get('sessions_per_user');

  const active = await tx.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { lastUsedAt: 'asc' },
    select: { id: true },
  });
  const surplus = active.length - cap + 1; // room for the new one
  if (surplus > 0) {
    await tx.userSession.updateMany({ where: { id: { in: active.slice(0, surplus).map((s) => s.id) } }, data: { revokedAt: now } });
  }

  const refreshToken = newRefreshToken();
  const session = await tx.userSession.create({
    data: {
      userId,
      client: meta.client,
      deviceName: meta.deviceName,
      appVersion: meta.appVersion,
      refreshTokenHash: hashRefreshToken(refreshToken),
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    },
  });
  return { sessionId: session.id, refreshToken, refreshExpiresAt: session.expiresAt };
}

/** FR-1.24: the user's active sessions, most recently used first. */
export async function listSessions(deps: AppDeps, userId: string, currentSessionId: string) {
  const rows = await deps.prisma.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: deps.clock.now() } },
    orderBy: { lastUsedAt: 'desc' },
  });
  return { items: rows.map((s) => ({
    id: s.id, client: s.client, deviceName: s.deviceName, appVersion: s.appVersion,
    createdAt: s.createdAt.toISOString(), lastUsedAt: s.lastUsedAt.toISOString(), current: s.id === currentSessionId,
  })) };
}

/**
 * FR-1.24: sign out one of the user's OTHER sessions. The session making the request is ended with logout instead, so this
 * call can never leave the caller holding cookies of a dead session. Unknown, foreign or already ended sessions are 404.
 */
export async function revokeSession(deps: AppDeps, userId: string, currentSessionId: string, sessionId: string) {
  if (sessionId === currentSessionId) throw new AppError('CONFLICT', 'Use sign out to end the session you are using');
  const now = deps.clock.now();
  const ended = await deps.prisma.userSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now },
  });
  if (!ended.count) throw notFound('Session');
  return { ok: true as const };
}

/** FR-1.24: sign out every session of the user except the one making the request. */
export async function revokeOtherSessions(deps: AppDeps, userId: string, currentSessionId: string) {
  const ended = await deps.prisma.userSession.updateMany({
    where: { userId, revokedAt: null, id: { not: currentSessionId } },
    data: { revokedAt: deps.clock.now() },
  });
  return { ok: true as const, revoked: ended.count };
}
