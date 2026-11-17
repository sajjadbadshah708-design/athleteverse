import { z } from 'zod';
import { ROLES, USER_STATUSES } from '../enums';

// Field rules are written once and used by the API and by both clients (SRS 3.1, FR-1.4, Table 10).

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid e-mail address'));

/** FR-1.4: at least 8 characters with a letter and a digit. At most 72 bytes because bcrypt ignores everything after that. */
export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .refine((s) => /\p{L}/u.test(s), 'Include at least one letter')
  .refine((s) => /\p{Nd}/u.test(s), 'Include at least one digit')
  .refine((s) => new TextEncoder().encode(s).length <= 72, 'Use at most 72 bytes');

/** Table 10: 9 to 15 digits. Spaces, dashes, brackets and a leading + are accepted and removed. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s().-]/g, '').replace(/^\+/, ''))
  .pipe(z.string().regex(/^\d{9,15}$/, 'Enter 9 to 15 digits'));

/** Table 10: 2 to 50 characters: letters, spaces, hyphen, apostrophe. */
export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter at least 2 characters')
  .max(50, 'Enter at most 50 characters')
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} '’-]*$/u, 'Use letters, spaces, hyphens and apostrophes only');

export const otpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const registerRequestSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, 'You must accept the Terms'),
  confirmAge16: z.literal(true, 'You must be at least 16 years old'), // FR-1.1, A7
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const registerResponseSchema = z.object({ status: z.literal('VERIFICATION_REQUIRED'), email: z.string() });

export const verifyEmailRequestSchema = z.object({ email: emailSchema, code: otpCodeSchema });
export const resendOtpRequestSchema = z.object({ email: emailSchema });
export const loginRequestSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password').max(200) });

/** What a signed-in user may know about themselves (FR-1.16: this is their own data, never anyone else's). */
export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  phone: z.string(),
  role: z.enum(ROLES),
  status: z.enum(USER_STATUSES),
  creditScore: z.number().int().nullable(), // players only
  emailVerified: z.boolean(),
  profileComplete: z.boolean().nullable(), // players only: the narrowed gate of M2 (FR-1.15)
  staffVenueId: z.uuid().nullable(), // staff only
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authResponseSchema = z.object({ user: authUserSchema });
export const okResponseSchema = z.object({ ok: z.literal(true) });
