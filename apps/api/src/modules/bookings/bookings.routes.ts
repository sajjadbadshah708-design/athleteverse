import { bookingSchema, createBookingRequestSchema } from '@athleteverse/shared';
import { defineRoute } from '../../lib/route';
import { createBooking } from './bookings.service';

export const createBookingRoute = defineRoute({
  method: 'post',
  path: '/bookings',
  summary: 'Book 1 to 3 consecutive hours on one court. Confirmed at once; pay cash at the venue afterwards',
  tags: ['bookings'],
  srs: ['FR-2.7', 'FR-2.8', 'FR-2.9', 'FR-2.10', 'FR-2.11', 'FR-2.15', 'FR-1.15', 'FR-2.25', 'FR-5.15'],
  access: { roles: ['PLAYER'] },
  status: 201,
  body: createBookingRequestSchema,
  response: bookingSchema,
  handler: ({ deps, auth, body }) => createBooking(deps, auth.userId, body),
});

export const BOOKING_ROUTES = [createBookingRoute];
