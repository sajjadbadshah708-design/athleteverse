import { z } from 'zod';

// Profile rules (SRS Table 10, A7, FR-1.14, FR-1.15). Written once: the API enforces them, the web form gives instant feedback.
// M2 (Phase 1): the profile gate is narrowed to name, e-mail, phone, city and date of birth; sports, positions, levels and
// availability arrive with the Teams sprint.

export const MIN_PLAYER_AGE = 16; // A7
export const AREA_MAX_LENGTH = 50; // Table 10
export const OLDEST_BIRTH_YEAR = 1900; // anything earlier is a typing mistake

export const PROFILE_MESSAGES = {
  chooseCity: 'Choose your city.',
  dateRequired: 'Enter your date of birth.',
  invalidDate: 'Enter a valid date of birth.',
  tooYoung: `You must be at least ${MIN_PLAYER_AGE} years old to use AthleteVerse.`,
  dateLocked: 'Your date of birth is already saved and cannot be changed here. Contact support if it is wrong.',
  areaTooLong: `Use at most ${AREA_MAX_LENGTH} characters.`,
} as const;

/** True for a real calendar date written YYYY-MM-DD (rejects 2008-02-30 and 2007-13-01). */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Whole years between a birth date and "today" (both YYYY-MM-DD). A 29 February birthday counts from 1 March in other years.
 * Dates are compared as text, so no time zone can shift the answer: callers decide what "today" is.
 */
export function ageOn(dateOfBirth: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return today.slice(5) < dateOfBirth.slice(5) ? years - 1 : years;
}

/** The message to show for a date of birth that cannot be accepted, or null if it is fine. */
export function dateOfBirthProblem(dateOfBirth: string, today: string): string | null {
  if (!isRealDate(dateOfBirth) || dateOfBirth > today || Number(dateOfBirth.slice(0, 4)) < OLDEST_BIRTH_YEAR) return PROFILE_MESSAGES.invalidDate;
  return ageOn(dateOfBirth, today) < MIN_PLAYER_AGE ? PROFILE_MESSAGES.tooYoung : null;
}

export const isoDateSchema = z.string().refine(isRealDate, PROFILE_MESSAGES.invalidDate);

export const profileRequestSchema = z.object({
  cityId: z.number({ error: PROFILE_MESSAGES.chooseCity }).int(PROFILE_MESSAGES.chooseCity).positive(PROFILE_MESSAGES.chooseCity),
  area: z.string().trim().max(AREA_MAX_LENGTH, PROFILE_MESSAGES.areaTooLong).optional(), // empty means "no area"
  dateOfBirth: isoDateSchema.optional(), // required the first time, then locked
});
export type ProfileRequest = z.infer<typeof profileRequestSchema>;

/** The date of birth is never sent back, not even to its owner (Table 10: "never displayed", FR-1.16). */
export const profileResponseSchema = z.object({
  cityId: z.number().int().nullable(),
  cityName: z.string().nullable(),
  area: z.string().nullable(),
  dateOfBirthProvided: z.boolean(),
  complete: z.boolean(),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

export const citySchema = z.object({ id: z.number().int(), name: z.string() });
export const citiesResponseSchema = z.object({ items: z.array(citySchema) });
export type City = z.infer<typeof citySchema>;

export const sportSchema = z.object({ id: z.number().int(), name: z.string(), minTeamSize: z.number().int(), maxTeamSize: z.number().int() });
export const sportsResponseSchema = z.object({ items: z.array(sportSchema) });
export type Sport = z.infer<typeof sportSchema>;
