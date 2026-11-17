import { z } from 'zod';
import { cancellationPreviewSchema, cancellationResultSchema, creditSummarySchema, idSchema, myBookingsResponseSchema,
  outcomeRequestSchema, outcomeResultSchema, venueBookingsResponseSchema, okResponseSchema, bookingReceiptSchema } from '@athleteverse/shared';
import { defineRoute } from '../../lib/route';
import { getCreditSummary } from '../credit/credit.service';
import { cancellationPreview, cancelMyBooking, listMyBookings, managerCancelBooking, playerReceipt, recordOutcome, venueBookings } from './booking-actions';

const bookingParams = z.object({ id: idSchema });
const venueParams = z.object({ venueId: idSchema });
const venueQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), search: z.string().max(100).optional() });

export const OPERATIONS_ROUTES = [
  defineRoute({ method: 'get', path: '/me/bookings', summary: 'My upcoming, past and cancelled bookings',
    tags: ['bookings'], srs: ['FR-2.13'], access: { roles: ['PLAYER'] }, response: myBookingsResponseSchema,
    handler: ({ deps, auth }) => listMyBookings(deps, auth.userId) }),
  defineRoute({ method: 'get', path: '/me/credit', summary: 'My credit score, tier and event history',
    tags: ['bookings'], srs: ['FR-2.27'], access: { roles: ['PLAYER'] }, response: creditSummarySchema,
    handler: ({ deps, auth }) => getCreditSummary(deps, auth.userId) }),
  defineRoute({ method: 'get', path: '/me/bookings/:id/receipt', summary: 'Own cash receipt for paid booking',
    tags: ['bookings'], srs: ['FR-2.17'], access: { roles: ['PLAYER'] }, params: bookingParams, response: bookingReceiptSchema,
    handler: ({ deps, auth, params }) => playerReceipt(deps, auth.userId, params.id) }),
  defineRoute({ method: 'get', path: '/me/bookings/:id/cancellation', summary: 'Preview penalty calculated against the server clock',
    tags: ['bookings'], srs: ['FR-2.20', 'FR-2.21'], access: { roles: ['PLAYER'] }, params: bookingParams, response: cancellationPreviewSchema,
    handler: ({ deps, auth, params }) => cancellationPreview(deps, auth.userId, params.id) }),
  defineRoute({ method: 'post', path: '/me/bookings/:id/cancel', summary: 'Cancel confirmed booking and apply any credit penalty once',
    tags: ['bookings'], srs: ['FR-2.20', 'FR-2.21', 'FR-2.24'], access: { roles: ['PLAYER'] }, params: bookingParams, response: cancellationResultSchema,
    handler: ({ deps, auth, params }) => cancelMyBooking(deps, auth.userId, params.id) }),
  defineRoute({ method: 'get', path: '/operations/venues/:venueId/bookings', summary: 'Venue front-desk bookings and search',
    tags: ['operations'], srs: ['FR-5.3', 'FR-1.13'], access: { roles: ['MANAGER', 'STAFF'] }, params: venueParams,
    query: venueQuery, response: venueBookingsResponseSchema,
    handler: ({ deps, auth, params, query }) => venueBookings(deps, auth, params.venueId, query.date, query.search) }),
  defineRoute({ method: 'post', path: '/operations/bookings/:id/cancel', summary: 'Manager cancellation with reason, no player penalty',
    tags: ['operations'], srs: ['FR-2.22', 'FR-1.13'], access: { roles: ['MANAGER'] }, params: bookingParams,
    body: z.object({ reason: z.string().trim().min(3).max(500) }), response: okResponseSchema,
    handler: ({ deps, auth, params, body }) => managerCancelBooking(deps, auth, params.id, body.reason) }),
  defineRoute({ method: 'post', path: '/operations/bookings/:id/outcome', summary: 'Record cash paid, unpaid or no-show with atomic credit event',
    tags: ['operations'], srs: ['FR-2.16', 'FR-2.17', 'FR-2.23', 'FR-2.24'], access: { roles: ['MANAGER', 'STAFF'] },
    params: bookingParams, body: outcomeRequestSchema, response: outcomeResultSchema,
    handler: ({ deps, auth, params, body }) => recordOutcome(deps, auth, params.id, body.outcome, body.amount) }),
];
