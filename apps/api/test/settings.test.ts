import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSettings } from '../src/config/settings';
import { SETTING_DEFAULTS } from '../src/config/settingsDefaults';
import { createDb } from '../src/db/prisma';
import { FakeClock } from '../src/lib/clock';
import { testDeps } from './helpers/app';
import { TEST_DATABASE_URL, resetDb } from './helpers/db';

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.close());
beforeEach(() => resetDb());

const setup = () => {
  const { deps, logs } = testDeps({ prisma: db.prisma });
  const clock = new FakeClock();
  return { logs, clock, settings: createSettings(db.prisma, clock, deps.logger) };
};

describe('settings (SRS Table 26)', () => {
  it('fall back to the defaults when the table is empty', async () => {
    const { settings } = setup();
    expect(await settings.get('sessions_per_user')).toBe(SETTING_DEFAULTS.sessions_per_user);
    expect(await settings.get('upcoming_limits')).toEqual({ GOOD: 3, CAUTION: 2, RESTRICTED: 1, BLOCKED: 0 });
  });

  it('use the stored value, and read the database at most once a minute', async () => {
    const { settings, clock } = setup();
    await db.prisma.setting.create({ data: { key: 'sessions_per_user', value: 3 } });
    expect(await settings.get('sessions_per_user')).toBe(3);

    await db.prisma.setting.update({ where: { key: 'sessions_per_user' }, data: { value: 7 } });
    clock.advance(59_000);
    expect(await settings.get('sessions_per_user')).toBe(3); // still cached
    clock.advance(1000);
    expect(await settings.get('sessions_per_user')).toBe(7); // refreshed after 60 s
  });

  it('ignore a stored value of the wrong type and say so, instead of breaking requests', async () => {
    const { settings, logs } = setup();
    await db.prisma.setting.create({ data: { key: 'sessions_per_user', value: 'five' } });
    await db.prisma.setting.create({ data: { key: 'upcoming_limits', value: { GOOD: 3 } } }); // missing tiers
    await db.prisma.setting.create({ data: { key: 'not_a_setting', value: 1 } });
    expect(await settings.get('sessions_per_user')).toBe(5);
    expect(await settings.get('upcoming_limits')).toEqual(SETTING_DEFAULTS.upcoming_limits);
    expect(logs.filter((l) => l.msg === 'ignoring a setting with the wrong type').map((l) => l.key).sort()).toEqual(['sessions_per_user', 'upcoming_limits']);
  });

  it('share one database read between simultaneous callers', async () => {
    const { settings } = setup();
    const values = await Promise.all(Array.from({ length: 20 }, () => settings.get('max_slots')));
    expect(new Set(values)).toEqual(new Set([3]));
  });
});
