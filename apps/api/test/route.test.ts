// defineRoute: validation, response filtering, error handling (SRS USA-3, SEC-4, FR-1.16, FR-5.17).
import { z } from 'zod';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { AppError } from '../src/lib/errors';
import { defineRoute } from '../src/lib/route';
import { testDeps } from './helpers/app';

const things = defineRoute({
  method: 'post',
  path: '/things/:id',
  summary: 'Create a thing',
  tags: ['test'],
  srs: ['FR-0.0'],
  access: 'public',
  status: 201,
  params: z.object({ id: z.uuid() }),
  query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
  body: z.object({ name: z.string().min(2).max(10), slots: z.number().int().min(1).max(3) }),
  response: z.object({ id: z.string(), name: z.string(), page: z.number() }),
  handler: ({ params, query, body }) => ({ id: params.id, name: body.name, page: query.page }),
});

const leaky = defineRoute({
  method: 'get',
  path: '/leaky',
  summary: 'Returns more than it declares',
  tags: ['test'],
  srs: [],
  access: 'public',
  response: z.object({ id: z.string() }),
  handler: () => ({ id: 'u1', passwordHash: '$2b$secret', dateOfBirth: '2000-01-01' }),
});

const broken = defineRoute({
  method: 'get',
  path: '/broken',
  summary: 'Returns the wrong shape',
  tags: ['test'],
  srs: [],
  access: 'public',
  response: z.object({ id: z.string() }),
  handler: () => ({ id: 42 }) as unknown as { id: string }, // deliberately wrong: the compiler would reject it otherwise
});

const denied = defineRoute({
  method: 'get',
  path: '/denied',
  summary: 'Always forbidden',
  tags: ['test'],
  srs: [],
  access: 'public',
  response: z.object({}),
  handler: () => {
    throw new AppError('FORBIDDEN', 'Not yours', { hint: 'ask the owner' });
  },
});

const crash = defineRoute({
  method: 'get',
  path: '/crash',
  summary: 'Throws an unexpected error',
  tags: ['test'],
  srs: [],
  access: 'public',
  response: z.object({}),
  handler: async () => {
    throw new Error('connection string postgres://user:hunter2@db/prod exploded');
  },
});

const ID = '3f2b6b1e-9d9c-4f0e-8d57-0c2b4f1a7a11';

function setup() {
  const t = testDeps();
  return { ...t, app: createApp(t.deps, [things, leaky, broken, denied, crash]) };
}

describe('validation', () => {
  it('passes parsed, typed values to the handler and honours the declared status', async () => {
    const { app } = setup();
    const res = await request(app).post(`/api/v1/things/${ID}?page=3`).set('X-Client', 'web').send({ name: 'Court', slots: 2 }).expect(201);
    expect(res.body).toEqual({ id: ID, name: 'Court', page: 3 }); // "3" became the number 3, default page would be 1
  });

  it('collects every problem from params, query and body with field paths', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/v1/things/not-a-uuid?page=0').set('X-Client', 'web').send({ name: 'x', slots: 9 }).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const issues = res.body.error.details.issues as { in: string; path: string }[];
    const where = issues.map((i) => `${i.in}:${i.path}`).sort();
    expect(where).toEqual(['body:name', 'body:slots', 'params:id', 'query:page']);
  });

  it('rejects a missing body', async () => {
    const { app } = setup();
    const res = await request(app).post(`/api/v1/things/${ID}`).set('X-Client', 'web').expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('responses', () => {
  it('sends only declared fields, so a password hash cannot leak (FR-1.16)', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/v1/leaky').expect(200);
    expect(res.body).toEqual({ id: 'u1' });
  });

  it('turns a response that breaks its schema into a generic 500 and logs the details', async () => {
    const { app, logs } = setup();
    const res = await request(app).get('/api/v1/broken').expect(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
    const log = logs.find((l) => l.msg === 'response does not match its schema');
    expect(log).toMatchObject({ route: 'GET /broken' });
  });
});

describe('error handling', () => {
  it('returns deliberate 4xx errors with their code, message and details', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/v1/denied').expect(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Not yours', details: { hint: 'ask the owner' } } });
  });

  it('hides unexpected errors from the client but logs them with the request id', async () => {
    const { app, logs } = setup();
    const res = await request(app).get('/api/v1/crash').set('X-Request-Id', 'req-crash-0001').expect(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
    expect(res.text).not.toContain('hunter2');
    const log = logs.find((l) => l.msg === 'unhandled error');
    expect(log).toMatchObject({ requestId: 'req-crash-0001' });
    expect(JSON.stringify(log)).toContain('exploded');
  });
});
