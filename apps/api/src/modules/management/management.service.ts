// MVP F1/F5: manager registration, Super Admin review, venue/court setup and invitation-only staff.
// Server checks approval and ownership on EVERY operation. Public APIs do not leak sensitive manager details.
import { newRefreshToken } from '../auth/tokens';
import { hashOtp, otpMatches, generateOtp, OTP_TTL_MS, OTP_MAX_ATTEMPTS } from '../auth/otp';
import { hashPassword, verifyPassword } from '../auth/password';
import { createSession, type SessionMeta } from '../auth/sessions';
import { signAccessToken } from '../auth/tokens';
import { loadAuthUser, recordFailedLogin, type SignedIn } from '../auth/auth.service';
import { withTx, lockUser } from '../../db/tx';
import { sendSafely } from '../../lib/mailer/mailer';
import { otpMessage } from '../../lib/mailer/templates';
import type { AppDeps } from '../../lib/deps';
import { AppError, forbidden, notFound } from '../../lib/errors';
import type { ManagerRegister } from '@athleteverse/shared';

const denied = () => new AppError('INVALID_CREDENTIALS', 'E-mail or password is not correct');
const INVITE_MS = 48 * 3600000;

export async function registerManager(deps: AppDeps, body: ManagerRegister) {
  const now = deps.clock.now();
  const code = generateOtp();
  const passwordHash = await hashPassword(body.password, deps.env.BCRYPT_COST);
  if (await deps.prisma.user.findFirst({ where: { OR: [{ email: body.email }, { phone: body.phone }] } })) {
    throw new AppError('CONFLICT', 'E-mail or phone number already registered');
  }
  await withTx(deps.prisma, async tx => {
    const user = await tx.user.create({ data: {
      email: body.email, phone: body.phone, fullName: body.fullName, role: 'MANAGER', status: 'UNVERIFIED',
      emailVerified: false, passwordHash, termsAcceptedAt: now, createdAt: now,
    } });
    await tx.managerProfile.create({ data: { userId: user.id, businessName: body.businessName, nationalIdNo: body.nationalIdNo, businessAddress: body.businessAddress } });
    await tx.authToken.create({ data: { userId: user.id, purpose: 'EMAIL_VERIFY', tokenHash: hashOtp(deps.env.OTP_PEPPER, user.id, 'EMAIL_VERIFY', code), expiresAt: new Date(now.getTime() + OTP_TTL_MS), createdAt: now } });
  });
  await sendSafely(deps, otpMessage(body.email, code, OTP_TTL_MS / 60000));
}

export async function listManagers(deps: AppDeps) {
  const users = await deps.prisma.user.findMany({ where: { role: 'MANAGER', status: { in: ['PENDING_APPROVAL', 'REJECTED', 'ACTIVE'] } },
    include: { managerProfile: true }, orderBy: { createdAt: 'desc' }, take: 200 });
  return { items: users.filter(u => u.managerProfile).map(u => ({
    id: u.id, fullName: u.fullName, email: u.email, status: u.status as 'PENDING_APPROVAL' | 'REJECTED' | 'ACTIVE',
    businessName: u.managerProfile!.businessName, nationalIdNo: u.managerProfile!.nationalIdNo, businessAddress: u.managerProfile!.businessAddress,
    rejectionReason: u.managerProfile!.rejectionReason,
  })) };
}

export async function decideManager(deps: AppDeps, adminId: string, managerId: string, decision: 'APPROVE' | 'REJECT', reason: string) {
  return withTx(deps.prisma, async tx => {
    await lockUser(tx, managerId);
    const u = await tx.user.findUnique({ where: { id: managerId }, include: { managerProfile: true } });
    if (!u || u.role !== 'MANAGER' || !u.managerProfile) throw notFound('Manager');
    if (u.status !== 'PENDING_APPROVAL') throw new AppError('CONFLICT', 'Only pending applications can be reviewed');
    const status = decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
    await tx.user.update({ where: { id: managerId }, data: { status } });
    await tx.managerProfile.update({ where: { userId: managerId }, data: {
      reviewedById: adminId, reviewedAt: deps.clock.now(), rejectionReason: decision === 'REJECT' ? reason : null,
    } });
    await tx.auditLog.create({ data: { actorId: adminId, action: `MANAGER_${decision}`, targetType: 'User', targetId: managerId, reason,
      oldValue: { status: u.status }, newValue: { status } } });
    return { ok: true as const };
  });
}

