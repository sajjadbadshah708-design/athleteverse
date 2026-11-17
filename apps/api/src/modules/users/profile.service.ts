// FR-1.14, FR-1.15, A7. The profile is deliberately short (Table 10, narrowed by M2). The date of birth is used once, to check
// the age, and is never sent back to anyone (FR-1.16). Once saved it cannot be changed by the user: nothing displays it,
// and letting it change would let a 15-year-old retry until a date passes the check.
import { dateOfBirthProblem, PROFILE_MESSAGES, type ProfileRequest, type ProfileResponse } from '@athleteverse/shared';
import { lockUser, withTx } from '../../db/tx';
import type { AppDeps } from '../../lib/deps';
import { validationError, type FieldIssue } from '../../lib/errors';
import { localDateIn } from '../../lib/time';

export async function getProfile(deps: AppDeps, userId: string): Promise<ProfileResponse> {
  const profile = await deps.prisma.playerProfile.findUnique({ where: { userId }, include: { city: { select: { name: true } } } });
  return {
    cityId: profile?.cityId ?? null,
    cityName: profile?.city.name ?? null,
    area: profile?.area ?? null,
    dateOfBirthProvided: profile !== null,
    complete: profile !== null,
  };
}

export async function saveProfile(deps: AppDeps, userId: string, input: ProfileRequest): Promise<ProfileResponse> {
  const today = localDateIn(deps.env.PLATFORM_TZ, deps.clock.now()); // the age is judged on the platform's calendar day
  const city = await deps.prisma.city.findFirst({ where: { id: input.cityId, isActive: true }, select: { id: true } });

  await withTx(deps.prisma, async (tx) => {
    await lockUser(tx, userId); // two simultaneous first saves must not both try to create the row
    const existing = await tx.playerProfile.findUnique({ where: { userId }, select: { userId: true } });

    const issues: FieldIssue[] = [];
    if (!city) issues.push({ in: 'body', path: 'cityId', message: PROFILE_MESSAGES.chooseCity });
    if (!existing) {
      if (!input.dateOfBirth) issues.push({ in: 'body', path: 'dateOfBirth', message: PROFILE_MESSAGES.dateRequired });
      else {
        const problem = dateOfBirthProblem(input.dateOfBirth, today);
        if (problem) issues.push({ in: 'body', path: 'dateOfBirth', message: problem });
      }
    } else if (input.dateOfBirth !== undefined) {
      issues.push({ in: 'body', path: 'dateOfBirth', message: PROFILE_MESSAGES.dateLocked });
    }
    if (issues.length) throw validationError(issues);

    const area = input.area?.trim() || null;
    if (existing) await tx.playerProfile.update({ where: { userId }, data: { cityId: input.cityId, area } });
    else await tx.playerProfile.create({ data: { userId, cityId: input.cityId, area, dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00Z`) } });
  });

  return getProfile(deps, userId);
}
