import { describe, expect, it } from 'vitest';
import { seedOptionsFromEnv } from '../prisma/seed/options';
import { assertPasswordRule } from '../prisma/seed/run';

describe('seedOptionsFromEnv', () => {
  it('uses development defaults, with demo data on', () => {
    const o = seedOptionsFromEnv({});
    expect(o.seedDemo).toBe(true);
    expect(o.owner.email).toBe('owner@athleteverse.test');
  });

  it('treats empty strings as not set', () => {
    const o = seedOptionsFromEnv({ OWNER_EMAIL: '', OWNER_PHONE: '', OWNER_PASSWORD: '', SEED_DEMO: '', SEED_PASSWORD: '' });
    expect(o.owner.password).toBe('ChangeMe12345');
    expect(o.seedDemo).toBe(true);
    expect(o.demoPassword).toBe('Demo12345');
  });

  it('refuses production without all three owner variables', () => {
    expect(() => seedOptionsFromEnv({ NODE_ENV: 'production' })).toThrow(/OWNER_EMAIL/);
    expect(() => seedOptionsFromEnv({ NODE_ENV: 'production', OWNER_EMAIL: 'a@b.test', OWNER_PHONE: '921234567890' })).toThrow();
  });

  it('turns demo data off by default in production, but allows an explicit opt-in', () => {
    const owner = { NODE_ENV: 'production', OWNER_EMAIL: 'a@b.test', OWNER_PHONE: '921234567890', OWNER_PASSWORD: 'Str0ngPassw0rd' };
    expect(seedOptionsFromEnv(owner).seedDemo).toBe(false);
    expect(seedOptionsFromEnv({ ...owner, SEED_DEMO: 'true' }).seedDemo).toBe(true);
  });
});

describe('password rule (FR-1.4)', () => {
  it('needs 8+ characters with a letter and a digit', () => {
    expect(() => assertPasswordRule('Abcdefg1', 'x')).not.toThrow();
    for (const bad of ['Abc1', 'abcdefgh', '12345678', '']) expect(() => assertPasswordRule(bad, 'x')).toThrow();
  });
});
