import { Router } from 'express';
import type { AppDeps } from '../../lib/deps';
import { AppError } from '../../lib/errors';
import { secretsMatch } from '../../lib/secret';
import { runTick, type Job } from './tick';

/** Mounted at /api/jobs (unversioned, as in SRS 3.4). Protected by the X-Job-Secret header. */
export function jobsRouter(deps: AppDeps, jobs: Job[]): Router {
  const router = Router();
  router.post('/tick', async (req, res) => {
    if (!secretsMatch(req.header('x-job-secret'), deps.env.JOB_SECRET)) {
      deps.logger.warn('job tick rejected', { requestId: res.locals.requestId }); // never log the presented value
      throw new AppError('UNAUTHENTICATED', 'Invalid or missing job secret');
    }
    res.json(await runTick(deps, jobs));
  });
  return router;
}
