import { ApiError, ERROR_MESSAGES, STRINGS } from '@athleteverse/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createPendingTracker } from '../src/api/pending';
import { describeError } from '../src/errors';
import { errorsFromApi, errorsFromZod } from '../src/forms/useForm';

describe('describeError (USA-3)', () => {
  it('turns a lock into a clock time and a rate limit into seconds', () => {
    const locked = new ApiError('ACCOUNT_LOCKED', 'x', 423, { lockedUntil: '2030-01-15T12:15:00.000Z' });
    expect(describeError(locked)).toMatch(/^Too many failed attempts\. You can try again at \d{1,2}:\d{2}/);
    expect(describeError(new ApiError('RATE_LIMITED', 'x', 429, { retryAfterSeconds: 1 }))).toBe('Too many attempts. Try again in 1 second.');
    expect(describeError(new ApiError('RATE_LIMITED', 'x', 429, { retryAfterSeconds: 90 }))).toBe('Too many attempts. Try again in 90 seconds.');
  });

  it('falls back to the standard message when the details are missing', () => {
    expect(describeError(new ApiError('ACCOUNT_LOCKED', 'x', 423))).toBe(ERROR_MESSAGES.ACCOUNT_LOCKED);
    expect(describeError(new ApiError('SLOT_TAKEN', 'raw server text', 409))).toBe(ERROR_MESSAGES.SLOT_TAKEN);
  });

  it('treats anything that is not an API answer as "cannot reach the server"', () => {
    for (const e of [new TypeError('Failed to fetch'), 'boom', undefined]) expect(describeError(e)).toBe(STRINGS.network.unreachable);
  });
});

describe('field errors', () => {
  const issues = [{ in: 'body', path: 'email', message: 'taken' }];

  it('takes the first message for each field from a Zod result', () => {
    const schema = z.object({ a: z.string().min(3, 'too short').regex(/x/, 'needs x'), b: z.number() });
    const result = schema.safeParse({ a: 'a', b: 'no' });
    const errors = errorsFromZod(result.error!);
    expect(Object.keys(errors).sort()).toEqual(['a', 'b']);
    expect(errors.a).toBe('too short');
  });

  it('reads field problems from the API answers that carry them', () => {
    const issues = [{ in: 'body', path: 'email', message: 'taken' }, { in: 'body', path: 'address.city', message: 'bad city' }];
    expect(errorsFromApi(new ApiError('CONFLICT', 'x', 409, { issues }))).toEqual({ email: 'taken', address: 'bad city' });
    expect(errorsFromApi(new ApiError('VALIDATION_ERROR', 'x', 422, { issues }))).not.toBeNull();
  });

  it('ignores everything else, so the page shows one general message instead', () => {
    expect(errorsFromApi(new Error('x'))).toBeNull();
    expect(errorsFromApi(new ApiError('INTERNAL', 'x', 500, { issues }))).toBeNull();
    expect(errorsFromApi(new ApiError('CONFLICT', 'x', 409))).toBeNull();
    expect(errorsFromApi(new ApiError('CONFLICT', 'x', 409, { issues: 'nope' }))).toBeNull();
    expect(errorsFromApi(new ApiError('CONFLICT', 'x', 409, { issues: [{ path: 'a' }] }))).toBeNull(); // no message to show
  });
});

describe('pending tracker', () => {
  it('counts, notifies, and ignores a second "finished"', () => {
    const tracker = createPendingTracker();
    const heard = vi.fn();
    const stop = tracker.subscribe(heard);
    const a = tracker.start();
    const b = tracker.start();
    expect(tracker.count()).toBe(2);
    a();
    a(); // a repeated call must not count twice
    expect(tracker.count()).toBe(1);
    b();
    expect(tracker.count()).toBe(0);
    expect(heard).toHaveBeenCalledTimes(4);
    stop();
    tracker.start();
    expect(heard).toHaveBeenCalledTimes(4);
  });
});
