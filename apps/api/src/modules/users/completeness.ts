// FR-1.15: only players with a complete profile may book a court, create or join a team, or register for a tournament.
// With the narrowed gate of M2 a profile row exists only once city and date of birth are saved, so "complete" means "the row exists".
// Booking (T9), teams and tournaments call this inside their own transaction.
import type { PrismaClient } from '@prisma/client';
import type { Tx } from '../../db/tx';
import { AppError } from '../../lib/errors';

export async function assertProfileComplete(db: Pick<PrismaClient | Tx, 'playerProfile'>, userId: string): Promise<void> {
  const profile = await db.playerProfile.findUnique({ where: { userId }, select: { userId: true } });
  if (!profile) throw new AppError('PROFILE_INCOMPLETE', 'Complete your profile first');
}
