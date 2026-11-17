import type { Job } from './tick';
import { withTx, lockUser } from '../../db/tx';

/**
 * FR-2.18: 24 hours after a booking ends, unresolved outcomes close without penalty. Each closure is audited (by the
 * system, no actor) in the same transaction, so the booking's status history (FR-5.3) has no gap.
 */
export const autoCloseBookings: Job = {
  name: 'auto_close_bookings',
  async run(deps) {
    const hours = await deps.settings.get('outcome_auto_close_hours');
    const now = deps.clock.now();
    const cutoff = new Date(now.getTime() - hours * 3600000);
    return withTx(deps.prisma, async tx => {
      const closed = await tx.booking.updateManyAndReturn({
        where: { status: 'CONFIRMED', endTime: { lte: cutoff } },
        data: { status: 'COMPLETED' },
        select: { id: true },
      });
      if (closed.length) {
        await tx.auditLog.createMany({ data: closed.map(b => ({
          createdAt: now, action: 'BOOKING_AUTO_CLOSED', targetType: 'Booking', targetId: b.id,
          reason: `No outcome ${hours} hours after the end`, newValue: { status: 'COMPLETED', paymentStatus: 'PENDING' },
        })) });
      }
      return closed.length;
    });
  },
};

/**
 * FR-2.28: 30 days after a player was blocked, the block ends and the score returns to 20 (or stays higher if points were
 * earned while blocked). The credit ledger records this just once per block interval.
 */
export const restoreBlockedAccounts: Job = {
  name: 'restore_blocked_players',
  async run(deps) {
    const [days, restoredScore] = await Promise.all([deps.settings.get('blocked_restore_days'), deps.settings.get('blocked_restore_score')]);
    const now = deps.clock.now();
    const deadline = new Date(now.getTime() - days * 86400000);
    const users = await deps.prisma.user.findMany({ where: { role: 'PLAYER', blockedAt: { lte: deadline } }, select: { id: true } });
    let affected = 0;
    for (const user of users) {
      const updated = await withTx(deps.prisma, async tx => {
        await lockUser(tx, user.id);
        const row = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
        if (!row.blockedAt || row.blockedAt > deadline) return false; // already restored by a parallel run
        const scoreAfter = Math.max(row.creditScore, restoredScore);
        await tx.user.update({ where: { id: row.id }, data: { creditScore: scoreAfter, blockedAt: null } });
        await tx.creditEvent.create({ data: { userId: row.id, eventType: 'AUTO_RESTORE', points: scoreAfter - row.creditScore, scoreAfter, createdAt: now } });
        await tx.auditLog.create({ data: { createdAt: now, action: 'CREDIT_AUTO_RESTORE', targetType: 'User', targetId: row.id, reason: `${days}-day blocked period ended`,
          oldValue: { creditScore: row.creditScore }, newValue: { creditScore: scoreAfter } } });
        return true;
      });
      if (updated) affected++;
    }
    return affected;
  },
};

export const cleanupSessions: Job = {
  name: 'cleanup_sessions',
  async run(deps) {
    const now = deps.clock.now();
    const rows = await deps.prisma.userSession.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] } });
    return rows.count;
  },
};
