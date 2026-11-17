// Spike S2 endpoint: only exists when ENABLE_SPIKES=true, secret-protected, and its "what would req.ip be" arithmetic
// must agree with what Express really does for every trust-proxy setting.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { TEST_JOB_SECRET, testDeps } from './helpers/app';

const XFF = '203.0.113.9, 198.51.100.7'; // original client, then the first proxy

describe('GET /api/v1/_spike/proxy', () => {
  it('does not exist unless ENABLE_SPIKES=true', async () => {
    const res = await request(createApp(testDeps().deps)).get('/api/v1/_spike/proxy').set('X-Job-Secret', TEST_JOB_SECRET);
    expect(res.status).toBe(404);
  });

  it('warns loudly at startup when enabled', () => {
    const { deps, logs } = testDeps({}, { ENABLE_SPIKES: 'true' });
    createApp(deps);
    expect(logs.some((l) => l.level === 'warn' && String(l.msg).includes('spike endpoints are ENABLED'))).toBe(true);
  });

  it('requires the job secret', async () => {
    const app = createApp(testDeps({}, { ENABLE_SPIKES: 'true' }).deps);
    await request(app).get('/api/v1/_spike/proxy').expect(401);
    await request(app).get('/api/v1/_spike/proxy').set('X-Job-Secret', 'wrong').expect(401);
  });

  it('reports the forwarding chain and only the proxy-related headers', async () => {
    const app = createApp(testDeps({}, { ENABLE_SPIKES: 'true' }).deps);
    const res = await request(app)
      .get('/api/v1/_spike/proxy')
      .set('X-Job-Secret', TEST_JOB_SECRET)
      .set('X-Forwarded-For', XFF)
      .set('Cookie', 'session=private')
      .set('Authorization', 'Bearer private')
      .expect(200);
    expect(res.body.chain.slice(1)).toEqual(['198.51.100.7', '203.0.113.9']);
    expect(res.body.headers['x-forwarded-for']).toBe(XFF);
    expect(JSON.stringify(res.body)).not.toContain('private'); // cookies and tokens are never echoed
  });

  it.each([0, 1, 2, 3])('predicts the IP Express reports with TRUST_PROXY_HOPS=%i', async (hops) => {
    const app = createApp(testDeps({}, { ENABLE_SPIKES: 'true', TRUST_PROXY_HOPS: String(hops) }).deps);
    const res = await request(app).get('/api/v1/_spike/proxy').set('X-Job-Secret', TEST_JOB_SECRET).set('X-Forwarded-For', XFF).expect(200);
    expect(res.body.trustProxyHopsNow).toBe(hops);
    expect(res.body.ipNow).toBe(res.body.ipIfTrustHopsIs[String(hops)]); // the spike's arithmetic equals Express's behaviour
  });

  it('shows why one hop count cannot be right for both paths: trusting 2 hops lets a direct caller spoof the IP', async () => {
    // Direct path (mobile app -> Render): the platform proxy appends the real client to whatever the caller sent.
    const app = createApp(testDeps({}, { ENABLE_SPIKES: 'true', TRUST_PROXY_HOPS: '2' }).deps);
    const spoofed = await request(app).get('/api/v1/_spike/proxy').set('X-Job-Secret', TEST_JOB_SECRET).set('X-Forwarded-For', '1.2.3.4, 198.51.100.7');
    expect(spoofed.body.ipNow).toBe('1.2.3.4'); // the attacker-chosen entry wins
  });
});
