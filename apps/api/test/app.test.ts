// T3 "Done when": /health and /docs respond. Also: request ids, secure headers, 404 and parse errors use the envelope.
import { healthResponseSchema } from '@athleteverse/shared';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createDb } from '../src/db/prisma';
import { fakePrisma, testDeps } from './helpers/app';
import { TEST_DATABASE_URL } from './helpers/db';

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.close());

describe('GET /api/v1/health', () => {
  it('answers without touching the database by default (Render polls it every few seconds)', async () => {
    let queries = 0;
    const counting = { $queryRaw: async () => (queries++, []) } as unknown as PrismaClient;
    const { deps, clock } = testDeps({ prisma: counting });
    const res = await request(createApp(deps)).get('/api/v1/health').expect(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body).toMatchObject({ status: 'ok', db: 'unchecked', apiVersion: 'v1', version: 'dev' });
    expect(body.time).toBe(clock.now().toISOString()); // injected clock, UTC (PERF-2, FR-5.17)
    expect(queries).toBe(0);
  });

  it('checks PostgreSQL when asked with ?db=true', async () => {
    const { deps } = testDeps({ prisma: db.prisma });
    const res = await request(createApp(deps)).get('/api/v1/health?db=true').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('stays HTTP 200 but reports degraded when ?db=true and the database is down', async () => {
    const { deps } = testDeps({ prisma: fakePrisma(false) });
    const res = await request(createApp(deps)).get('/api/v1/health?db=true').expect(200);
    expect(res.body).toMatchObject({ status: 'degraded', db: 'down' });
  });

  it('rejects a db value that is not a boolean', async () => {
    const res = await request(createApp(testDeps().deps)).get('/api/v1/health?db=maybe').expect(422);
    expect(res.body.error.details.issues[0]).toMatchObject({ in: 'query', path: 'db' });
  });
});

describe('GET /api/v1/docs and /openapi.json (MNT-4)', () => {
  it('serves the OpenAPI document with the health endpoint and its SRS ids', async () => {
    const res = await request(createApp(testDeps().deps)).get('/api/v1/openapi.json').expect(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/health'].get['x-srs']).toEqual(['PERF-2', 'FR-5.17']);
  });

  it('serves a readable HTML page listing the endpoints', async () => {
    const res = await request(createApp(testDeps().deps)).get('/api/v1/docs').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('/api/v1/health');
    expect(res.text).toContain('PERF-2');
  });
});

describe('request context', () => {
  const app = createApp(testDeps().deps);

  it('adds a request id, echoes a valid incoming one and replaces an unsafe one', async () => {
    const generated = await request(app).get('/api/v1/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await request(app).get('/api/v1/health').set('X-Request-Id', 'trace-abc12345');
    expect(echoed.headers['x-request-id']).toBe('trace-abc12345');
    const unsafe = await request(app).get('/api/v1/health').set('X-Request-Id', 'bad id with spaces!');
    expect(unsafe.headers['x-request-id']).not.toBe('bad id with spaces!');
  });

  it('sets secure headers and hides the framework (SEC-1, SEC-4)', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('logs one access line per request and never logs the query string', async () => {
    const { deps, logs } = testDeps();
    await request(createApp(deps)).get('/api/v1/health?token=super-secret').expect(200);
    const access = logs.filter((l) => l.msg === 'request');
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({ method: 'GET', path: '/api/v1/health', status: 200 });
    expect(JSON.stringify(logs)).not.toContain('super-secret');
  });
});

describe('error envelope (USA-3)', () => {
  const app = createApp(testDeps().deps);

  it('answers unknown routes with NOT_FOUND', async () => {
    for (const path of ['/api/v1/nope', '/elsewhere']) {
      const res = await request(app).get(path).expect(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    }
  });

  it('answers malformed JSON with VALIDATION_ERROR, not a stack trace', async () => {
    const res = await request(app).post('/api/v1/health').set('Content-Type', 'application/json').send('{"broken":').expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.text).not.toContain('SyntaxError');
  });

  it('rejects a body over 100 kB', async () => {
    const res = await request(app).post('/api/v1/health').send({ blob: 'x'.repeat(150_000) }).expect(422);
    expect(res.body.error.message).toBe('Request body is too large');
  });
});
