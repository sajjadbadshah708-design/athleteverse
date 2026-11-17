import { pool } from './db';

let seq = 0;
const next = () => ++seq;

export type Role = 'PLAYER' | 'MANAGER' | 'STAFF' | 'ADMIN';

export async function insertUser(role: Role = 'PLAYER', extra: { email?: string; phone?: string } = {}): Promise<string> {
  const n = next();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, phone, role, status, full_name)
     VALUES ($1, $2, $3::user_role, 'ACTIVE', $4) RETURNING id`,
    [extra.email ?? `user${n}@athleteverse.test`, extra.phone ?? `9200${String(n).padStart(8, '0')}`, role, `User ${n}`],
  );
  return rows[0]!.id;
}

export interface World {
  cityId: number;
  sportId: number;
  managerId: string;
  venueId: string;
  court1: string;
  court2: string;
  player1: string;
  player2: string;
}

/** One city, sport, manager, venue (08-23), two courts and two players. */
export async function createWorld(): Promise<World> {
  const cityId = (await pool.query<{ id: number }>(`INSERT INTO cities (name) VALUES ('Test City') RETURNING id`)).rows[0]!.id;
  const sportId = (
    await pool.query<{ id: number }>(
      `INSERT INTO sports (name, min_team_size, max_team_size) VALUES ('Futsal', 5, 10) RETURNING id`,
    )
  ).rows[0]!.id;
  const managerId = await insertUser('MANAGER');
  const venueId = (
    await pool.query<{ id: string }>(
      `INSERT INTO venues (manager_id, name, address, city_id, phone, open_hour, close_hour)
       VALUES ($1, 'Test Arena', '1 Test St', $2, '920000000100', 8, 23) RETURNING id`,
      [managerId, cityId],
    )
  ).rows[0]!.id;
  const court1 = await insertCourt(venueId, sportId, 'Court 1');
  const court2 = await insertCourt(venueId, sportId, 'Court 2');
  return { cityId, sportId, managerId, venueId, court1, court2, player1: await insertUser(), player2: await insertUser() };
}

export async function insertCourt(venueId: string, sportId: number, name: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO courts (venue_id, sport_id, name, price_regular) VALUES ($1, $2, $3, 20) RETURNING id`,
    [venueId, sportId, name],
  );
  return rows[0]!.id;
}

export interface BookingInput {
  courtId: string;
  playerId: string;
  start: string; // ISO UTC
  end: string;
  status?: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
}

export function insertBooking(b: BookingInput) {
  const status = b.status ?? 'CONFIRMED';
  const cancelled = status === 'CANCELLED';
  return pool.query(
    `INSERT INTO bookings (booking_code, court_id, player_id, start_time, end_time, total_price, status, cancelled_at, cancelled_by)
     VALUES ($1, $2, $3, $4, $5, 20, $6::booking_status, $7, $8)`,
    [`BK${String(next()).padStart(6, '0')}`, b.courtId, b.playerId, b.start, b.end, status, cancelled ? new Date() : null, cancelled ? b.playerId : null],
  );
}

export const at = (hour: number, day = '2030-01-15') => `${day}T${String(hour).padStart(2, '0')}:00:00Z`;
