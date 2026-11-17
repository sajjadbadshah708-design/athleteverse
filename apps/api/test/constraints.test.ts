// T2 "Done when": raw-SQL overlaps fail with 23P01 for court, player and block; audit_logs rejects UPDATE/DELETE.
// Covers SRS FR-2.9 (layer 3 of the three-layer protection), Table 30, SEC-8, rule 5.
import { beforeEach, describe, expect, it } from 'vitest';
import { SQLSTATE, dbError, pool, resetDb } from './helpers/db';
import { at, createWorld, insertBooking, insertCourt, insertUser, type World } from './helpers/fixtures';

let w: World;
beforeEach(async () => {
  await resetDb();
  w = await createWorld();
});

describe('bookings: no double booking at database level (FR-2.9)', () => {
  it('rejects an overlapping active booking on the same court (23P01)', async () => {
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(10), end: at(12) });
    const err = await dbError(insertBooking({ courtId: w.court1, playerId: w.player2, start: at(11), end: at(12) }));
    expect(err.code).toBe(SQLSTATE.exclusion);
    expect(err.constraint).toBe('bookings_no_court_overlap');
  });

  it('allows back-to-back bookings (ranges are half-open)', async () => {
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(10), end: at(11) });
    await insertBooking({ courtId: w.court1, playerId: w.player2, start: at(11), end: at(12) });
  });

  it('allows the same time on a different court', async () => {
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(10), end: at(11) });
    await insertBooking({ courtId: w.court2, playerId: w.player2, start: at(10), end: at(11) });
  });

  it('frees the slot when a booking is CANCELLED or NO_SHOW', async () => {
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(10), end: at(11), status: 'CANCELLED' });
    await insertBooking({ courtId: w.court1, playerId: w.player2, start: at(10), end: at(11), status: 'NO_SHOW' });
    await insertBooking({ courtId: w.court1, playerId: w.player2, start: at(10), end: at(11) });
  });

  it('keeps COMPLETED bookings blocking the slot', async () => {
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(10), end: at(11), status: 'COMPLETED' });
    const err = await dbError(insertBooking({ courtId: w.court1, playerId: w.player2, start: at(10), end: at(11) }));
    expect(err.code).toBe(SQLSTATE.exclusion);
  });

  it('rejects one player holding two overlapping bookings on different courts (N3)', async () => {
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(10), end: at(12) });
    const err = await dbError(insertBooking({ courtId: w.court2, playerId: w.player1, start: at(11), end: at(12) }));
    expect(err.code).toBe(SQLSTATE.exclusion);
    expect(err.constraint).toBe('bookings_no_player_overlap');
  });

  it('lets exactly one of two simultaneous inserts win (scenario 1, database layer only)', async () => {
    const results = await Promise.allSettled([
      insertBooking({ courtId: w.court1, playerId: w.player1, start: at(15), end: at(16) }),
      insertBooking({ courtId: w.court1, playerId: w.player2, start: at(15), end: at(16) }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((failed.reason as { code: string }).code).toBe(SQLSTATE.exclusion);
  });

  it.each([
    ['30 minutes', at(10), '2030-01-15T10:30:00Z'],
    ['90 minutes', at(10), '2030-01-15T11:30:00Z'],
    ['4 hours', at(10), at(14)],
    ['zero length', at(10), at(10)],
  ])('rejects a %s booking (1 to 3 whole hours only)', async (_label, start, end) => {
    const err = await dbError(insertBooking({ courtId: w.court1, playerId: w.player1, start, end }));
    expect(err.code).toBe(SQLSTATE.check);
    expect(err.constraint).toBe('bookings_valid_duration');
  });

  it('accepts 1, 2 and 3 hour bookings', async () => {
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(8), end: at(9) });
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(10), end: at(12) });
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(14), end: at(17) });
  });

  it('requires an amount exactly when payment is PAID', async () => {
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(10), end: at(11) });
    const paidNoAmount = await dbError(pool.query(`UPDATE bookings SET payment_status = 'PAID'`));
    expect(paidNoAmount.constraint).toBe('bookings_paid_has_amount');
    const amountNotPaid = await dbError(pool.query(`UPDATE bookings SET amount_received = 20`));
    expect(amountNotPaid.constraint).toBe('bookings_paid_has_amount');
    await pool.query(`UPDATE bookings SET payment_status = 'PAID', amount_received = 20`);
  });

  it('requires cancel details on a CANCELLED booking', async () => {
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(10), end: at(11) });
    const err = await dbError(pool.query(`UPDATE bookings SET status = 'CANCELLED'`));
    expect(err.constraint).toBe('bookings_cancel_fields');
  });

  it('enforces unique booking codes', async () => {
    await pool.query(
      `INSERT INTO bookings (booking_code, court_id, player_id, start_time, end_time, total_price) VALUES ('CODE0001', $1, $2, $3, $4, 20)`,
      [w.court1, w.player1, at(8), at(9)],
    );
    const err = await dbError(
      pool.query(
        `INSERT INTO bookings (booking_code, court_id, player_id, start_time, end_time, total_price) VALUES ('CODE0001', $1, $2, $3, $4, 20)`,
        [w.court2, w.player2, at(8), at(9)],
      ),
    );
    expect(err.code).toBe(SQLSTATE.unique);
  });
});

