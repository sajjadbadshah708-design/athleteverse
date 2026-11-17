// T3 "Done when": a test shows a deadlock retry. Also: rollback, retry limits, row locks and the lock-order guard.
// Covers SRS REL-1 (ACID transactions), FR-2.9 and FR-2.24 (locking), Phase 2 "lock order users -> courts -> bookings".
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/prisma';
import { SQLSTATE, sqlState } from '../src/db/pgErrors';
import { LockOrderError, lockBooking, lockCourt, lockUser, withTx, type Tx } from '../src/db/tx';
import { AppError } from '../src/lib/errors';
import { TEST_DATABASE_URL, pool, resetDb } from './helpers/db';
import { at, createWorld, insertBooking, type World } from './helpers/fixtures';

const db = createDb(TEST_DATABASE_URL);
const prisma = db.prisma;
const noWait = { backoffMs: () => 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let w: World;
beforeEach(async () => {
  await resetDb();
  w = await createWorld();
});
afterAll(() => db.close());

const score = async (id: string) =>
  (await pool.query<{ credit_score: number }>(`SELECT credit_score FROM users WHERE id = $1`, [id])).rows[0]!.credit_score;

describe('withTx: commit, rollback, retry', () => {
  it('commits and returns the callback result', async () => {
    const result = await withTx(prisma, async (tx) => {
      await tx.$executeRaw`UPDATE users SET credit_score = 90 WHERE id = ${w.player1}::uuid`;
      return 'done';
    });
    expect(result).toBe('done');
    expect(await score(w.player1)).toBe(90);
  });

  it('rolls everything back when the callback throws, and rethrows the same error without retrying', async () => {
    let calls = 0;
    const failure = new AppError('FORBIDDEN', 'nope');
    const err = await withTx(prisma, async (tx) => {
      calls++;
      await tx.$executeRaw`UPDATE users SET credit_score = 50 WHERE id = ${w.player1}::uuid`;
      throw failure;
    }).catch((e: unknown) => e);
    expect(err).toBe(failure);
    expect(calls).toBe(1);
    expect(await score(w.player1)).toBe(100);
  });

  it('does not retry a constraint violation (REL-1)', async () => {
    let calls = 0;
    const err = await withTx(prisma, async (tx) => {
      calls++;
      await tx.$executeRaw`UPDATE users SET credit_score = 101 WHERE id = ${w.player1}::uuid`;
    }).catch((e: unknown) => e);
    expect(calls).toBe(1);
    expect(sqlState(err)).toBe(SQLSTATE.checkViolation);
  });

  it('retries ONCE after a real deadlock and both transactions complete', async () => {
    let waiting = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const bothHoldTheirFirstLock = async () => {
      if (++waiting === 2) release();
      await gate;
    };
    const attemptsSeen: number[] = [];

    // Two transactions lock the same two rows in opposite order: PostgreSQL aborts one with 40P01 after deadlock_timeout.
    const run = (first: string, second: string, label: string) =>
      withTx(
        prisma,
        async (tx, { attempt }) => {
          attemptsSeen.push(attempt);
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${first}::uuid FOR UPDATE`;
          if (attempt === 1) await bothHoldTheirFirstLock();
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${second}::uuid FOR UPDATE`;
          await tx.$executeRaw`UPDATE users SET credit_score = credit_score - 1 WHERE id = ${first}::uuid`;
          return label;
        },
        noWait,
      );

    const results = await Promise.all([run(w.player1, w.player2, 'A'), run(w.player2, w.player1, 'B')]);

    expect([...results].sort()).toEqual(['A', 'B']);
    expect(attemptsSeen.sort()).toEqual([1, 1, 2]); // exactly one transaction was re-run, once
    expect(await score(w.player1)).toBe(99); // each update applied exactly once
    expect(await score(w.player2)).toBe(99);
  }, 30_000);

  const retryableFailure = () => Object.assign(new Error('could not serialize access'), { cause: { originalCode: SQLSTATE.serializationFailure } });

  it('gives up after the attempt limit and throws the last error', async () => {
    let calls = 0;
    const err = await withTx(prisma, async () => {
      calls++;
      throw retryableFailure();
    }, noWait).catch((e: unknown) => e);
    expect(calls).toBe(2); // default: first try + one retry
    expect(sqlState(err)).toBe(SQLSTATE.serializationFailure);
  });

  it('honours a custom attempt limit, including 1 (no retry)', async () => {
    const count = async (attempts: number) => {
      let calls = 0;
      await withTx(prisma, async () => {
        calls++;
        throw retryableFailure();
      }, { ...noWait, attempts }).catch(() => undefined);
      return calls;
    };
    expect(await count(1)).toBe(1);
    expect(await count(3)).toBe(3);
  });

  it('succeeds when the retry succeeds', async () => {
    let calls = 0;
    const value = await withTx(prisma, async (_tx, { attempt }) => {
      calls++;
      if (attempt === 1) throw retryableFailure();
      return 'second time lucky';
    }, noWait);
    expect(value).toBe('second time lucky');
    expect(calls).toBe(2);
  });
});

describe('row locks (SELECT ... FOR UPDATE)', () => {
  it('lockUser returns the locked row with typed fields', async () => {
    const user = await withTx(prisma, (tx) => lockUser(tx, w.player1));
    expect(user).toEqual({ id: w.player1, role: 'PLAYER', status: 'ACTIVE', creditScore: 100, blockedAt: null });
  });

  it('lockCourt and lockBooking return what the flows read next', async () => {
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(10), end: at(12) });
    const bookingId = (await pool.query<{ id: string }>(`SELECT id FROM bookings`)).rows[0]!.id;
    const { court, booking } = await withTx(prisma, async (tx) => ({
      court: await lockCourt(tx, w.court1),
      booking: await lockBooking(tx, bookingId),
    }));
    expect(court).toEqual({ id: w.court1, venueId: w.venueId, status: 'ACTIVE' });
    expect(booking).toMatchObject({ id: bookingId, courtId: w.court1, playerId: w.player1, status: 'CONFIRMED', paymentStatus: 'PENDING' });
    expect(booking!.startTime).toEqual(new Date(at(10)));
    expect(booking!.endTime).toEqual(new Date(at(12)));
  });

  it('return null for an unknown id', async () => {
    const zero = '00000000-0000-0000-0000-000000000000';
    expect(await withTx(prisma, (tx) => lockUser(tx, zero))).toBeNull();
    expect(await withTx(prisma, (tx) => lockCourt(tx, zero))).toBeNull();
    expect(await withTx(prisma, (tx) => lockBooking(tx, zero))).toBeNull();
  });

  it('make a second transaction wait until the first commits', async () => {
    const events: string[] = [];
    let aHasLock!: () => void;
    const aLocked = new Promise<void>((r) => (aHasLock = r));
    let letAFinish!: () => void;
    const aMayFinish = new Promise<void>((r) => (letAFinish = r));

    const a = withTx(prisma, async (tx) => {
      await lockUser(tx, w.player1);
      events.push('A locked');
      aHasLock();
      await aMayFinish;
      events.push('A done');
    });
    await aLocked;
    const b = withTx(prisma, async (tx) => {
      events.push('B waiting');
      await lockUser(tx, w.player1);
      events.push('B locked');
    });
    while (!events.includes('B waiting')) await sleep(20); // B has started (a slow runner may take a moment)
    await sleep(300);
    expect(events).toEqual(['A locked', 'B waiting']); // ...and is still blocked on A's lock
    letAFinish();
    await Promise.all([a, b]);
    expect(events).toEqual(['A locked', 'B waiting', 'A done', 'B locked']);
  });
});

