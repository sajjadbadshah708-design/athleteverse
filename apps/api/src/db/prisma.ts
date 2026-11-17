// The only place a PrismaClient is constructed. Rust-free client + pg driver adapter (schema.prisma: engineType = "client").
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import type { Logger } from '../lib/logger';

export interface Db {
  prisma: PrismaClient;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDb(connectionString: string, logger?: Logger): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 15_000, // a scaled-to-zero Neon database can take seconds to wake (Table 7)
    statement_timeout: 15_000, // no query or lock wait may hang a request forever
  });
  // Neon drops idle connections when it scales to zero. Without a listener that 'error' event would crash the process.
  pool.on('error', (err) => logger?.warn('idle database connection error', { error: err.message }));

  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    prisma,
    pool,
    async close() {
      await prisma.$disconnect();
      if (!pool.ended) await pool.end().catch(() => {}); // the adapter may already have closed the pool
    },
  };
}
