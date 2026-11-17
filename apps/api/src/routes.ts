import type { AnyRoute } from './lib/route';
import { AUTH_ROUTES } from './modules/auth/auth.routes';
import { SESSION_ROUTES } from './modules/auth/sessions.routes';
import { BOOKING_ROUTES } from './modules/bookings/bookings.routes';
import { OPERATIONS_ROUTES } from './modules/bookings/operations.routes';
import { MANAGEMENT_ROUTES } from './modules/management/management.routes';
import { healthRoute } from './modules/health/health.routes';
import { META_ROUTES } from './modules/meta/meta.routes';
import { PROFILE_ROUTES } from './modules/users/profile.routes';
import { VENUE_ROUTES } from './modules/venues/venues.routes';

/** Every endpoint of the API. Later tasks append their routes here. */
export const ALL_ROUTES: AnyRoute[] = [healthRoute, ...AUTH_ROUTES, ...SESSION_ROUTES, ...PROFILE_ROUTES, ...META_ROUTES, ...VENUE_ROUTES, ...BOOKING_ROUTES, ...OPERATIONS_ROUTES, ...MANAGEMENT_ROUTES];
