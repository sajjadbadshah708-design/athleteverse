// Authentication rules (SRS FR-1.1 to FR-1.4, FR-1.7, FR-1.8, FR-1.24). Routes call these functions; the database and the
// injected clock are the only sources of truth, so every rule below can be tested by moving the fake clock.
import type { AuthUser, RegisterRequest } from '@athleteverse/shared';
import type { PrismaClient } from '@prisma/client';
import { SQLSTATE, sqlState, uniqueViolationFields } from '../../db/pgErrors';
import { lockUser, withTx } from '../../db/tx';
import type { AppDeps } from '../../lib/deps';
import { AppError, type FieldIssue } from '../../lib/errors';
import { sendSafely } from '../../lib/mailer/mailer';
import { otpMessage } from '../../lib/mailer/templates';
import { assertUsable, findSession } from '../../middleware/authenticate';
import { generateOtp, hashOtp, OTP_MAX_ATTEMPTS, OTP_RESEND_AFTER_MS, OTP_TTL_MS, otpMatches } from './otp';
import { hashPassword, verifyPassword } from './password';
import { createSession, type IssuedSession, type SessionMeta } from './sessions';
import { hashRefreshToken, signAccessToken, verifyAccessToken } from './tokens';

export const MAX_FAILED_LOGINS = 5; // FR-1.7
export const LOCK_MS = 15 * 60_000; // FR-1.7

const unauthenticated = () => new AppError('UNAUTHENTICATED', 'Sign in again');
const otpExpired = () => new AppError('OTP_EXPIRED', 'This code has expired or was used up. Request a new one.');
const invalidCredentials = () => new AppError('INVALID_CREDENTIALS', 'E-mail or password is not correct');

export interface SignedIn {
  user: AuthUser;
  accessToken: string;
  session: IssuedSession;
}

export async function loadAuthUser(prisma: PrismaClient, userId: string): Promise<AuthUser> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { playerProfile: { select: { userId: true } }, staffProfile: { select: { venueId: true } } },
  });
  const isPlayer = u.role === 'PLAYER';
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    role: u.role,
    status: u.status,
    creditScore: isPlayer ? u.creditScore : null,
    emailVerified: u.emailVerified,
    profileComplete: isPlayer ? u.playerProfile !== null : null,
    staffVenueId: u.staffProfile?.venueId ?? null,
  };
}

async function signedIn(deps: AppDeps, userId: string, session: IssuedSession): Promise<SignedIn> {
  const [user, accessToken] = await Promise.all([loadAuthUser(deps.prisma, userId), signAccessToken(deps, userId, session.sessionId)]);
  return { user, accessToken, session };
}

// ---------- registration and e-mail verification ----------

/** FR-1.1, FR-1.2. Creates an UNVERIFIED player and e-mails the code AFTER the transaction has committed (REL-4). */
export async function registerPlayer(deps: AppDeps, input: RegisterRequest): Promise<void> {
  const { prisma, clock, env } = deps;
  const passwordHash = await hashPassword(input.password, env.BCRYPT_COST);

  const taken = await prisma.user.findMany({
    where: { OR: [{ email: input.email }, { phone: input.phone }] },
    select: { email: true, phone: true },
  });
  const issues: FieldIssue[] = [];
  if (taken.some((u) => u.email === input.email)) issues.push({ in: 'body', path: 'email', message: 'This e-mail is already registered' });
  if (taken.some((u) => u.phone === input.phone)) issues.push({ in: 'body', path: 'phone', message: 'This phone number is already registered' });
  if (issues.length) throw new AppError('CONFLICT', 'Some details are already registered', { issues });

  const code = generateOtp();
  const now = clock.now();
  try {
    await withTx(prisma, async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          phone: input.phone,
          role: 'PLAYER',
          status: 'UNVERIFIED',
          fullName: input.fullName,
          passwordHash,
          termsAcceptedAt: now,
          createdAt: now,
        },
      });
      await tx.authToken.create({
        data: {
          userId: user.id,
          purpose: 'EMAIL_VERIFY',
          tokenHash: hashOtp(env.OTP_PEPPER, user.id, 'EMAIL_VERIFY', code),
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
          createdAt: now,
        },
      });
    });
  } catch (err) {
    // Two simultaneous registrations with the same e-mail: the database constraint is the judge.
    const fields = uniqueViolationFields(err).filter((f) => f === 'email' || f === 'phone');
    if (sqlState(err) === SQLSTATE.uniqueViolation && fields.length) {
      const raced = fields.map((path): FieldIssue => ({ in: 'body', path, message: `This ${path === 'email' ? 'e-mail' : 'phone number'} is already registered` }));
      throw new AppError('CONFLICT', 'Some details are already registered', { issues: raced });
    }
    throw err;
  }
  await sendSafely(deps, otpMessage(input.email, code, OTP_TTL_MS / 60_000));
}

