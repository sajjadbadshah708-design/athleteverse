import { describe, expect, it } from 'vitest';
import { FakeClock, systemClock } from '../src/lib/clock';

describe('clock', () => {
  it('systemClock returns the current instant', () => {
    expect(Math.abs(systemClock.now().getTime() - new Date().getTime())).toBeLessThan(1000);
  });

  it('FakeClock starts fixed, can be set and advanced', () => {
    const c = new FakeClock('2030-01-15T12:00:00Z');
    expect(c.now().toISOString()).toBe('2030-01-15T12:00:00.000Z');
    c.advance(6 * 3600_000);
    expect(c.now().toISOString()).toBe('2030-01-15T18:00:00.000Z');
    c.set('2031-02-03T04:05:06Z');
    expect(c.now().toISOString()).toBe('2031-02-03T04:05:06.000Z');
  });

  it('hands out copies, so callers cannot move the clock', () => {
    const c = new FakeClock('2030-01-15T12:00:00Z');
    c.now().setFullYear(1999);
    expect(c.now().getUTCFullYear()).toBe(2030);
  });
});