describe('court_blocks (N1)', () => {
  const block = (courtId: string, start: string, end: string) =>
    pool.query(`INSERT INTO court_blocks (court_id, start_time, end_time, reason, created_by) VALUES ($1, $2, $3, 'MANAGER', $4)`, [
      courtId, start, end, w.managerId,
    ]);

  it('rejects overlapping blocks on the same court, not merely identical ones (23P01)', async () => {
    await block(w.court1, at(10), at(13));
    const err = await dbError(block(w.court1, at(12), at(14)));
    expect(err.code).toBe(SQLSTATE.exclusion);
    expect(err.constraint).toBe('blocks_no_overlap');
  });

  it('allows adjacent blocks and other courts', async () => {
    await block(w.court1, at(10), at(12));
    await block(w.court1, at(12), at(14));
    await block(w.court2, at(10), at(12));
  });

  it('rejects an empty or reversed range', async () => {
    const err = await dbError(block(w.court1, at(12), at(10)));
    expect(err.constraint).toBe('blocks_valid_range');
  });
});

describe('users and credit score (Table 30)', () => {
  it.each([101, -1])('rejects credit_score %i', async (score) => {
    const err = await dbError(pool.query(`UPDATE users SET credit_score = $1 WHERE id = $2`, [score, w.player1]));
    expect(err.code).toBe(SQLSTATE.check);
    expect(err.constraint).toBe('users_credit_score_range');
  });

  it('accepts the 0 floor and the 100 cap', async () => {
    await pool.query(`UPDATE users SET credit_score = 0 WHERE id = $1`, [w.player1]);
    await pool.query(`UPDATE users SET credit_score = 100 WHERE id = $1`, [w.player1]);
  });

  it('starts every account at 100', async () => {
    const { rows } = await pool.query(`SELECT credit_score FROM users WHERE id = $1`, [w.player1]);
    expect(rows[0].credit_score).toBe(100);
  });

  it('rejects a duplicate e-mail or phone (FR-1.2)', async () => {
    await insertUser('PLAYER', { email: 'dup@athleteverse.test', phone: '921111111111' });
    const email = await dbError(insertUser('PLAYER', { email: 'dup@athleteverse.test', phone: '922222222222' }));
    expect(email.code).toBe(SQLSTATE.unique);
    const phone = await dbError(insertUser('PLAYER', { email: 'other@athleteverse.test', phone: '921111111111' }));
    expect(phone.code).toBe(SQLSTATE.unique);
  });

  it('stores e-mail lower-case and phone as 9 to 15 digits', async () => {
    expect((await dbError(insertUser('PLAYER', { email: 'Mixed@Athleteverse.test' }))).constraint).toBe('users_email_lowercase');
    expect((await dbError(insertUser('PLAYER', { phone: '12345678' }))).constraint).toBe('users_phone_digits');
    expect((await dbError(insertUser('PLAYER', { phone: '+9212345678' }))).constraint).toBe('users_phone_digits');
    expect((await dbError(insertUser('PLAYER', { phone: '1234567890123456' }))).constraint).toBe('users_phone_digits');
  });

  it('allows is_owner only on ADMIN accounts (SA-1)', async () => {
    const err = await dbError(pool.query(`UPDATE users SET is_owner = true WHERE id = $1`, [w.player1]));
    expect(err.constraint).toBe('users_owner_is_admin');
    const admin = await insertUser('ADMIN');
    await pool.query(`UPDATE users SET is_owner = true WHERE id = $1`, [admin]);
  });
});

describe('credit ledger (FR-2.24)', () => {
  const event = (bookingId: string | null, type: string, score = 90) =>
    pool.query(
      `INSERT INTO credit_events (user_id, booking_id, event_type, points, score_after) VALUES ($1, $2, $3::credit_event_type, -10, $4)`,
      [w.player1, bookingId, type, score],
    );

  async function oneBooking(): Promise<string> {
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(10), end: at(11) });
    return (await pool.query<{ id: string }>(`SELECT id FROM bookings`)).rows[0]!.id;
  }

  it('applies a given event type at most once per booking (23505)', async () => {
    const id = await oneBooking();
    await event(id, 'LATE_CANCEL');
    const err = await dbError(event(id, 'LATE_CANCEL'));
    expect(err.code).toBe(SQLSTATE.unique);
  });

  it('allows different event types on one booking', async () => {
    const id = await oneBooking();
    await event(id, 'LATE_CANCEL');
    await event(id, 'REVERSAL');
  });

  it('does not constrain events without a booking (known gap N2, handled in the credit engine)', async () => {
    await event(null, 'AUTO_RESTORE', 20);
    await event(null, 'AUTO_RESTORE', 20);
  });

  it('keeps score_after within 0..100', async () => {
    expect((await dbError(event(null, 'ADMIN_ADJUST', 101))).constraint).toBe('credit_events_score_after_range');
    expect((await dbError(event(null, 'ADMIN_ADJUST', -1))).constraint).toBe('credit_events_score_after_range');
  });
});

