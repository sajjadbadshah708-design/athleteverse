// FR-1.24: list my sessions and sign out the others; the change takes effect on the very next request.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createDb } from '../src/db/prisma';
import { browser, createApp, createUser, PASSWORD } from './helpers/auth';
import { testDeps } from './helpers/app';
import { resetDb, TEST_DATABASE_URL } from './helpers/db';

const database = createDb(TEST_DATABASE_URL);
const prisma = database.prisma;
afterAll(() => database.close());
let app: Express;
let email: string;

async function device(name: string, client = 'web') {
  const agent = browser(app).set('User-Agent', name).set('X-Client', client);
  expect((await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
  return agent;
}

beforeEach(async () => {
  await resetDb();
  app = createApp(testDeps({ prisma }).deps);
  email = (await createUser(prisma)).email;
});

describe('GET /me/sessions', () => {
  it('lists every active session with its client and device, and marks the one asking', async () => {
    const laptop = await device('Laptop browser');
    await device('Phone', 'android');
    const list = await laptop.get('/api/v1/me/sessions');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    const byDevice = Object.fromEntries(list.body.items.map((s: { deviceName: string; client: string; current: boolean }) => [s.deviceName, s]));
    expect(byDevice['Laptop browser']).toMatchObject({ client: 'WEB', current: true });
    expect(byDevice.Phone).toMatchObject({ client: 'ANDROID', current: false });
    expect(JSON.stringify(list.body)).not.toMatch(/refresh|Hash/i); // no token material leaves the API
  });

  it("never shows another user's sessions", async () => {
    const mine = await device('Mine');
    const other = await createUser(prisma);
    expect((await browser(app).post('/api/v1/auth/login').send({ email: other.email, password: PASSWORD })).status).toBe(200);
    expect((await mine.get('/api/v1/me/sessions')).body.items).toHaveLength(1);
  });

  it('needs a signed-in user', async () => {
    expect((await browser(app).get('/api/v1/me/sessions')).status).toBe(401);
  });
});

describe('signing out other sessions', () => {
  it('ends one chosen session at once: its next request is refused and it cannot refresh', async () => {
    const laptop = await device('Laptop');
    const phone = await device('Phone');
    const phoneId = (await laptop.get('/api/v1/me/sessions')).body.items.find((s: { current: boolean }) => !s.current).id;
    expect((await laptop.post(`/api/v1/me/sessions/${phoneId}/revoke`)).status).toBe(200);
    expect((await phone.get('/api/v1/me')).status).toBe(401);
    expect((await phone.post('/api/v1/auth/refresh')).status).toBe(401);
    expect((await laptop.get('/api/v1/me')).status).toBe(200);
    expect((await laptop.post(`/api/v1/me/sessions/${phoneId}/revoke`)).status).toBe(404); // already ended
  });

  it('ends all the others and keeps the current one', async () => {
    const laptop = await device('Laptop');
    const phone = await device('Phone');
    const tablet = await device('Tablet');
    const result = await laptop.post('/api/v1/me/sessions/revoke-others');
    expect(result.body).toEqual({ ok: true, revoked: 2 });
    expect((await phone.get('/api/v1/me')).status).toBe(401);
    expect((await tablet.get('/api/v1/me')).status).toBe(401);
    expect((await laptop.get('/api/v1/me/sessions')).body.items).toHaveLength(1);
    expect((await laptop.post('/api/v1/me/sessions/revoke-others')).body.revoked).toBe(0);
  });

  it('refuses to end the current session this way (sign out is for that)', async () => {
    const laptop = await device('Laptop');
    const ownId = (await laptop.get('/api/v1/me/sessions')).body.items[0].id;
    const response = await laptop.post(`/api/v1/me/sessions/${ownId}/revoke`);
    expect(response.status).toBe(409);
    expect((await laptop.get('/api/v1/me')).status).toBe(200);
  });

  it("cannot touch another user's session: it answers 404 and leaves it running", async () => {
    const mine = await device('Mine');
    const other = await createUser(prisma);
    const theirs = browser(app);
    expect((await theirs.post('/api/v1/auth/login').send({ email: other.email, password: PASSWORD })).status).toBe(200);
    const theirId = (await theirs.get('/api/v1/me/sessions')).body.items[0].id;
    expect((await mine.post(`/api/v1/me/sessions/${theirId}/revoke`)).status).toBe(404);
    expect((await theirs.get('/api/v1/me')).status).toBe(200);
  });

  it('needs the client header, like every change', async () => {
    const laptop = await device('Laptop');
    const bare = await laptop.post('/api/v1/me/sessions/revoke-others').unset('X-Client');
    expect(bare.status).toBe(403);
  });
});
