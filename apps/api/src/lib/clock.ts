// Every "what time is it" in the API goes through a Clock so tests can control time (cancellation windows, auto-close,
// no-show wait). ESLint forbids `new Date()` and `Date.now()` anywhere else in src/. All times are UTC instants (rule 5).
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string = '2030-01-15T12:00:00.000Z') {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current); // a copy, so callers cannot move the clock by mutating it
  }

  set(to: Date | string): void {
    this.current = new Date(to);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