/** FR-1.3. Always answers the same way, so it cannot be used to find out which e-mails are registered. */
export async function resendOtp(deps: AppDeps, email: string): Promise<void> {
  const { prisma, clock, env } = deps;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt || user.status !== 'UNVERIFIED' || !['PLAYER', 'MANAGER'].includes(user.role)) return;

  const now = clock.now();
  const latest = await prisma.authToken.findFirst({ where: { userId: user.id, purpose: 'EMAIL_VERIFY' }, orderBy: { createdAt: 'desc' } });
  if (latest && now.getTime() - latest.createdAt.getTime() < OTP_RESEND_AFTER_MS) return; // the client shows the 60-second timer

  const code = generateOtp();
  await withTx(prisma, async (tx) => {
    await tx.authToken.updateMany({ where: { userId: user.id, purpose: 'EMAIL_VERIFY', usedAt: null }, data: { usedAt: now } }); // older codes die
    await tx.authToken.create({
      data: {
        userId: user.id,
        purpose: 'EMAIL_VERIFY',
        tokenHash: hashOtp(env.OTP_PEPPER, user.id, 'EMAIL_VERIFY', code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        createdAt: now,
      },
    });
  });
  await sendSafely(deps, otpMessage(email, code, OTP_TTL_MS / 60_000));
}

/** FR-1.3: 10 minutes, 5 attempts. The attempt is counted atomically BEFORE the comparison, so parallel guesses cannot exceed 5. */
export async function verifyEmail(deps: AppDeps, input: { email: string; code: string }, meta: SessionMeta): Promise<SignedIn> {
  const { prisma, clock, env } = deps;
  const now = clock.now();
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || user.deletedAt || user.status !== 'UNVERIFIED' || !['PLAYER', 'MANAGER'].includes(user.role)) throw otpExpired();

  const token = await prisma.authToken.findFirst({
    where: { userId: user.id, purpose: 'EMAIL_VERIFY', usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!token) throw otpExpired();

  const counted = await prisma.$queryRaw<{ attempts: number }[]>`
    UPDATE auth_tokens SET attempts = attempts + 1
     WHERE id = ${token.id}::uuid AND used_at IS NULL AND attempts < ${OTP_MAX_ATTEMPTS} AND expires_at > ${now}::timestamptz
    RETURNING attempts`;
  if (!counted[0]) throw otpExpired();

  if (!otpMatches(token.tokenHash, env.OTP_PEPPER, user.id, 'EMAIL_VERIFY', input.code)) {
    throw new AppError('OTP_INVALID', 'That code is not correct', { attemptsLeft: OTP_MAX_ATTEMPTS - counted[0].attempts });
  }

  const session = await withTx(prisma, async (tx) => {
    const locked = await lockUser(tx, user.id);
    if (!locked || locked.status !== 'UNVERIFIED') throw otpExpired();
    const used = await tx.authToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: now } });
    if (used.count !== 1) throw otpExpired(); // the same code submitted twice at once
    await tx.user.update({ where: { id: user.id }, data: { status: user.role === 'MANAGER' ? 'PENDING_APPROVAL' : 'ACTIVE', emailVerified: true } });
    return createSession(deps, tx, user.id, meta);
  });
  return signedIn(deps, user.id, session);
}

// ---------- login ----------

/** Counts a failed password. The fifth consecutive failure locks the account for 15 minutes (FR-1.7). Returns the lock end, if any. */
export async function recordFailedLogin(deps: AppDeps, userId: string): Promise<Date | null> {
  const now = deps.clock.now();
  const lockUntil = new Date(now.getTime() + LOCK_MS);
  const rows = await deps.prisma.$queryRaw<{ lockedUntil: Date | null }[]>`
    UPDATE users SET
      failed_logins = CASE WHEN failed_logins + 1 >= ${MAX_FAILED_LOGINS} THEN 0 ELSE failed_logins + 1 END,
      locked_until  = CASE WHEN failed_logins + 1 >= ${MAX_FAILED_LOGINS} THEN ${lockUntil}::timestamptz ELSE locked_until END
     WHERE id = ${userId}::uuid
    RETURNING locked_until AS "lockedUntil"`;
  const lockedUntil = rows[0]?.lockedUntil;
  return lockedUntil && lockedUntil > now ? lockedUntil : null;
}

