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

/** FR-2.28: restore a player blocked for 30 days to 20. The credit ledger records this just once per block interval. */
export const restoreBlockedAccounts: Job = {
  name: 'restore_blocked_players',
  async run(deps) {
    const [days, restoredScore] = await Promise.all([deps.settings.get('blocked_restore_days'), deps.settings.get('blocked_restore_score')]);
    const deadline = new Date(deps.clock.now().getTime() - days * 86400000);
    const users = await deps.prisma.user.findMany({ where: { role: 'PLAYER', blockedAt: { lte: deadline }, creditScore: 0 }, select: { id: true } });
    let affected = 0;
    for (const user of users) {
      const updated = await withTx(deps.prisma, async tx => {
        await lockUser(tx, user.id);
        const row = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
        if (!row.blockedAt || row.blockedAt > deadline || row.creditScore !== 0) return false;
        const result = await tx.user.updateMany({ where: { id: row.id, creditScore: 0, blockedAt: { lte: deadline } }, data: { creditScore: restoredScore, blockedAt: null } });
        if (!result.count) return false;
        await tx.creditEvent.create({ data: { userId: row.id, eventType: 'AUTO_RESTORE', points: restoredScore, scoreAfter: restoredScore, createdAt: deps.clock.now() } });
        await tx.auditLog.create({ data: { createdAt: deps.clock.now(), action: 'CREDIT_AUTO_RESTORE', targetType: 'User', targetId: row.id, reason: `${days}-day blocked period ended`, newValue: { creditScore: restoredScore } } });
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
