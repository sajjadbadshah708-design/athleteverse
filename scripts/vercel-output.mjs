// Assembles the Vercel Build Output (https://vercel.com/docs/build-output-api/v3) for one project serving both the web
// app and the API (decision 2026-11-17, docs/DEPLOY.md). Run from the repository root AFTER `npm run db:generate` and the
// web build:
//
//   node scripts/vercel-output.mjs [--out <dir>] [--skip-migrations]
//
// 1. On production builds only (VERCEL_ENV=production), applies the database migrations. Preview builds never touch the
//    production database.
// 2. Bundles apps/api/src/vercel.ts into one ES module (the source uses extensionless imports that only tsx resolves).
//    Prisma stays outside the bundle because its generated client loads a WebAssembly file from disk; its two folders
//    are copied next to the bundle.
// 3. Copies the built web app as static files and routes /api/* to the function, everything else to the SPA.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const out = resolve(root, outArg >= 0 ? args[outArg + 1] : 'apps/web/.vercel/output');
const skipMigrations = args.includes('--skip-migrations');

const webDist = join(root, 'apps/web/dist');
const prismaGenerated = join(root, 'node_modules/.prisma/client');
for (const [path, hint] of [[webDist, 'run the web build first'], [prismaGenerated, 'run `npm run db:generate` first']]) {
  if (!existsSync(path)) throw new Error(`Missing ${path}: ${hint}`);
}

if (process.env.VERCEL_ENV === 'production' && !skipMigrations) {
  console.log('[vercel-output] production build: applying database migrations');
  execSync('npm run db:deploy', { cwd: root, stdio: 'inherit' });
} else {
  console.log(`[vercel-output] migrations skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'})`);
}

rmSync(out, { recursive: true, force: true });
const fn = join(out, 'functions/api.func');
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: [join(root, 'apps/api/src/vercel.ts')],
  outfile: join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'linked',
  external: ['@prisma/client', '.prisma/client', 'pg-native'],
  // Express and other CommonJS dependencies call require() for Node built-ins; give the ES module a real require.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
});

cpSync(join(root, 'node_modules/@prisma/client'), join(fn, 'node_modules/@prisma/client'), { recursive: true });
cpSync(prismaGenerated, join(fn, 'node_modules/.prisma/client'), { recursive: true });

writeFileSync(join(fn, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false, // Express parses bodies and cookies itself
  maxDuration: 60,
}, null, 2));

cpSync(webDist, join(out, 'static'), { recursive: true });

writeFileSync(join(out, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '^/api(/.*)?$', dest: '/api' }, // the function sees the original URL, so Express routes /api/v1/... as usual
    { handle: 'filesystem' }, // built assets (index.html, /assets/*)
    { src: '/.*', dest: '/index.html' }, // client-side routes of the single-page app
  ],
}, null, 2));

console.log(`[vercel-output] wrote ${out}`);
