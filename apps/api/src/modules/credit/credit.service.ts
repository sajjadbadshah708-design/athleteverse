// FR-2.24: the sole writer of player credit. Call only after lockUser inside withTx.
// A unique (booking_id, event_type) index makes each booking event idempotent.
import { tierOf } from '@athleteverse/shared';
import type { CreditEventType } from '@prisma/client';
import type { Tx } from '../../db/tx';
import type { AppDeps } from '../../lib/deps';
import { AppError } from '../../lib/errors';

export function boundedScore(score: number, delta: number): number {
  return Math.max(0, Math.min(100, score + delta));
}

export async function applyCredit(deps: AppDeps, tx: Tx, input: {
  userId: string; bookingId: string; eventType: CreditEventType; delta: number; actorId?: string;
}): Promise<number> {
  const prior = await tx.creditEvent.findUnique({
    where: { bookingId_eventType: { bookingId: input.bookingId, eventType: input.eventType } },
  });
  if (prior) throw new AppError('CREDIT_ALREADY_APPLIED', 'This credit change was already recorded');
  const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { creditScore: true, blockedAt: true } });
  const scoreAfter = boundedScore(user.creditScore, input.delta);
  const now = deps.clock.now();
  await tx.creditEvent.create({ data: {
    userId: input.userId, bookingId: input.bookingId, eventType: input.eventType,
    points: scoreAfter - user.creditScore, scoreAfter, createdAt: now,
  } });
  await tx.user.update({ where: { id: input.userId }, data: {
    creditScore: scoreAfter,
    blockedAt: scoreAfter === 0 ? (user.blockedAt ?? now) : null,
  } });
  await tx.auditLog.create({ data: { createdAt: deps.clock.now(),
    actorId: input.actorId ?? input.userId, action: `CREDIT_${input.eventType}`,
    targetType: 'Booking', targetId: input.bookingId,
    oldValue: { score: user.creditScore }, newValue: { score: scoreAfter, delta: scoreAfter - user.creditScore },
  } });
  return scoreAfter;
}

export async function getCreditSummary(deps: AppDeps, userId: string) {
  const [user, events, good, caution] = await Promise.all([
    deps.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { creditScore: true, blockedAt: true } }),
    deps.prisma.creditEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    deps.settings.get('tier_good'), deps.settings.get('tier_caution'),
  ]);
  return {
    score: user.creditScore, tier: user.blockedAt ? 'BLOCKED' as const : tierOf(user.creditScore, { good, caution }),
    events: events.map(e => ({ id: e.id, bookingId: e.bookingId, type: e.eventType, points: e.points, scoreAfter: e.scoreAfter, createdAt: e.createdAt.toISOString() })),
  };
}
