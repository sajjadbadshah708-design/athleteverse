import pg from 'pg';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
export const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 6 });

/** Empties every application table (keeps Prisma's migration history). */
export async function resetDb(): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length) {
    await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
}

export interface DbFailure {
  code?: string; // SQLSTATE, e.g. 23P01 exclusion_violation, 23505 unique_violation, 23514 check_violation
  constraint?: string;
  message: string;
}

/** Runs a statement that MUST fail and returns the PostgreSQL error details. */
export async function dbError(statement: Promise<unknown>): Promise<DbFailure> {
  try {
    await statement;
  } catch (e) {
    const err = e as { code?: string; constraint?: string; message: string };
    return { code: err.code, constraint: err.constraint, message: err.message };
  }
  throw new Error('Expected the statement to fail, but it succeeded');
}

export const SQLSTATE = {
  exclusion: '23P01',
  unique: '23505',
  check: '23514',
  foreignKey: '23503',
} as const;
