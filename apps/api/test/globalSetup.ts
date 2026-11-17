// Applies all migrations to the test database once before the suite (SRS MNT-3).
import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env and run `npm run db:up`.');
  }
  // The suite TRUNCATEs every table, so refuse anything that is not clearly a test database.
  if (!/\/[^/?]*_test(\?|$)/.test(url)) {
    throw new Error('Refusing to run: the TEST_DATABASE_URL database name must end with _test.');
  }
  const apiDir = fileURLToPath(new URL('..', import.meta.url));
  const migrations = `${apiDir}/prisma/migrations`;
  const hasMigrations = existsSync(migrations) && readdirSync(migrations).some((n) => /^\d{14}_/.test(n));
  if (!hasMigrations) {
    throw new Error('No migrations found in apps/api/prisma/migrations. Run `npm run db:init` once and commit the result.');
  }
  execSync('npx prisma migrate deploy', {
    cwd: apiDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}
