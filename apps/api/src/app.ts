import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import type { AppDeps } from './lib/deps';
import { buildOpenApi, renderDocsHtml } from './lib/openapi';
import { mountRoutes, type AnyRoute } from './lib/route';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestContext } from './middleware/requestContext';
import { requireClientHeader } from './middleware/requireClient';
import { jobsRouter } from './modules/jobs/jobs.routes';
import { ALL_JOBS, type Job } from './modules/jobs/tick';
import { spikeRouter } from './modules/spikes/proxy.routes';
import { ALL_ROUTES } from './routes';

/** Builds the Express app. Dependencies are injected so tests can use a fake clock, capture logs and swap the database. */
export function createApp(deps: AppDeps, routes: AnyRoute[] = ALL_ROUTES, jobs: Job[] = ALL_JOBS): Express {
  const app = express();
  app.disable('x-powered-by');
  if (deps.env.TRUST_PROXY_HOPS > 0) app.set('trust proxy', deps.env.TRUST_PROXY_HOPS);

  app.use(requestContext(deps.logger));
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  const api = Router();
  api.use(requireClientHeader); // state-changing requests must name their client (SEC-1)
  mountRoutes(api, routes, deps);

  const openApi = buildOpenApi(routes);
  api.get('/openapi.json', (_req, res) => {
    res.json(openApi);
  });
  api.get('/docs', (_req, res) => {
    res.type('html').send(renderDocsHtml(openApi));
  });

  if (deps.env.ENABLE_SPIKES) {
    deps.logger.warn('spike endpoints are ENABLED (ENABLE_SPIKES=true): switch them off after the measurement');
    api.use('/_spike', spikeRouter(deps));
  }

  app.use('/api/v1', api);
  app.use('/api/jobs', jobsRouter(deps, jobs)); // unversioned, SRS 3.4
  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}
