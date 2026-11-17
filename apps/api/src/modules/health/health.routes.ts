import { healthResponseSchema } from '@athleteverse/shared';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { defineRoute } from '../../lib/route';

/** True if PostgreSQL answers within the time limit (a sleeping Neon database may need a few seconds to wake). */
export async function databaseIsUp(prisma: PrismaClient, timeoutMs = 5_000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('database check timed out')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const healthRoute = defineRoute({
  method: 'get',
  path: '/health',
  summary: 'API liveness (add ?db=true to also check PostgreSQL)',
  tags: ['system'],
  srs: ['PERF-2', 'FR-5.17'], // "starting up" banner relies on this endpoint; same response on both clients
  access: 'public',
  query: z.object({ db: z.stringbool().default(false) }),
  response: healthResponseSchema,
  async handler({ deps, query }) {
    // Render polls this path every few seconds. A database query each time would keep Neon awake 24/7 and burn the
    // free 100 CU-hours in about two weeks, so the default answer never touches the database.
    const up = query.db ? await databaseIsUp(deps.prisma) : undefined;
    return {
      status: up === false ? ('degraded' as const) : ('ok' as const),
      db: up === undefined ? ('unchecked' as const) : up ? ('up' as const) : ('down' as const),
      time: deps.clock.now().toISOString(),
      version: deps.env.APP_VERSION,
      apiVersion: 'v1' as const,
    };
  },
});
