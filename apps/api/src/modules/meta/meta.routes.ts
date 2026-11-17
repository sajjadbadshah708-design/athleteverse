// Reference lists the clients need before anyone signs in (D10: public browse data, no personal data). Short lists, so no paging.
import { citiesResponseSchema, sportsResponseSchema } from '@athleteverse/shared';
import { defineRoute } from '../../lib/route';

const CACHE = 'public, max-age=60'; // these change a few times a year

export const citiesRoute = defineRoute({
  method: 'get',
  path: '/meta/cities',
  summary: 'Active cities, alphabetical',
  tags: ['meta'],
  srs: ['FR-1.14'],
  access: 'public',
  response: citiesResponseSchema,
  async handler({ deps, res }) {
    res.setHeader('Cache-Control', CACHE);
    const rows = await deps.prisma.city.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
    return { items: rows };
  },
});

export const sportsRoute = defineRoute({
  method: 'get',
  path: '/meta/sports',
  summary: 'Active sports with their team sizes, alphabetical',
  tags: ['meta'],
  srs: ['FR-1.14', 'FR-2.2'],
  access: 'public',
  response: sportsResponseSchema,
  async handler({ deps, res }) {
    res.setHeader('Cache-Control', CACHE);
    const rows = await deps.prisma.sport.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, minTeamSize: true, maxTeamSize: true },
    });
    return { items: rows };
  },
});

export const META_ROUTES = [citiesRoute, sportsRoute];
