// Transaction runner and row-lock helpers (Phase 2 "Transaction contracts"; SRS REL-1, FR-2.9, FR-2.24).
//
// Lock order for EVERY flow: users -> courts -> bookings. Locking in one global order is what prevents deadlocks;
// the helpers enforce it at runtime so a wrong order fails in tests instead of in production.
// Retry: a deadlock (40P01) or serialization failure (40001) re-runs the whole callback once.
// Because the callback can run twice it must do database work only: send e-mail or push AFTER withTx returns.
import type { Prisma, PrismaClient } from '@prisma/client';
import type { BookingStatus, PaymentStatus, Role, UserStatus } from '@athleteverse/shared';
import { isRetryable } from './pgErrors';

export type Tx = Prisma.TransactionClient;

export interface TxOptions {
  attempts?: number; // total tries including the first (default 2: "retry once")
  timeoutMs?: number; // whole-transaction limit (default 10 s)
  maxWaitMs?: number; // wait for a pooled connection (default 5 s)
  backoffMs?: () => number; // pause before a retry; jittered by default so two losers do not collide again
}

export async function withTx<T>(
  prisma: PrismaClient,
  fn: (tx: Tx, info: { attempt: number }) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 2;
  const backoff = opts.backoffMs ?? (() => 20 + Math.floor(Math.random() * 60));
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction((tx) => fn(tx, { attempt }), {
        timeout: opts.timeoutMs ?? 10_000,
        maxWait: opts.maxWaitMs ?? 5_000,
      });
    } catch (err) {
      if (attempt >= attempts || !isRetryable(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, backoff()));
    }
  }
}

// ---------- lock order ----------

const RANK = { user: 1, court: 2, booking: 3 } as const;
const highestLocked = new WeakMap<object, number>();

/** A programming error (never user-caused), so it is a plain Error and surfaces as a 500. */
export class LockOrderError extends Error {
  constructor(kind: string, held: number) {
    super(`Lock order violation: cannot lock a ${kind} after locking a row of rank ${held}. Order is users -> courts -> bookings.`);
    this.name = 'LockOrderError';
  }
}

function enter(tx: Tx, kind: keyof typeof RANK): void {
  const held = highestLocked.get(tx) ?? 0;
  if (RANK[kind] < held) throw new LockOrderError(kind, held);
  highestLocked.set(tx, RANK[kind]);
}

// ---------- row locks: SELECT ... FOR UPDATE, returning only what the flows read straight after locking ----------

export interface LockedUser {
  id: string;
  role: Role;
  status: UserStatus;
  creditScore: number;
  blockedAt: Date | null;
}

export async function lockUser(tx: Tx, id: string): Promise<LockedUser | null> {
  enter(tx, 'user');
  const rows = await tx.$queryRaw<LockedUser[]>`
    SELECT id, role, status, credit_score AS "creditScore", blocked_at AS "blockedAt"
      FROM users WHERE id = ${id}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

export interface LockedCourt {
  id: string;
  venueId: string;
  status: string;
}

export async function lockCourt(tx: Tx, id: string): Promise<LockedCourt | null> {
  enter(tx, 'court');
  const rows = await tx.$queryRaw<LockedCourt[]>`
    SELECT id, venue_id AS "venueId", status FROM courts WHERE id = ${id}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

export interface LockedBooking {
  id: string;
  courtId: string;
  playerId: string;
  startTime: Date;
  endTime: Date;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
}

export async function lockBooking(tx: Tx, id: string): Promise<LockedBooking | null> {
  enter(tx, 'booking');
  const rows = await tx.$queryRaw<LockedBooking[]>`
    SELECT id, court_id AS "courtId", player_id AS "playerId", start_time AS "startTime", end_time AS "endTime",
           status, payment_status AS "paymentStatus"
      FROM bookings WHERE id = ${id}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}
