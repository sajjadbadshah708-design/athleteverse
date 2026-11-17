// Reads PostgreSQL error details out of whatever Prisma throws. Shapes observed with the pg driver adapter:
//   raw query failure    -> PrismaClientKnownRequestError P2010, meta.driverAdapterError.cause.originalCode = SQLSTATE
//   model operation      -> DriverAdapterError, cause.originalCode = SQLSTATE   (no `code` at all)
//   unique via model op  -> PrismaClientKnownRequestError P2002, meta.driverAdapterError.cause.originalCode = '23505'
// A deadlock inside $transaction arrives as P2010/40P01, NOT P2034, so retry decisions must use the SQLSTATE.
// The classic-engine shapes (meta.code, "Code: `...`" in the message, P2034) and node-postgres errors are handled too.

type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => typeof v === 'object' && v !== null;
const dig = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((acc, key) => (isObject(acc) ? acc[key] : undefined), value);

export const SQLSTATE = {
  deadlock: '40P01',
  serializationFailure: '40001',
  exclusionViolation: '23P01',
  uniqueViolation: '23505',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
} as const;

const SQLSTATE_RE = /^[0-9A-Z]{5}$/;
const PRISMA_CODE_RE = /^P[1-9]\d{3}$/; // P2010, P2034 ... (PL/pgSQL's own P0001 is a real SQLSTATE and is kept)

export function sqlState(err: unknown): string | undefined {
  const candidates = [
    dig(err, 'meta', 'driverAdapterError', 'cause', 'originalCode'),
    dig(err, 'cause', 'originalCode'),
    dig(err, 'originalCode'),
    dig(err, 'meta', 'code'),
    dig(err, 'code'),
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && SQLSTATE_RE.test(c) && !PRISMA_CODE_RE.test(c)) return c;
  }
  const message = dig(err, 'message');
  return typeof message === 'string' ? /Code: `([0-9A-Z]{5})`/.exec(message)?.[1] : undefined;
}

export function prismaCode(err: unknown): string | undefined {
  const code = dig(err, 'code');
  return typeof code === 'string' && PRISMA_CODE_RE.test(code) ? code : undefined;
}

/** Name of the violated constraint, e.g. "bookings_no_court_overlap" (needed to tell court from player overlap). */
export function constraintName(err: unknown): string | undefined {
  const direct = dig(err, 'constraint');
  if (typeof direct === 'string') return direct;
  const texts = [
    dig(err, 'meta', 'driverAdapterError', 'cause', 'originalMessage'),
    dig(err, 'cause', 'originalMessage'),
    dig(err, 'message'),
  ];
  for (const t of texts) {
    const m = typeof t === 'string' ? /constraint "([^"]+)"/.exec(t) : null;
    if (m) return m[1];
  }
  return undefined;
}

/** Deadlock or serialization failure: the whole transaction can safely be run again. */
export function isRetryable(err: unknown): boolean {
  const state = sqlState(err);
  return state === SQLSTATE.deadlock || state === SQLSTATE.serializationFailure || prismaCode(err) === 'P2034';
}

/** Column names of a violated unique constraint, e.g. ['email']. Works for the adapter and classic engine shapes. */
export function uniqueViolationFields(err: unknown): string[] {
  const fields = dig(err, 'meta', 'driverAdapterError', 'cause', 'constraint', 'fields') ?? dig(err, 'meta', 'target');
  if (Array.isArray(fields)) return fields.map(String);
  const m = /^[a-z_]+?_((?:[a-z]+_?)+)_key$/.exec(constraintName(err) ?? ''); // users_email_key -> email
  return m?.[1] ? [m[1]] : [];
}
