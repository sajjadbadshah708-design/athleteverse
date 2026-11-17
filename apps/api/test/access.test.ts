// FR-1.11, FR-1.12 (role checks, refused attempts logged), SEC-1 (X-Client on state-changing requests), SEC-3 (deny by default).
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDb } from '../src/db/prisma';
import { defineRoute } from '../src/lib/route';
import { AUTH_ROUTES } from '../src/modules/auth/auth.routes';
import { TEST_JOB_SECRET, testDeps } from './helpers/app';
import { browser, cookieValue, createApp, createUser, PASSWORD } from './helpers/auth';
import { TEST_DATABASE_URL, resetDb } from './helpers/db';

const meta = { tags: ['test'], srs: [], summary: 'test route' };
const who = z.object({ userId: z.string(), role: z.string() });

const publicRoute = defineRoute({ ...meta, method: 'get', path: '/t/public', access: 'public', response: z.object({ open: z.literal(true) }), handler: () => ({ open: true as const }) });
const playerRoute = defineRoute({ ...meta, method: 'get', path: '/t/player', access: { roles: ['PLAYER'] }, response: who, handler: ({ auth }) => ({ userId: auth.userId, role: auth.role }) });
const anyRoleRoute = defineRoute({ ...meta, method: 'get', path: '/t/any', access: { roles: ['PLAYER', 'MANAGER', 'STAFF', 'ADMIN'] }, response: who, handler: ({ auth }) => ({ userId: auth.userId, role: auth.role }) });
const pendingOkRoute = defineRoute({ ...meta, method: 'get', path: '/t/pending-ok', access: { roles: ['MANAGER'], statuses: ['ACTIVE', 'PENDING_APPROVAL'] }, response: who, handler: ({ auth }) => ({ userId: auth.userId, role: auth.role }) });
const createRoute = defineRoute({
  ...meta, method: 'post', path: '/t/create', access: { roles: ['PLAYER'] }, body: z.object({ n: z.number().int().min(1) }),
  response: z.object({ n: z.number() }), handler: ({ body }) => ({ n: body.n }),
});

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.close());

let t: ReturnType<typeof testDeps>;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  await resetDb();
  t = testDeps({ prisma: db.prisma });
  app = createApp(t.deps, [...AUTH_ROUTES, publicRoute, playerRoute, anyRoleRoute, pendingOkRoute, createRoute]); // real sign-in plus the test routes
});

async function signIn(opts: Parameters<typeof createUser>[1] = {}) {
  const user = await createUser(db.prisma, opts);
  const agent = browser(app);
  const res = await agent.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
  return { user, agent, cookie: `av_access=${cookieValue(res, 'av_access')}` };
}

describe('who may call a route', () => {
  it('lets anyone call a public route and nobody anonymous call a protected one', async () => {
    expect((await request(app).get('/api/v1/t/public')).status).toBe(200);
    const res = await request(app).get('/api/v1/t/player');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('admits the listed role and gives the handler the caller\'s identity', async () => {
    const { agent, user } = await signIn();
    const res = await agent.get('/api/v1/t/player');
    expect(res.body).toEqual({ userId: user.id, role: 'PLAYER' });
  });

  it('refuses another role with 403 and logs the attempt (FR-1.12)', async () => {
    const { agent, user } = await signIn({ role: 'MANAGER' });
    const res = await agent.get('/api/v1/t/player');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const log = t.logs.find((l) => l.msg === 'access denied');
    expect(log).toMatchObject({ userId: user.id, role: 'MANAGER', route: 'GET /t/player' });
  });

  it('checks the account status: ACTIVE only unless the route lists more', async () => {
    const { agent } = await signIn({ role: 'MANAGER', status: 'PENDING_APPROVAL' });
    const refused = await agent.get('/api/v1/t/any');
    expect(refused.status).toBe(403);
    expect(refused.body.error.details).toEqual({ status: 'PENDING_APPROVAL' });
    expect((await agent.get('/api/v1/t/pending-ok')).status).toBe(200);
  });

  it('answers 401 before it says anything about the payload, then 422 for a signed-in caller with a bad body', async () => {
    expect((await request(app).post('/api/v1/t/create').set('X-Client', 'web').send({ n: 'x' })).status).toBe(401);
    const { agent } = await signIn();
    const bad = await agent.post('/api/v1/t/create').send({ n: 'x' });
    expect(bad.status).toBe(422);
    expect((await agent.post('/api/v1/t/create').send({ n: 3 })).body).toEqual({ n: 3 });
  });
});

describe('the X-Client header on state-changing requests (SEC-1)', () => {
  it('is required, even for a signed-in caller', async () => {
    const { cookie } = await signIn();
    const without = await request(app).post('/api/v1/t/create').set('Cookie', cookie).send({ n: 1 });
    expect(without.status).toBe(403);
    expect(without.body.error).toMatchObject({ code: 'FORBIDDEN', message: 'Missing or invalid X-Client header' });
    expect((await request(app).post('/api/v1/t/create').set('Cookie', cookie).set('X-Client', 'toaster').send({ n: 1 })).status).toBe(403);
  });

  it.each(['web', 'WEB', 'android', 'iOS'])('accepts "%s"', async (client) => {
    const { cookie } = await signIn();
    expect((await request(app).post('/api/v1/t/create').set('Cookie', cookie).set('X-Client', client).send({ n: 1 })).status).toBe(200);
  });

  it('is not needed for reading, nor for the secret-protected job endpoint', async () => {
    const { cookie } = await signIn();
    expect((await request(app).get('/api/v1/t/player').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).post('/api/jobs/tick').set('X-Job-Secret', TEST_JOB_SECRET)).status).toBe(200);
  });

  it('blocks a sign-in attempt that does not name its client (login CSRF)', async () => {
    const user = await createUser(db.prisma);
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
  });
});
