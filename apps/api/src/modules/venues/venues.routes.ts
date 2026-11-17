import { availabilityQuerySchema, availabilityResponseSchema, idSchema, venueDetailSchema, venueListQuerySchema, venueListResponseSchema } from '@athleteverse/shared';
import { z } from 'zod';
import { defineRoute } from '../../lib/route';
import { getAvailability, getVenue, listVenues } from './venues.service';

const idParams = z.object({ id: idSchema });

export const listVenuesRoute = defineRoute({
  method: 'get',
  path: '/venues',
  summary: 'Search active venues: by name or address, city, sport and price; sorted by name or price; 20 per page',
  tags: ['venues'],
  srs: ['FR-2.1', 'FR-2.2'],
  access: 'public',
  query: venueListQuerySchema,
  response: venueListResponseSchema,
  handler: ({ deps, query }) => listVenues(deps, query),
});

export const getVenueRoute = defineRoute({
  method: 'get',
  path: '/venues/:id',
  summary: 'A venue with its active courts, hours, prices and the cancellation and credit policy',
  tags: ['venues'],
  srs: ['FR-2.3'],
  access: 'public',
  params: idParams,
  response: venueDetailSchema,
  handler: ({ deps, params }) => getVenue(deps, params.id),
});

export const availabilityRoute = defineRoute({
  method: 'get',
  path: '/venues/:id/availability',
  summary: 'The hourly slots of every active court for one date: Available, Booked, Blocked or Past',
  tags: ['venues'],
  srs: ['FR-2.5', 'FR-2.7'],
  access: 'public',
  params: idParams,
  query: availabilityQuerySchema,
  response: availabilityResponseSchema,
  async handler({ deps, params, query, res }) {
    res.setHeader('Cache-Control', 'no-store'); // slots change by the second; never serve a stale grid
    return getAvailability(deps, params.id, query.date);
  },
});

export const VENUE_ROUTES = [listVenuesRoute, getVenueRoute, availabilityRoute];
