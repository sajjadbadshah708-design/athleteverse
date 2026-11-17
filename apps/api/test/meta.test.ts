import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/prisma';
import { testDeps } from './helpers/app';
import { createApp } from './helpers/auth';
import { TEST_DATABASE_URL, resetDb } from './helpers/db';

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.close());
beforeEach(() => resetDb());

const appFor = () => createApp(testDeps({ prisma: db.prisma }).deps);

describe('GET /api/v1/meta/cities and /meta/sports (public reference data)', () => {
  it('lists only active cities, alphabetically, without needing a sign-in', async () => {
    await db.prisma.city.createMany({ data: [{ name: 'Zeta City' }, { name: 'Alpha City' }, { name: 'Closed City', isActive: false }] });
    const res = await request(appFor()).get('/api/v1/meta/cities').expect(200);
    expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(['Alpha City', 'Zeta City']);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['id', 'name']);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('lists active sports with their team sizes, alphabetically', async () => {
    await db.prisma.sport.createMany({
      data: [
        { name: 'Futsal', minTeamSize: 5, maxTeamSize: 10 },
        { name: 'Badminton', minTeamSize: 2, maxTeamSize: 4 },
        { name: 'Retired', minTeamSize: 1, maxTeamSize: 2, isActive: false },
      ],
    });
    const res = await request(appFor()).get('/api/v1/meta/sports').expect(200);
    expect(res.body.items).toEqual([
      { id: expect.any(Number), name: 'Badminton', minTeamSize: 2, maxTeamSize: 4 },
      { id: expect.any(Number), name: 'Futsal', minTeamSize: 5, maxTeamSize: 10 },
    ]);
  });

  it('answers with an empty list, not an error, when nothing is configured yet', async () => {
    const app = appFor();
    expect((await request(app).get('/api/v1/meta/cities')).body).toEqual({ items: [] });
    expect((await request(app).get('/api/v1/meta/sports')).body).toEqual({ items: [] });
  });
});
