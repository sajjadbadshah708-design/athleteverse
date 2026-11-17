import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

config({ quiet: true }); // loads apps/api/.env (TEST_DATABASE_URL) for local runs; CI sets real env vars

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    fileParallelism: false, // tests share one database
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
