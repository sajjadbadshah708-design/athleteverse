// Turns environment variables into seed options. Empty strings count as "not set".
import type { SeedOptions } from './run';

type Env = Record<string, string | undefined>;

export function seedOptionsFromEnv(env: Env): SeedOptions {
  const production = env.NODE_ENV === 'production';

  if (production && !(env.OWNER_EMAIL && env.OWNER_PHONE && env.OWNER_PASSWORD)) {
    throw new Error('Refusing to seed in production without OWNER_EMAIL, OWNER_PHONE and OWNER_PASSWORD.');
  }

  return {
    owner: {
      email: env.OWNER_EMAIL || 'owner@athleteverse.test',
      phone: env.OWNER_PHONE || '920000000000',
      password: env.OWNER_PASSWORD || 'ChangeMe12345',
    },
    seedDemo: (env.SEED_DEMO || (production ? 'false' : 'true')) === 'true', // demo accounts have a known password: off in production
    demoPassword: env.SEED_PASSWORD || 'Demo12345',
  };
}
