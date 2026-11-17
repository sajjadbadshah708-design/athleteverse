// Spike S2 (docs/DEPLOY.md): measures the proxy chain so TRUST_PROXY_HOPS can be set from evidence, not guesswork.
// Mounted ONLY when ENABLE_SPIKES=true and protected by X-Job-Secret. Switch it off after the measurement.
import { Router } from 'express';
import type { AppDeps } from '../../lib/deps';
import { AppError } from '../../lib/errors';
import { secretsMatch } from '../../lib/secret';

const SHOWN_HEADERS = ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'via', 'cf-connecting-ip', 'x-vercel-id'];

export function spikeRouter(deps: AppDeps): Router {
  const router = Router();
  router.get('/proxy', (req, res) => {
    if (!secretsMatch(req.header('x-job-secret'), deps.env.JOB_SECRET)) {
      throw new AppError('UNAUTHENTICATED', 'Invalid or missing job secret');
    }
    const xff = req.header('x-forwarded-for');
    // Addresses from the socket outwards: [direct peer, last X-Forwarded-For entry, ..., first entry].
    // With "trust proxy = N" Express reports chain[N] (or the last entry when the chain is shorter).
    const chain = [req.socket.remoteAddress ?? '', ...(xff ? xff.split(',').map((s) => s.trim()).reverse() : [])];
    const ipIfTrustHopsIs = Object.fromEntries([0, 1, 2, 3].map((n) => [String(n), chain[Math.min(n, chain.length - 1)] ?? null]));
    res.json({
      trustProxyHopsNow: deps.env.TRUST_PROXY_HOPS,
      ipNow: req.ip,
      remoteAddress: req.socket.remoteAddress ?? null,
      chain,
      ipIfTrustHopsIs,
      headers: Object.fromEntries(SHOWN_HEADERS.map((h) => [h, req.header(h) ?? null])),
    });
  });
  return router;
}
