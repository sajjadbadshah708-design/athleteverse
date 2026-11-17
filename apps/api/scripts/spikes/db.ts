// Spike S1 (docs/DEPLOY.md): does everything the booking flow needs from PostgreSQL work on the REAL hosted database,
// through the pooled connection? Run it against Neon:
//   DATABASE_URL=<pooled url> DIRECT_URL=<direct url> npm run spike:db -w @athleteverse/api
// It creates and deletes its own rows (booking codes starting with SPIKE, year 2099). Credentials are never printed.
import { config } from 'dotenv';
import pg from 'pg';
import { SQLSTATE, sqlState } from '../../src/db/pgErrors';
import { createDb } from '../../src/db/prisma';
import { withTx } from '../../src/db/tx';

config({ quiet: true });

const url = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const host = (u: string) => new URL(u).hostname;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const db = createDb(url);
const prisma = db.prisma;

let failures = 0;
async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    console.log(`  PASS  ${name}: ${await fn()}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main(): Promise<void> {
  console.log(`\nSpike S1: database (pooled host: ${host(url!)})\n`);

  await check('connection and version', async () => {
    const [row] = await prisma.$queryRaw<{ v: number }[]>`SELECT current_setting('server_version_num')::int AS v`;
    const num = row!.v;
    if (num < 150000) throw new Error(`PostgreSQL ${num} is older than 15 (SRS 3.2)`);
    const pooled = host(url!).includes('-pooler') ? 'pooled endpoint (this run exercises the pooler)' : 'direct host: this run does NOT exercise the pooler, use the "-pooler" URL for DATABASE_URL';
    return `PostgreSQL ${Math.floor(num / 10000)}, ${pooled}`;
  });

  await check('btree_gist, migrations and constraints', async () => {
    const ext = await prisma.$queryRaw<{ extname: string }[]>`SELECT extname::text AS extname FROM pg_extension WHERE extname = 'btree_gist'`;
    if (!ext.length) {
      const avail = await prisma.$queryRaw<{ name: string }[]>`SELECT name::text AS name FROM pg_available_extensions WHERE name = 'btree_gist'`;
      throw new Error(avail.length ? 'btree_gist is available but not installed: run `npm run db:deploy` first' : 'btree_gist is NOT available on this server');
    }
    const [m] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    if (m!.n < 2) throw new Error(`only ${m!.n} migration(s) applied (expected init + integrity_constraints)`);
    const c = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_constraint
       WHERE conname IN ('bookings_no_court_overlap', 'bookings_no_player_overlap', 'blocks_no_overlap')`;
    if (c[0]!.n !== 3) throw new Error(`exclusion constraints missing (found ${c[0]!.n} of 3)`);
    return `btree_gist installed, ${m!.n} migrations, 3 exclusion constraints`;
  });

  await check('direct (non-pooled) connection for migrations', async () => {
    if (!directUrl) throw new Error('DIRECT_URL is not set');
    const client = new pg.Client({ connectionString: directUrl });
    await client.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      await client.end();
    }
    if (host(directUrl).includes('-pooler')) throw new Error('DIRECT_URL points at a "-pooler" host: migrations need the direct (non-pooler) connection string');
    return `reachable (${host(directUrl)})`;
  });

  await check('30 concurrent parameterised queries (pooler and prepared statements)', async () => {
    const rows = await Promise.all(Array.from({ length: 30 }, (_, i) => prisma.$queryRaw<{ n: number }[]>`SELECT ${i}::int AS n`));
    if (rows.some((r, i) => r[0]?.n !== i)) throw new Error('a result came back for the wrong query');
    return 'all 30 answered correctly';
  });

  const players = await prisma.user.findMany({
    where: { email: { in: ['player1@athleteverse.test', 'player2@athleteverse.test'] } },
    select: { id: true },
    orderBy: { email: 'asc' },
  });
  const court = await prisma.court.findFirst({ where: { name: 'Futsal Court A' }, select: { id: true } });
  if (players.length < 2 || !court) {
    failures++;
    console.log('  FAIL  demo data: run the seed first (SEED_DEMO=true npm run db:seed) so the demo players and court exist');
    return;
  }
  const [p1, p2] = [players[0]!.id, players[1]!.id];

  await check('SELECT ... FOR UPDATE blocks a second transaction until the first commits', async () => {
    const events: string[] = [];
    let aHasLock!: () => void;
    const aLocked = new Promise<void>((r) => (aHasLock = r));
    const a = withTx(prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${p1}::uuid FOR UPDATE`;
      aHasLock();
      await sleep(700);
      events.push('A done');
    });
    await aLocked;
    const startedB = performance.now();
    const b = withTx(prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${p1}::uuid FOR UPDATE`;
      events.push('B locked');
    });
    await Promise.all([a, b]);
    const waited = Math.round(performance.now() - startedB);
    if (events.join() !== 'A done,B locked') throw new Error(`wrong order: ${events.join(' -> ')}`);
    return `B waited ${waited} ms for A's commit`;
  });

  await check('10 simultaneous bookings for one slot: exactly one wins, the rest get 23P01', async () => {
    const start = '2099-01-01T10:00:00.000Z';
    const end = '2099-01-01T11:00:00.000Z';
    const cleanup = () => prisma.$executeRaw`DELETE FROM bookings WHERE booking_code LIKE 'SPIKE%'`;
    await cleanup();
    try {
      const attempts = Array.from({ length: 10 }, (_, i) => {
        const code = `SPIKE${String(i).padStart(3, '0')}`;
        const player = i % 2 === 0 ? p1 : p2;
        return prisma.$executeRaw`
          INSERT INTO bookings (booking_code, court_id, player_id, start_time, end_time, total_price)
          VALUES (${code}, ${court!.id}::uuid, ${player}::uuid, ${start}::timestamptz, ${end}::timestamptz, 1)`;
      });
      const results = await Promise.allSettled(attempts);
      const won = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      const wrong = rejected.filter((r) => sqlState(r.reason) !== SQLSTATE.exclusionViolation);
      if (won !== 1) throw new Error(`${won} bookings succeeded (expected exactly 1)`);
      if (wrong.length) throw new Error(`${wrong.length} rejection(s) were not exclusion violations`);
      return `1 won, ${rejected.length} rejected with 23P01`;
    } finally {
      await cleanup();
    }
  });

  await check('a real deadlock is detected and retried once (error shape survives the pooler)', async () => {
    let waiting = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const attempts: number[] = [];
    const run = (first: string, second: string) =>
      withTx(
        prisma,
        async (tx, { attempt }) => {
          attempts.push(attempt);
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${first}::uuid FOR UPDATE`;
          if (attempt === 1) {
            if (++waiting === 2) release();
            await gate;
          }
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${second}::uuid FOR UPDATE`;
        },
        { backoffMs: () => 0 },
      );
    await Promise.all([run(p1, p2), run(p2, p1)]);
    if (attempts.sort().join() !== '1,1,2') throw new Error(`attempts were ${attempts.sort().join()} (expected 1,1,2)`);
    return 'one transaction re-ran once and both finished';
  });

  await check('round-trip time from this machine', async () => {
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      await prisma.$queryRaw`SELECT 1`;
      times.push(performance.now() - t);
    }
    times.sort((x, y) => x - y);
    return `median ${Math.round(times[5]!)} ms (run it from the API's region for a meaningful number)`;
  });
}

main()
  .catch((e) => {
    failures++;
    console.error(e);
  })
  .finally(async () => {
    await db.close();
    console.log(failures ? `\n${failures} check(s) FAILED\n` : '\nAll checks passed\n');
    process.exit(failures ? 1 : 0);
  });