describe('lock order: users -> courts -> bookings', () => {
  it('allows the documented order, and several rows of the same kind', async () => {
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(10), end: at(11) });
    const bookingId = (await pool.query<{ id: string }>(`SELECT id FROM bookings`)).rows[0]!.id;
    await withTx(prisma, async (tx) => {
      await lockUser(tx, w.player1);
      await lockUser(tx, w.player2);
      await lockCourt(tx, w.court1);
      await lockCourt(tx, w.court2);
      await lockBooking(tx, bookingId);
    });
  });

  const wrongOrders: [string, (tx: Tx) => Promise<unknown>][] = [
    ['a user after a court', async (tx) => { await lockCourt(tx, w.court1); await lockUser(tx, w.player1); }],
    ['a court after a booking', async (tx) => { await lockBooking(tx, w.court1); await lockCourt(tx, w.court1); }],
    ['a user after a booking', async (tx) => { await lockBooking(tx, w.court1); await lockUser(tx, w.player1); }],
  ];
  it.each(wrongOrders)('refuses to lock %s', async (_label, wrongOrder) => {
    const err = await withTx(prisma, (tx) => wrongOrder(tx)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockOrderError);
  });

  it('tracks order per transaction, not globally', async () => {
    await withTx(prisma, (tx) => lockCourt(tx, w.court1));
    await withTx(prisma, (tx) => lockUser(tx, w.player1)); // a new transaction starts again at "no locks held"
  });
});
