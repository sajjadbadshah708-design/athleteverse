// Entry point for `prisma db seed` / `npm run db:seed`.
import { config } from 'dotenv';
import { createDb } from '../src/db/prisma';
import { seedOptionsFromEnv } from './seed/options';
import { runSeed } from './seed/run';

config({ quiet: true });

let options;
try {
  options = seedOptionsFromEnv(process.env);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL);

runSeed(db.prisma, { ...options, log: (m) => console.log(`[seed] ${m}`) })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.close());
