import { z } from 'zod';

/**
 * GET /api/v1/health. Always HTTP 200 while the API process is up.
 * Without parameters it does NOT touch the database ("unchecked"): Render calls it every few seconds, and a query each time
 * would keep a free Neon database awake all month. Add ?db=true for a real PostgreSQL check.
 */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['up', 'down', 'unchecked']),
  time: z.iso.datetime(), // server time, UTC (rule 5)
  version: z.string(), // short git commit on Render, "dev" locally
  apiVersion: z.literal('v1'),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