const lockedError = (until: Date) =>
  new AppError('ACCOUNT_LOCKED', 'Too many failed sign-in attempts. Try again later.', { lockedUntil: until.toISOString() });

export async function login(deps: AppDeps, input: { email: string; password: string }, meta: SessionMeta): Promise<SignedIn> {
  const { prisma, clock, env } = deps;
  const now = clock.now();
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user || user.deletedAt) {
    await verifyPassword(input.password, null, env.BCRYPT_COST); // same work as a real check
    throw invalidCredentials();
  }
  if (user.lockedUntil && user.lockedUntil > now) throw lockedError(user.lockedUntil);

  if (!(await verifyPassword(input.password, user.passwordHash, env.BCRYPT_COST))) {
    const lockedUntil = await recordFailedLogin(deps, user.id);
    throw lockedUntil ? lockedError(lockedUntil) : invalidCredentials();
  }

  // The password is right. Only now is anything about the account's state revealed.
  if (user.status === 'UNVERIFIED') throw new AppError('EMAIL_NOT_VERIFIED', 'Verify your e-mail address first', { email: user.email });
  if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED', 'Your account has been suspended');
  if (user.role === 'ADMIN') throw new AppError('FORBIDDEN', 'Super Admin sign-in needs a second step and is not available yet'); // T18: SA-3, FR-1.9
  if (user.role === 'STAFF') {
    const assignment = await prisma.staffProfile.findUnique({ where: { userId: user.id } });
    if (!assignment || assignment.disabledAt) throw new AppError('ACCOUNT_SUSPENDED', 'Your account has been disabled');
  }

  const session = await withTx(prisma, async (tx) => {
    await lockUser(tx, user.id); // serialises simultaneous sign-ins so the session cap holds
    if (user.failedLogins > 0 || user.lockedUntil) {
      await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    }
    return createSession(deps, tx, user.id, meta);
  });
  return signedIn(deps, user.id, session);
}

// ---------- refresh, logout ----------

export async function revokeSession(prisma: PrismaClient, sessionId: string, now: Date): Promise<void> {
  await prisma.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now } });
}

/** FR-1.8: a valid refresh token gives a fresh 15-minute access token. Web refresh tokens are not rotated (D6). */
export async function refreshSession(deps: AppDeps, refreshToken: string | undefined): Promise<{ user: AuthUser; accessToken: string }> {
  const { prisma, clock } = deps;
  if (!refreshToken) throw unauthenticated();
  const row = await findSession(prisma, { refreshTokenHash: hashRefreshToken(refreshToken) });
  const now = clock.now();
  if (!row || row.revokedAt || row.expiresAt <= now) throw unauthenticated();
  try {
    assertUsable(row, ['ACTIVE', 'PENDING_APPROVAL', 'REJECTED']);
  } catch (err) {
    if (err instanceof AppError && err.code === 'ACCOUNT_SUSPENDED') await revokeSession(prisma, row.sessionId, now);
    throw err;
  }
  if (row.role === 'ADMIN' && now.getTime() - row.lastUsedAt.getTime() > 15 * 60000) {
    await revokeSession(prisma, row.sessionId, now);
    throw unauthenticated();
  }
  await prisma.userSession.update({ where: { id: row.sessionId }, data: { lastUsedAt: now } });
  const [user, accessToken] = await Promise.all([loadAuthUser(prisma, row.userId), signAccessToken(deps, row.userId, row.sessionId)]);
  return { user, accessToken };
}

/** FR-1.8: revokes the session behind whichever token the caller still has. Never fails, so signing out always "works". */
export async function logout(deps: AppDeps, tokens: { accessToken?: string; refreshToken?: string }): Promise<void> {
  const { prisma, clock } = deps;
  const now = clock.now();
  const ids = new Set<string>();
  if (tokens.accessToken) {
    const claims = await verifyAccessToken(deps, tokens.accessToken).catch(() => null);
    if (claims) ids.add(claims.sessionId);
  }
  if (tokens.refreshToken) {
    const row = await findSession(prisma, { refreshTokenHash: hashRefreshToken(tokens.refreshToken) });
    if (row) ids.add(row.sessionId);
  }
  for (const id of ids) await revokeSession(prisma, id, now);
}