describe('venues and courts', () => {
  const venue = (name: string, cityId: number, open = 8, close = 23, peak: [number | null, number | null] = [null, null]) =>
    pool.query(
      `INSERT INTO venues (manager_id, name, address, city_id, phone, open_hour, close_hour, peak_start_hour, peak_end_hour)
       VALUES ($1, $2, 'addr', $3, '920000000101', $4, $5, $6, $7)`,
      [w.managerId, name, cityId, open, close, peak[0], peak[1]],
    );

  it('keeps venue names unique within a city, case-insensitively', async () => {
    const err = await dbError(venue('TEST ARENA', w.cityId));
    expect(err.code).toBe(SQLSTATE.unique);
    const other = (await pool.query<{ id: number }>(`INSERT INTO cities (name) VALUES ('Other City') RETURNING id`)).rows[0]!.id;
    await venue('Test Arena', other);
  });

  it('keeps court names unique within a venue, case-insensitively', async () => {
    const err = await dbError(insertCourt(w.venueId, w.sportId, 'COURT 1'));
    expect(err.code).toBe(SQLSTATE.unique);
  });

  it('validates opening hours (whole hours, closing after opening, up to 24)', async () => {
    await venue('Late Arena', w.cityId, 8, 24); // closing at 24:00 is allowed
    expect((await dbError(venue('Bad One', w.cityId, 10, 10))).constraint).toBe('venues_hours_valid');
    expect((await dbError(venue('Bad Two', w.cityId, 10, 9))).constraint).toBe('venues_hours_valid');
    expect((await dbError(venue('Bad Three', w.cityId, 8, 25))).constraint).toBe('venues_hours_valid');
  });

  it('validates the optional peak window', async () => {
    await venue('Peak Arena', w.cityId, 8, 23, [18, 23]);
    expect((await dbError(venue('Peak Bad 1', w.cityId, 8, 23, [7, 20]))).constraint).toBe('venues_peak_valid'); // starts before opening
    expect((await dbError(venue('Peak Bad 2', w.cityId, 8, 23, [18, 24]))).constraint).toBe('venues_peak_valid'); // ends after closing
    expect((await dbError(venue('Peak Bad 3', w.cityId, 8, 23, [18, null]))).constraint).toBe('venues_peak_valid'); // half set
  });

  it('requires positive prices', async () => {
    const err = await dbError(pool.query(`UPDATE courts SET price_regular = 0 WHERE id = $1`, [w.court1]));
    expect(err.constraint).toBe('courts_price_regular_positive');
    const peak = await dbError(pool.query(`UPDATE courts SET price_peak = 0 WHERE id = $1`, [w.court1]));
    expect(peak.constraint).toBe('courts_price_peak_positive');
  });
});

describe('audit_logs is append-only (SEC-8, SA-12)', () => {
  it('accepts inserts and rejects UPDATE and DELETE', async () => {
    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, reason) VALUES ($1, 'TEST', 'user', 'x', 'because')`,
      [w.managerId],
    );
    const upd = await dbError(pool.query(`UPDATE audit_logs SET reason = 'tampered'`));
    expect(upd.message).toContain('append-only');
    const del = await dbError(pool.query(`DELETE FROM audit_logs`));
    expect(del.message).toContain('append-only');
    const { rows } = await pool.query(`SELECT reason FROM audit_logs`);
    expect(rows).toEqual([{ reason: 'because' }]);
  });
});

describe('referential integrity (SRS 10.1: no cascading deletes)', () => {
  it('uses ON DELETE RESTRICT on every foreign key', async () => {
    const { rows } = await pool.query<{ table_name: string; constraint_name: string; delete_rule: string }>(
      `SELECT tc.table_name, tc.constraint_name, rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
    );
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter((r) => r.delete_rule !== 'RESTRICT')).toEqual([]);
  });

  it('refuses to delete a user who has bookings (23503)', async () => {
    await insertBooking({ courtId: w.court1, playerId: w.player1, start: at(10), end: at(11) });
    const err = await dbError(pool.query(`DELETE FROM users WHERE id = $1`, [w.player1]));
    expect(err.code).toBe(SQLSTATE.foreignKey);
  });
});

describe('schema shape', () => {
  it('has exactly the 15 MVP tables (Phase 2 section 2)', async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      'audit_logs', 'auth_tokens', 'bookings', 'cities', 'court_blocks', 'courts', 'credit_events',
      'manager_profiles', 'player_profiles', 'settings', 'sports', 'staff_profiles', 'user_sessions', 'users', 'venues',
    ]);
  });

  it('uses timestamptz for every timestamp column (rule 5: UTC)', async () => {
    const { rows } = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type LIKE 'timestamp%' AND data_type <> 'timestamp with time zone'`,
    );
    expect(rows).toEqual([]);
  });
});
