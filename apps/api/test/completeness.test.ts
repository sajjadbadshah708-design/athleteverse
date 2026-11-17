// FR-1.15: the gate that later features (booking in T9, teams, tournaments) call.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDb } from '../src/db/prisma';
import { withTx } from '../src/db/tx';
import { defineRoute } from '../src/lib/route';
import { AUTH_ROUTES } from '../src/modules/auth/auth.routes';
import { assertProfileComplete } from '../src/modules/users/completeness';
import { PROFILE_ROUTES } from '../src/modules/users/profile.routes';
import { testDeps } from './helpers/app';
import { browser, createApp, createUser, PASSWORD } from './helpers/auth';
import { TEST_DATABASE_URL, resetDb } from './helpers/db';

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.close());
beforeEach(() => resetDb());

// A stand-in for "book a court": any route that needs a complete profile calls the same function.
const needsProfile = defineRoute({
  method: 'post',
  path: '/t/needs-profile',
  summary: 'stand-in for booking',
  tags: ['test'],
  srs: [],
  access: { roles: ['PLAYER'] },
  response: z.object({ ok: z.literal(true) }),
  async handler({ deps, auth }) {
    await assertProfileComplete(deps.prisma, auth.userId);
    return { ok: true as const };
  },
});

describe('assertProfileComplete', () => {
  it('refuses a player without a profile with PROFILE_INCOMPLETE, and admits one with a profile', async () => {
    const user = await createUser(db.prisma);
    await expect(assertProfileComplete(db.prisma, user.id)).rejects.toMatchObject({ code: 'PROFILE_INCOMPLETE', status: 403 });

    const city = await db.prisma.city.create({ data: { name: 'Demo City' } });
    await db.prisma.playerProfile.create({ data: { userId: user.id, cityId: city.id, dateOfBirth: new Date('2000-01-01T00:00:00Z') } });
    await expect(assertProfileComplete(db.prisma, user.id)).resolves.toBeUndefined();
  });

  it('works inside a transaction, so booking can call it next to its other checks', async () => {
    const user = await createUser(db.prisma);
    await expect(withTx(db.prisma, (tx) => assertProfileComplete(tx, user.id))).rejects.toMatchObject({ code: 'PROFILE_INCOMPLETE' });
  });

  it('turns into a 403 with the shared code on a real endpoint, until the profile is saved through the API', async () => {
    const t = testDeps({ prisma: db.prisma });
    const app = createApp(t.deps, [...AUTH_ROUTES, ...PROFILE_ROUTES, needsProfile]);
    const city = await db.prisma.city.create({ data: { name: 'Demo City' } });
    const user = await createUser(db.prisma);
    const agent = browser(app);
    await agent.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);

    const blocked = await agent.post('/api/v1/t/needs-profile').send({});
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PROFILE_INCOMPLETE');

    await agent.patch('/api/v1/me/profile').send({ cityId: city.id, dateOfBirth: '2000-01-01' }).expect(200);
    expect((await agent.post('/api/v1/t/needs-profile').send({})).body).toEqual({ ok: true });
  });
});
