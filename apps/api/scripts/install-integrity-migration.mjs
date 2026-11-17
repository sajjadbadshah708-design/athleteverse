// Copies prisma/integrity.sql into prisma/migrations/<UTC timestamp>_integrity_constraints/migration.sql.
// Idempotent: does nothing if that migration already exists. Must run AFTER the init migration (it sorts later by timestamp).
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prismaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'prisma');
const migrationsDir = path.join(prismaDir, 'migrations');
const names = existsSync(migrationsDir) ? readdirSync(migrationsDir) : [];

const existing = names.find((n) => n.endsWith('_integrity_constraints'));
if (existing) {
  console.log(`Integrity migration already installed: ${existing}`);
  process.exit(0);
}
if (!names.some((n) => /^\d{14}_/.test(n))) {
  console.error('No migrations found. Run the init migration first: npm run db:init');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const target = path.join(migrationsDir, `${stamp}_integrity_constraints`);
mkdirSync(target);
copyFileSync(path.join(prismaDir, 'integrity.sql'), path.join(target, 'migration.sql'));
console.log(`Installed ${path.relative(process.cwd(), target)}`);
