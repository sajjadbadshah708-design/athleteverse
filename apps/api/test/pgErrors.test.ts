// The retry logic depends on recognising SQLSTATEs in every shape Prisma can throw. The synthetic shapes below were
// captured from real errors with the pg driver adapter (see src/db/pgErrors.ts); the last block checks real ones.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/prisma';
import { SQLSTATE, constraintName, isRetryable, prismaCode, sqlState } from '../src/db/pgErrors';
import { TEST_DATABASE_URL, resetDb } from './helpers/db';
import { at, createWorld, type World } from './helpers/fixtures';

const adapterRawDeadlock = {
  code: 'P2010',
  meta: { driverAdapterError: { cause: { originalCode: '40P01', originalMessage: 'deadlock detected', kind: 'postgres' } } },
};
const adapterModelCheck = {
  name: 'DriverAdapterError',
  cause: { originalCode: '23514', originalMessage: 'new row for relation "users" violates check constraint "users_credit_score_range"' },
};
const adapterUnique = { code: 'P2002', meta: { driverAdapterError: { cause: { originalCode: '23505', kind: 'UniqueConstraintViolation' } } } };
const classicRaw = {
  code: 'P2010',
  meta: { code: '23P01' },
  message: 'Raw query failed. Code: `23P01`. Message: conflicting key value violates exclusion constraint "bookings_no_court_overlap"',
};
const classicTx = { code: 'P2034', message: 'Transaction failed due to a write conflict or a deadlock. Please retry your transaction' };
const nodePostgres = { code: '40001', constraint: undefined, message: 'could not serialize access' };

describe('sqlState', () => {
  it.each([
    ['adapter raw query', adapterRawDeadlock, '40P01'],
    ['adapter model operation', adapterModelCheck, '23514'],
    ['adapter unique violation', adapterUnique, '23505'],
    ['classic engine raw query', classicRaw, '23P01'],
    ['node-postgres', nodePostgres, '40001'],
    ['PL/pgSQL RAISE (P0001 is a real SQLSTATE)', { code: 'P0001' }, 'P0001'],
  ])('reads it from %s errors', (_label, err, expected) => {
    expect(sqlState(err)).toBe(expected);
  });

  it('ignores Prisma error codes and non-errors', () => {
    for (const v of [{ code: 'P2002' }, { code: 'P2034' }, new Error('plain'), null, undefined, 'text', 42, {}]) {
      expect(sqlState(v)).toBeUndefined();
    }
  });
});

describe('isRetryable', () => {
  it('retries deadlocks, serialization failures and Prisma P2034', () => {
    for (const err of [adapterRawDeadlock, nodePostgres, classicTx]) expect(isRetryable(err)).toBe(true);
  });

  it('does not retry constraint violations or unknown errors', () => {
    for (const err of [adapterModelCheck, adapterUnique, classicRaw, new Error('boom'), null, { code: 'P0001' }]) {
      expect(isRetryable(err)).toBe(false);
    }
  });

  it('exposes the prisma code separately', () => {
    expect(prismaCode(classicTx)).toBe('P2034');
    expect(prismaCode(nodePostgres)).toBeUndefined();
  });
});

describe('constraintName', () => {
  it('finds the constraint in every shape', () => {
    expect(constraintName(adapterModelCheck)).toBe('users_credit_score_range');
    expect(constraintName(classicRaw)).toBe('bookings_no_court_overlap');
    expect(constraintName({ code: '23505', constraint: 'users_email_key' })).toBe('users_email_key');
    expect(constraintName(new Error('nothing here'))).toBeUndefined();
  });
});

describe('real PostgreSQL errors through Prisma', () => {
  const db = createDb(TEST_DATABASE_URL);
  let w: World;
  beforeEach(async () => {
    await resetDb();
    w = await createWorld();
  });
  afterAll(() => db.close());

  const book = (playerId: string, courtId: string, code: string, start: string, end: string) =>
    db.prisma.booking.create({ data: { bookingCode: code, courtId, playerId, startTime: new Date(start), endTime: new Date(end), totalPrice: 20 } });

  it('identifies an exclusion violation and which constraint fired (needed for SLOT_TAKEN in T9)', async () => {
    await book(w.player1, w.court1, 'PGERR001', at(10), at(12));
    const courtClash = await book(w.player2, w.court1, 'PGERR002', at(11), at(12)).catch((e: unknown) => e);
    expect(sqlState(courtClash)).toBe(SQLSTATE.exclusionViolation);
    expect(constraintName(courtClash)).toBe('bookings_no_court_overlap');
    expect(isRetryable(courtClash)).toBe(false);

    const playerClash = await book(w.player1, w.court2, 'PGERR003', at(11), at(12)).catch((e: unknown) => e);
    expect(sqlState(playerClash)).toBe(SQLSTATE.exclusionViolation);
    expect(constraintName(playerClash)).toBe('bookings_no_player_overlap');
  });

  it('identifies check and unique violations', async () => {
    const check = await db.prisma.user.update({ where: { id: w.player1 }, data: { creditScore: 101 } }).catch((e: unknown) => e);
    expect(sqlState(check)).toBe(SQLSTATE.checkViolation);
    expect(constraintName(check)).toBe('users_credit_score_range');

    const other = await db.prisma.user.findUniqueOrThrow({ where: { id: w.player2 } });
    const dup = await db.prisma.user.update({ where: { id: w.player1 }, data: { email: other.email } }).catch((e: unknown) => e);
    expect(sqlState(dup)).toBe(SQLSTATE.uniqueViolation);
  });
});
