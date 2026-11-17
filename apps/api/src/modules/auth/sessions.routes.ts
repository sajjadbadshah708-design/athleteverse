// FR-1.24: a user sees their signed-in browsers and phones and signs out the others. Device management screens are Later
// (MVP scope Yes†); these endpoints are the "revoke" part of the approved slice.
import { z } from 'zod';
import { idSchema, okResponseSchema, revokedSessionsSchema, sessionsResponseSchema } from '@athleteverse/shared';
import { defineRoute } from '../../lib/route';
import { listSessions, revokeOtherSessions, revokeSession } from './sessions';

const EVERYONE = { roles: ['PLAYER', 'MANAGER', 'STAFF', 'ADMIN'] as const, statuses: ['ACTIVE', 'PENDING_APPROVAL', 'REJECTED'] as const };
const sessionParams = z.object({ id: idSchema });

export const SESSION_ROUTES = [
  defineRoute({ method: 'get', path: '/me/sessions', summary: 'My signed-in browsers and phones', tags: ['auth'], srs: ['FR-1.24'],
    access: { roles: [...EVERYONE.roles], statuses: [...EVERYONE.statuses] }, response: sessionsResponseSchema,
    handler: ({ deps, auth }) => listSessions(deps, auth.userId, auth.sessionId) }),
  defineRoute({ method: 'post', path: '/me/sessions/:id/revoke', summary: 'Sign out one of my other sessions', tags: ['auth'], srs: ['FR-1.24'],
    access: { roles: [...EVERYONE.roles], statuses: [...EVERYONE.statuses] }, params: sessionParams, response: okResponseSchema,
    handler: ({ deps, auth, params }) => revokeSession(deps, auth.userId, auth.sessionId, params.id) }),
  defineRoute({ method: 'post', path: '/me/sessions/revoke-others', summary: 'Sign out all my other sessions', tags: ['auth'], srs: ['FR-1.24'],
    access: { roles: [...EVERYONE.roles], statuses: [...EVERYONE.statuses] }, response: revokedSessionsSchema,
    handler: ({ deps, auth }) => revokeOtherSessions(deps, auth.userId, auth.sessionId) }),
];
