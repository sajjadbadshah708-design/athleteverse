import { profileRequestSchema, profileResponseSchema } from '@athleteverse/shared';
import { defineRoute } from '../../lib/route';
import { getProfile, saveProfile } from './profile.service';

export const getProfileRoute = defineRoute({
  method: 'get',
  path: '/me/profile',
  summary: 'The signed-in player\'s profile (never includes the date of birth)',
  tags: ['profile'],
  srs: ['FR-1.14', 'FR-1.15', 'FR-1.16'],
  access: { roles: ['PLAYER'] },
  response: profileResponseSchema,
  handler: ({ deps, auth }) => getProfile(deps, auth.userId),
});

export const updateProfileRoute = defineRoute({
  method: 'patch',
  path: '/me/profile',
  summary: 'Complete or update the profile: city, area and (once) the date of birth, which must show an age of 16 or more',
  tags: ['profile'],
  srs: ['FR-1.14', 'FR-1.15', 'FR-1.16', 'A7'],
  access: { roles: ['PLAYER'] },
  body: profileRequestSchema,
  response: profileResponseSchema,
  handler: ({ deps, auth, body }) => saveProfile(deps, auth.userId, body),
});

export const PROFILE_ROUTES = [getProfileRoute, updateProfileRoute];
