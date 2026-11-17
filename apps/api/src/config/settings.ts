// Platform settings (SRS Table 26) read from the `settings` table, cached for 60 seconds. Read-only in the MVP (K3, FR-5.12
// Later). A stored value of the wrong type is ignored in favour of the default, with a warning, rather than breaking requests.
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import { SETTING_DEFAULTS, type SettingKey } from './settingsDefaults';

export type SettingValues = typeof SETTING_DEFAULTS;

export interface Settings {
  get<K extends SettingKey>(key: K): Promise<SettingValues[K]>;
}

const sameShape = (stored: unknown, fallback: unknown): boolean => {
  if (typeof fallback !== 'object' || fallback === null) return typeof stored === typeof fallback;
  if (typeof stored !== 'object' || stored === null) return false;
  const a = Object.keys(stored).sort().join();
  const b = Object.keys(fallback).sort().join();
  return a === b && Object.keys(fallback).every((k) => typeof (stored as Record<string, unknown>)[k] === typeof (fallback as Record<string, unknown>)[k]);
};

export function createSettings(prisma: PrismaClient, clock: Clock, logger: Logger, ttlMs = 60_000): Settings {
  let cache: { at: number; values: SettingValues } | undefined;
  let loading: Promise<SettingValues> | undefined;

  async function load(): Promise<SettingValues> {
    const rows = await prisma.setting.findMany();
    const values: Record<string, unknown> = { ...SETTING_DEFAULTS };
    for (const row of rows) {
      if (!(row.key in SETTING_DEFAULTS)) continue;
      if (sameShape(row.value, SETTING_DEFAULTS[row.key as SettingKey])) values[row.key] = row.value;
      else logger.warn('ignoring a setting with the wrong type', { key: row.key });
    }
    cache = { at: clock.now().getTime(), values: values as SettingValues };
    return cache.values;
  }

  return {
    async get(key) {
      const fresh = cache && clock.now().getTime() - cache.at < ttlMs;
      const values = fresh ? cache!.values : await (loading ??= load().finally(() => (loading = undefined)));
      return values[key];
    },
  };
}

/** Fixed values without a database, for tests. */
export function staticSettings(overrides: Partial<SettingValues> = {}): Settings {
  const values = { ...SETTING_DEFAULTS, ...overrides };
  return { get: async (key) => values[key] };
}