export async function adminRequestOtp(deps: AppDeps, email: string, password: string) {
  const user = await deps.prisma.user.findUnique({ where: { email } });
  if (!user || user.role !== 'ADMIN' || user.deletedAt || user.status !== 'ACTIVE') {
    await verifyPassword(password, null, deps.env.BCRYPT_COST);
    throw denied();
  }
  if (user.lockedUntil && user.lockedUntil > deps.clock.now()) {
    throw new AppError('ACCOUNT_LOCKED', 'Too many sign-in attempts. Try later.', { lockedUntil: user.lockedUntil.toISOString() });
  }
  if (!(await verifyPassword(password, user.passwordHash, deps.env.BCRYPT_COST))) {
    const until = await recordFailedLogin(deps, user.id);
    if (until) throw new AppError('ACCOUNT_LOCKED', 'Too many sign-in attempts. Try later.', { lockedUntil: until.toISOString() });
    throw denied();
  }
  const code = generateOtp(); const now = deps.clock.now();
  await withTx(deps.prisma, async tx => {
    await lockUser(tx, user.id);
    await tx.authToken.updateMany({ where: { userId: user.id, purpose: 'LOGIN_OTP', usedAt: null }, data: { usedAt: now } });
    await tx.authToken.create({ data: { userId: user.id, purpose: 'LOGIN_OTP', tokenHash: hashOtp(deps.env.OTP_PEPPER, user.id, 'LOGIN_OTP', code), createdAt: now, expiresAt: new Date(now.getTime() + OTP_TTL_MS) } });
  });
  await sendSafely(deps, otpMessage(email, code, OTP_TTL_MS / 60000));
}

export async function adminVerifyOtp(deps: AppDeps, email: string, password: string, code: string, meta: SessionMeta): Promise<SignedIn> {
  const user = await deps.prisma.user.findUnique({ where: { email } });
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE' || user.deletedAt) {
    await verifyPassword(password, null, deps.env.BCRYPT_COST);
    throw denied();
  }
  if (user.lockedUntil && user.lockedUntil > deps.clock.now()) {
    throw new AppError('ACCOUNT_LOCKED', 'Too many sign-in attempts. Try later.', { lockedUntil: user.lockedUntil.toISOString() });
  }
  if (!(await verifyPassword(password, user.passwordHash, deps.env.BCRYPT_COST))) {
    const until = await recordFailedLogin(deps, user.id);
    if (until) throw new AppError('ACCOUNT_LOCKED', 'Too many sign-in attempts. Try later.', { lockedUntil: until.toISOString() });
    throw denied();
  }
  const now = deps.clock.now();
  const token = await deps.prisma.authToken.findFirst({ where: { userId: user.id, purpose: 'LOGIN_OTP', usedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!token) throw new AppError('OTP_EXPIRED', 'Request a new Super Admin code');
  const attempts = await deps.prisma.$queryRaw<{ attempts: number }[]>`
    UPDATE auth_tokens SET attempts = attempts + 1 WHERE id = ${token.id}::uuid AND used_at IS NULL
      AND attempts < ${OTP_MAX_ATTEMPTS} AND expires_at > ${now}::timestamptz RETURNING attempts`;
  if (!attempts[0]) throw new AppError('OTP_EXPIRED', 'Request a new Super Admin code');
  if (!otpMatches(token.tokenHash, deps.env.OTP_PEPPER, user.id, 'LOGIN_OTP', code)) throw new AppError('OTP_INVALID', 'Code is incorrect');
  const session = await withTx(deps.prisma, async tx => {
    await lockUser(tx, user.id);
    await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    const claim = await tx.authToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: now } });
    if (!claim.count) throw new AppError('OTP_EXPIRED', 'Code already used');
    return createSession(deps, tx, user.id, meta);
  });
  const [authUser, accessToken] = await Promise.all([loadAuthUser(deps.prisma, user.id), signAccessToken(deps, user.id, session.sessionId)]);
  return { user: authUser, accessToken, session };
}

