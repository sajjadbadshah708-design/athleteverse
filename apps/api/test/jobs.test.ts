// T4 "Done when": the cron call without the secret returns 401. Also: job isolation and idempotent-friendly results (REL-3).
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { secretsMatch } from '../src/lib/secret';
import { runTick, type Job } from '../src/modules/jobs/tick';
import { TEST_JOB_SECRET, testDeps } from './helpers/app';

const countingPrisma = () => {
  const state = { queries: 0 };
  return { state, prisma: { $queryRaw: async () => (state.queries++, []) } as unknown as PrismaClient };
};

describe('POST /api/jobs/tick', () => {
  it('rejects a call without the secret header with 401 and the error envelope', async () => {
    const { deps, logs } = testDeps();
    const res = await request(createApp(deps)).post('/api/jobs/tick').expect(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or missing job secret' } });
    expect(logs.some((l) => l.msg === 'job tick rejected')).toBe(true);
  });

  it('rejects a wrong secret, including one of a different length, and never logs it', async () => {
    const { deps, logs } = testDeps();
    const app = createApp(deps);
    for (const wrong of ['nope', TEST_JOB_SECRET + 'x', TEST_JOB_SECRET.slice(0, -1), TEST_JOB_SECRET.toUpperCase()]) {
      await request(app).post('/api/jobs/tick').set('X-Job-Secret', wrong).expect(401);
    }
    expect(JSON.stringify(logs)).not.toContain('nope');
    expect(JSON.stringify(logs)).not.toContain(TEST_JOB_SECRET);
  });

  it('rejects everything when no secret is configured, even a header that looks plausible', async () => {
    const { deps } = testDeps({}, { JOB_SECRET: '' });
    expect(deps.env.JOB_SECRET).toBeUndefined();
    await request(createApp(deps)).post('/api/jobs/tick').set('X-Job-Secret', 'anything-at-all-0123456789abcdef0123').expect(401);
  });

  it('accepts the right secret and allows explicitly empty jobs without touching the database', async () => {
    const { state, prisma } = countingPrisma();
    const { deps, clock } = testDeps({ prisma });
    const res = await request(createApp(deps, undefined, [])).post('/api/jobs/tick').set('X-Job-Secret', TEST_JOB_SECRET).expect(200);
    expect(res.body).toEqual({ ok: true, ranAt: clock.now().toISOString(), jobs: [] });
    expect(state.queries).toBe(0);
  });

  it('runs registered jobs in order and reports each result', async () => {
    const order: string[] = [];
    const jobs: Job[] = [
      { name: 'first', run: async () => (order.push('first'), 3) },
      { name: 'second', run: async () => (order.push('second'), 0) },
    ];
    const res = await request(createApp(testDeps().deps, [], jobs)).post('/api/jobs/tick').set('X-Job-Secret', TEST_JOB_SECRET).expect(200);
    expect(order).toEqual(['first', 'second']);
    expect(res.body.ok).toBe(true);
    expect(res.body.jobs).toMatchObject([
      { name: 'first', ok: true, affected: 3 },
      { name: 'second', ok: true, affected: 0 },
    ]);
  });
});

describe('runTick', () => {
  it('keeps going after a failing job, reports ok=false, and hides the error detail from the caller', async () => {
    const { deps, logs } = testDeps();
    const ran: string[] = [];
    const jobs: Job[] = [
      { name: 'broken', run: async () => { throw new Error('connection string postgres://u:hunter2@db exploded'); } },
      { name: 'healthy', run: async () => (ran.push('healthy'), 1) },
    ];
    const result = await runTick(deps, jobs);
    expect(ran).toEqual(['healthy']); // the second job still ran
    expect(result.ok).toBe(false);
    expect(result.jobs[0]).toMatchObject({ name: 'broken', ok: false, error: 'failed' });
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(JSON.stringify(logs.find((l) => l.msg === 'job failed'))).toContain('exploded'); // detail stays in the server log
  });

  it('runs database jobs at most every JOB_DB_INTERVAL_MINUTES, other jobs on every tick (decision Q5)', async () => {
    const { deps, clock } = testDeps({}, { JOB_DB_INTERVAL_MINUTES: '30' });
    const ran: string[] = [];
    const jobs: Job[] = [
      { name: 'db', touchesDatabase: true, run: async () => (ran.push('db'), 1) },
      { name: 'memory', run: async () => (ran.push('memory'), 0) },
    ];
    const state = {};
    const tickAt = async (iso: string) => { clock.set(iso); return runTick(deps, jobs, state); };
    expect((await tickAt('2030-01-15T12:00:00.000Z')).jobs.map((j) => j.skipped ?? false)).toEqual([false, false]);
    const skipped = await tickAt('2030-01-15T12:10:00.000Z');
    expect(skipped.ok).toBe(true); // a skipped job is not a failure: the workflow stays green
    expect(skipped.jobs[0]).toMatchObject({ name: 'db', ok: true, affected: 0, skipped: true });
    await tickAt('2030-01-15T12:20:00.000Z');
    await tickAt('2030-01-15T12:30:00.000Z'); // 30 minutes after the last database run: due again
    expect(ran).toEqual(['db', 'memory', 'memory', 'memory', 'db', 'memory']);
  });

  it('runs every job on every tick when the interval is 0 (the default for development and tests)', async () => {
    const { deps, clock } = testDeps();
    let runs = 0;
    const job: Job = { name: 'db', touchesDatabase: true, run: async () => (runs++, 0) };
    const state = {};
    await runTick(deps, [job], state);
    clock.set('2030-01-15T12:01:00.000Z');
    await runTick(deps, [job], state);
    expect(runs).toBe(2);
  });

  it('can run twice in a row (idempotent jobs make a repeated tick harmless, REL-3)', async () => {
    const { deps } = testDeps();
    let remaining = 2;
    const job: Job = { name: 'drain', run: async () => { const n = remaining; remaining = 0; return n; } };
    expect((await runTick(deps, [job])).jobs[0]!.affected).toBe(2);
    expect((await runTick(deps, [job])).jobs[0]!.affected).toBe(0);
  });
});

describe('secretsMatch', () => {
  it('is true only for identical non-empty secrets', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true);
    for (const [a, b] of [['abc', 'abd'], ['abc', 'abcd'], ['', ''], [undefined, 'abc'], ['abc', undefined], [undefined, undefined]] as const) {
      expect(secretsMatch(a, b)).toBe(false);
    }
  });
});
