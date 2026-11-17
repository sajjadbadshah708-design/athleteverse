// Idempotent seed logic (MNT-3, SA-1). Safe to run repeatedly: existing rows are never overwritten
// (so a changed owner password or an edited setting survives a re-seed).
import type { PrismaClient, Prisma, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { SETTING_DEFAULTS } from '../../src/config/settingsDefaults';

export interface SeedOptions {
  owner: { email: string; phone: string; password: string };
  seedDemo: boolean;
  demoPassword: string;
  log?: (message: string) => void;
}

// PLACEHOLDERS until the project owner answers OI-1 (launch city) and OI-2 (sports, positions, roster sizes).
export const SEED_CITIES = ['Demo City'];
export const SEED_SPORTS = [
  { name: 'Futsal', minTeamSize: 5, maxTeamSize: 10 },
  { name: 'Badminton', minTeamSize: 2, maxTeamSize: 4 },
];

const BCRYPT_COST = 10;

/** FR-1.4: at least 8 characters with one letter and one digit. */
export function assertPasswordRule(password: string, label: string): void {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error(`${label}: password must be at least 8 characters with one letter and one digit (FR-1.4)`);
  }
}

export async function runSeed(prisma: PrismaClient, opts: SeedOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  assertPasswordRule(opts.owner.password, 'OWNER_PASSWORD');
  assertPasswordRule(opts.demoPassword, 'SEED_PASSWORD');

  // --- reference data ---
  for (const name of SEED_CITIES) {
    await prisma.city.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const s of SEED_SPORTS) {
    await prisma.sport.upsert({ where: { name: s.name }, update: {}, create: s });
  }

  // --- settings (Table 26): never overwrite a value that already exists ---
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as Prisma.InputJsonValue },
    });
  }

  // --- owner Super Admin (SA-1) ---
  const owner = await createUserOnce(prisma, {
    ...opts.owner,
    role: 'ADMIN',
    fullName: 'Project Owner',
    isOwner: true,
  });
  log(`owner admin: ${owner.email}`);

  if (!opts.seedDemo) return;

  // --- demo data: an ACTIVE manager, venue, courts, staff and two players (Phase 3, T2) ---
  const city = await prisma.city.findFirstOrThrow({ where: { name: SEED_CITIES[0] } });
  const futsal = await prisma.sport.findUniqueOrThrow({ where: { name: 'Futsal' } });
  const badminton = await prisma.sport.findUniqueOrThrow({ where: { name: 'Badminton' } });
  const pw = opts.demoPassword;

  const manager = await createUserOnce(prisma, {
    email: 'manager@athleteverse.test', phone: '920000000001', password: pw, role: 'MANAGER', fullName: 'Demo Manager',
  });
  await prisma.managerProfile.upsert({
    where: { userId: manager.id },
    update: {},
    create: {
      userId: manager.id,
      businessName: 'Demo Arena Ltd',
      nationalIdNo: '0000000000001',
      businessAddress: '1 Demo Street',
      reviewedById: owner.id,
      reviewedAt: new Date(),
    },
  });

  // Venues have no Prisma-level unique key (the unique index is on lower(name)), so look up by hand.
  let venue = await prisma.venue.findFirst({ where: { managerId: manager.id, name: 'Demo Arena' } });
  venue ??= await prisma.venue.create({
    data: {
      managerId: manager.id, name: 'Demo Arena', description: 'Seeded demonstration venue.',
      address: '1 Demo Street', cityId: city.id, phone: '920000000100',
      openHour: 8, closeHour: 23, peakStartHour: 18, peakEndHour: 23,
    },
  });

  const courts = [
    { name: 'Futsal Court A', sportId: futsal.id, priceRegular: '20.00', pricePeak: '30.00' },
    { name: 'Badminton Court B', sportId: badminton.id, priceRegular: '10.00', pricePeak: '15.00' },
  ];
  for (const c of courts) {
    const exists = await prisma.court.findFirst({ where: { venueId: venue.id, name: c.name } });
    if (!exists) await prisma.court.create({ data: { ...c, venueId: venue.id } });
  }

  const staff = await createUserOnce(prisma, {
    email: 'staff@athleteverse.test', phone: '920000000002', password: pw, role: 'STAFF', fullName: 'Demo Staff',
  });
  await prisma.staffProfile.upsert({
    where: { userId: staff.id },
    update: {},
    create: { userId: staff.id, venueId: venue.id, invitedById: manager.id },
  });

  const players = [
    { email: 'player1@athleteverse.test', phone: '920000000003', fullName: 'Demo Player One' },
    { email: 'player2@athleteverse.test', phone: '920000000004', fullName: 'Demo Player Two' },
  ];
  for (const p of players) {
    const user = await createUserOnce(prisma, { ...p, password: pw, role: 'PLAYER' });
    await prisma.playerProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, cityId: city.id, area: 'Downtown', dateOfBirth: new Date('2000-01-01') },
    });
  }
  log(`demo data ready (password for demo accounts: ${pw})`);
}

async function createUserOnce(
  prisma: PrismaClient,
  u: { email: string; phone: string; password: string; role: Role; fullName: string; isOwner?: boolean },
) {
  const email = u.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email,
      phone: u.phone,
      role: u.role,
      status: 'ACTIVE',
      fullName: u.fullName,
      passwordHash: await bcrypt.hash(u.password, BCRYPT_COST),
      emailVerified: true,
      termsAcceptedAt: new Date(),
      isOwner: u.isOwner ?? false,
    },
  });
}