export async function assertOwnVenue(deps: AppDeps, managerId: string, venueId: string) {
  const v = await deps.prisma.venue.findFirst({ where: { id: venueId, managerId } });
  if (!v) throw notFound('Venue');
  return v;
}

export async function managerVenues(deps: AppDeps, managerId: string) {
  const rows = await deps.prisma.venue.findMany({ where: { managerId }, orderBy: { name: 'asc' } });
  return { items: rows.map(v => ({ id: v.id, name: v.name, cityId: v.cityId, address: v.address, openHour: v.openHour, closeHour: v.closeHour, status: v.status })) };
}

export async function createVenue(deps: AppDeps, managerId: string, input: {
  name: string; address: string; cityId: number; phone: string; openHour: number; closeHour: number;
  description?: string; peakStartHour?: number | null; peakEndHour?: number | null;
}) {
  return withTx(deps.prisma, async tx => {
    const manager = await lockUser(tx, managerId);
    if (manager?.role !== 'MANAGER' || manager.status !== 'ACTIVE') throw forbidden('Approval required');
    if (await tx.venue.count({ where: { managerId } }) >= 3) throw new AppError('CONFLICT', 'A manager may own at most three venues');
    const city = await tx.city.findUnique({ where: { id: input.cityId } });
    if (!city?.isActive) throw new AppError('VALIDATION_ERROR', 'Choose an active city');
    const clash = await tx.venue.findFirst({ where: { cityId: input.cityId, name: { equals: input.name, mode: 'insensitive' } } });
    if (clash) throw new AppError('CONFLICT', 'This venue name is already used in the city');
    const v = await tx.venue.create({ data: {
      ...input, managerId, description: input.description ?? null, peakStartHour: input.peakStartHour ?? null, peakEndHour: input.peakEndHour ?? null,
    } });
    await tx.auditLog.create({ data: { actorId: managerId, action: 'VENUE_CREATED', targetType: 'Venue', targetId: v.id } });
    return { id: v.id, name: v.name, address: v.address, cityId: v.cityId, openHour: v.openHour, closeHour: v.closeHour, status: v.status };
  });
}

export async function createCourt(deps: AppDeps, managerId: string, venueId: string, input: {
  name: string; sportId: number; priceRegular: string; pricePeak?: string | null;
}) {
  return withTx(deps.prisma, async tx => {
    await lockUser(tx, managerId);
    const venue = await tx.venue.findFirst({ where: { id: venueId, managerId, status: { not: 'SUSPENDED' } } });
    if (!venue) throw notFound('Venue');
    if (await tx.court.count({ where: { venueId } }) >= 10) throw new AppError('CONFLICT', 'At most ten courts per venue');
    if (await tx.court.findFirst({ where: { venueId, name: { equals: input.name, mode: 'insensitive' } } })) throw new AppError('CONFLICT', 'Court name already used in this venue');
    if (!await tx.sport.findFirst({ where: { id: input.sportId, isActive: true } })) throw new AppError('VALIDATION_ERROR', 'Choose an active sport');
    const c = await tx.court.create({ data: { name: input.name, venueId, sportId: input.sportId, priceRegular: input.priceRegular, pricePeak: input.pricePeak ?? null } });
    await tx.auditLog.create({ data: { actorId: managerId, action: 'COURT_CREATED', targetType: 'Court', targetId: c.id } });
    return { id: c.id, name: c.name, sportId: c.sportId, priceRegular: c.priceRegular.toFixed(2), pricePeak: c.pricePeak?.toFixed(2) ?? null };
  });
}

