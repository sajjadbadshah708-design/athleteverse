import { z } from 'zod';
import {
  acceptInviteSchema, adminOtpRequestSchema, adminOtpResponseSchema, adminOtpVerifySchema,
  authResponseSchema, courtCreatedSchema, courtInputSchema, decisionSchema, idSchema, inviteResultSchema,
  managedVenuesSchema, managedVenueSchema, managerRegisterSchema, managersListSchema, myManagerStatusSchema, okResponseSchema,
  registerResponseSchema, staffInviteSchema, staffListSchema, venueInputSchema,
} from '@athleteverse/shared';
import { defineRoute } from '../../lib/route';
import { limit } from '../../middleware/rateLimit';
import { setAccessCookie, setRefreshCookie } from '../auth/cookies';
import { sessionMeta } from '../auth/sessions';
import {
  acceptStaffInvite, adminRequestOtp, adminVerifyOtp, createCourt, createVenue, decideManager, inviteStaff,
  listManagers, managerVenues, registerManager, setStaffDisabled, staffList,
} from './management.service';

const venueIdParams = z.object({ venueId: idSchema });
const managerIdParams = z.object({ id: idSchema });

export const MANAGEMENT_ROUTES = [
  defineRoute({ method: 'post', path: '/auth/register-manager', summary: 'Register Arena Manager; email code required before administrator approval',
    tags: ['auth'], srs: ['FR-1.1', 'FR-1.5'], access: 'public', middleware: [limit('register')], status: 201,
    body: managerRegisterSchema, response: registerResponseSchema,
    async handler({ deps, body }) { await registerManager(deps, body); return { status: 'VERIFICATION_REQUIRED' as const, email: body.email }; } }),
  defineRoute({ method: 'post', path: '/auth/admin/request-otp', summary: 'Super Admin first login factor; requests a one-time e-mail code',
    tags: ['auth'], srs: ['FR-1.9', 'SA-3'], access: 'public', middleware: [limit('loginIp'), limit('loginEmail')],
    body: adminOtpRequestSchema, response: adminOtpResponseSchema,
    async handler({ deps, body }) { await adminRequestOtp(deps, body.email, body.password); return { status: 'OTP_REQUIRED' as const }; } }),
  defineRoute({ method: 'post', path: '/auth/admin/verify-otp', summary: 'Super Admin second login factor; creates 15-minute-idle session',
    tags: ['auth'], srs: ['FR-1.9', 'SA-3'], access: 'public', middleware: [limit('verify')],
    body: adminOtpVerifySchema, response: authResponseSchema,
    async handler({ deps, body, res, req }) {
      const out = await adminVerifyOtp(deps, body.email, body.password, body.code, sessionMeta(req));
      setAccessCookie(deps, res, out.accessToken); setRefreshCookie(deps, res, out.session.refreshToken, out.session.refreshExpiresAt);
      return { user: out.user };
    } }),
  defineRoute({ method: 'post', path: '/auth/accept-invite', summary: 'Staff member accepts their 48-hour single-use invitation',
    tags: ['auth'], srs: ['FR-1.6'], access: 'public', middleware: [limit('verify')],
    body: acceptInviteSchema, response: okResponseSchema,
    handler: ({ deps, body }) => acceptStaffInvite(deps, body.userId, body.token, body.password) }),
  defineRoute({ method: 'get', path: '/admin/managers', summary: 'Review manager account applications', tags: ['admin'],
    srs: ['FR-1.20'], access: { roles: ['ADMIN'] }, response: managersListSchema,
    handler: ({ deps }) => listManagers(deps) }),
  defineRoute({ method: 'post', path: '/admin/managers/:id/decision', summary: 'Approve or reject an Arena Manager, with audited reason',
    tags: ['admin'], srs: ['FR-1.5', 'FR-1.20', 'FR-1.23'], access: { roles: ['ADMIN'] }, params: managerIdParams,
    body: decisionSchema, response: okResponseSchema,
    handler: ({ deps, auth, params, body }) => decideManager(deps, auth.userId, params.id, body.decision, body.reason) }),
  defineRoute({ method: 'get', path: '/me/manager-status', summary: 'Own manager approval status and rejection reason',
    tags: ['management'], srs: ['FR-1.5'], access: { roles: ['MANAGER'], statuses: ['ACTIVE', 'PENDING_APPROVAL', 'REJECTED'] },
    response: myManagerStatusSchema, async handler({ deps, auth }) {
      const profile = await deps.prisma.managerProfile.findUniqueOrThrow({ where: { userId: auth.userId }, include: { user: true } });
      return { status: profile.user.status, businessName: profile.businessName, rejectionReason: profile.rejectionReason };
    } }),
  defineRoute({ method: 'get', path: '/manager/venues', summary: 'The manager\'s own venues', tags: ['management'],
    srs: ['FR-1.13', 'FR-1.18'], access: { roles: ['MANAGER'] }, response: managedVenuesSchema,
    handler: ({ deps, auth }) => managerVenues(deps, auth.userId) }),
  defineRoute({ method: 'post', path: '/manager/venues', summary: 'Create approved manager venue (maximum three)', tags: ['management'],
    srs: ['FR-1.5', 'FR-1.18', 'FR-5.8'], access: { roles: ['MANAGER'] }, body: venueInputSchema, response: managedVenueSchema,
    status: 201, handler: ({ deps, auth, body }) => createVenue(deps, auth.userId, body) }),
  defineRoute({ method: 'post', path: '/manager/venues/:venueId/courts', summary: 'Create court with sport and hourly prices (maximum ten)',
    tags: ['management'], srs: ['FR-1.18', 'FR-5.8'], access: { roles: ['MANAGER'] }, params: venueIdParams,
    body: courtInputSchema, response: courtCreatedSchema, status: 201,
    handler: ({ deps, auth, params, body }) => createCourt(deps, auth.userId, params.venueId, body) }),
  defineRoute({ method: 'get', path: '/manager/venues/:venueId/staff', summary: 'List the manager\'s assigned venue staff',
    tags: ['management'], srs: ['FR-5.6', 'FR-1.13'], access: { roles: ['MANAGER'] }, params: venueIdParams,
    response: staffListSchema, handler: ({ deps, auth, params }) => staffList(deps, auth.userId, params.venueId) }),
  defineRoute({ method: 'post', path: '/manager/venues/:venueId/staff', summary: 'Invite staff by 48-hour single-use e-mail link',
    tags: ['management'], srs: ['FR-1.6', 'FR-1.18', 'FR-5.6'], access: { roles: ['MANAGER'] }, params: venueIdParams,
    body: staffInviteSchema, response: inviteResultSchema, status: 201,
    handler: ({ deps, auth, params, body }) => inviteStaff(deps, auth.userId, params.venueId, body) }),
  defineRoute({ method: 'post', path: '/manager/staff/:id/disable', summary: 'Enable or disable staff and revoke active sessions',
    tags: ['management'], srs: ['FR-5.6'], access: { roles: ['MANAGER'] }, params: managerIdParams,
    body: z.object({ disabled: z.boolean() }), response: okResponseSchema,
    handler: ({ deps, auth, params, body }) => setStaffDisabled(deps, auth.userId, params.id, body.disabled) }),
];