export async function inviteStaff(deps: AppDeps, managerId: string, venueId: string, input: { fullName: string; email: string; phone: string }) {
  await assertOwnVenue(deps, managerId, venueId);
  const token = newRefreshToken(); const now = deps.clock.now();
  const userId = await withTx(deps.prisma, async tx => {
    await lockUser(tx, managerId);
    if (await tx.staffProfile.count({ where: { venueId } }) >= 5) throw new AppError('CONFLICT', 'At most five staff members per venue');
    if (await tx.user.findFirst({ where: { OR: [{ email: input.email }, { phone: input.phone }] } })) throw new AppError('CONFLICT', 'E-mail or phone number already registered');
    const user = await tx.user.create({ data: { ...input, status: 'UNVERIFIED', role: 'STAFF', emailVerified: false, createdAt: now } });
    await tx.staffProfile.create({ data: { userId: user.id, venueId, invitedById: managerId } });
    await tx.authToken.create({ data: { userId: user.id, purpose: 'STAFF_INVITE', tokenHash: hashOtp(deps.env.OTP_PEPPER, user.id, 'STAFF_INVITE', token), expiresAt: new Date(now.getTime() + INVITE_MS), createdAt: now } });
    await tx.auditLog.create({ data: { actorId: managerId, action: 'STAFF_INVITED', targetType: 'User', targetId: user.id, reason: `Venue ${venueId}` } });
    return user.id;
  });
  const link = `${deps.env.WEB_BASE_URL.replace(/\/$/, '')}/accept-invite?userId=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`;
  await sendSafely(deps, { to: input.email, subject: 'AthleteVerse staff invitation', text: `You have been invited to work at an AthleteVerse venue. Set your password within 48 hours:\n${link}\n\nIf you did not expect this, ignore this e-mail.` });
  return { ok: true as const };
}

export async function acceptStaffInvite(deps: AppDeps, userId: string, token: string, password: string) {
  const now = deps.clock.now();
  const hash = await hashPassword(password, deps.env.BCRYPT_COST);
  return withTx(deps.prisma, async tx => {
    await lockUser(tx, userId);
    const u = await tx.user.findUnique({ where: { id: userId }, include: { staffProfile: true } });
    if (!u || u.role !== 'STAFF' || u.status !== 'UNVERIFIED' || !u.staffProfile) throw new AppError('OTP_EXPIRED', 'Invitation is invalid or already used');
    const invite = await tx.authToken.findFirst({ where: { userId, purpose: 'STAFF_INVITE', usedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!invite || invite.expiresAt <= now || !otpMatches(invite.tokenHash, deps.env.OTP_PEPPER, userId, 'STAFF_INVITE', token)) {
      throw new AppError('OTP_EXPIRED', 'Invitation is invalid or expired');
    }
    const claim = await tx.authToken.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: now } });
    if (!claim.count) throw new AppError('OTP_EXPIRED', 'Invitation already used');
    await tx.user.update({ where: { id: userId }, data: { passwordHash: hash, emailVerified: true, status: 'ACTIVE' } });
    return { ok: true as const };
  });
}

export async function staffList(deps: AppDeps, managerId: string, venueId: string) {
  await assertOwnVenue(deps, managerId, venueId);
  const rows = await deps.prisma.staffProfile.findMany({ where: { venueId }, include: { user: true } });
  return { items: rows.map(s => ({ id: s.userId, fullName: s.user.fullName, email: s.user.email, status: s.user.status, disabled: !!s.disabledAt })) };
}

export async function setStaffDisabled(deps: AppDeps, managerId: string, staffId: string, disabled: boolean) {
  const row = await deps.prisma.staffProfile.findUnique({ where: { userId: staffId }, include: { venue: true } });
  if (!row || row.venue.managerId !== managerId) throw notFound('Staff');
  const now = deps.clock.now();
  await withTx(deps.prisma, async tx => {
    await lockUser(tx, staffId);
    await tx.staffProfile.update({ where: { userId: staffId }, data: { disabledAt: disabled ? now : null } });
    if (disabled) await tx.userSession.updateMany({ where: { userId: staffId, revokedAt: null }, data: { revokedAt: now } });
    await tx.auditLog.create({ data: { actorId: managerId, action: disabled ? 'STAFF_DISABLED' : 'STAFF_ENABLED', targetType: 'User', targetId: staffId, reason: 'Manager action' } });
  });
  return { ok: true as const };
}
