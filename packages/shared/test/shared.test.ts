import { describe, expect, it } from 'vitest';
import {
  ApiError,
  BOOKING_STATUS_LABEL,
  BOOKING_STATUSES,
  ENUMS,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  PAGE_SIZE,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUSES,
  SLOT_STATE_LABEL,
  SLOT_STATES,
  TIER_LABEL,
  TIERS,
  ERROR_MESSAGES,
  PROFILE_MESSAGES,
  ROLE_LABEL,
  ROLES,
  USER_STATUSES,
  USER_STATUS_LABEL,
  addDays,
  ageOn,
  BOOKING_MESSAGES,
  createBookingRequestSchema,
  availabilityQuerySchema,
  createApiClient,
  dateOfBirthProblem,
  formatAmount,
  sumAmounts,
  tierOf,
  formatDateLong,
  formatHour,
  fullNameSchema,
  healthResponseSchema,
  isRealDate,
  otpCodeSchema,
  pageQuerySchema,
  passwordSchema,
  phoneSchema,
  profileRequestSchema,
  profileResponseSchema,
  registerRequestSchema,
  venueListQuerySchema,
} from '../src';

describe('enums', () => {
  it('every enum is non-empty and has unique values', () => {
    for (const [name, values] of Object.entries(ENUMS)) {
      expect(values.length, name).toBeGreaterThan(0);
      expect(new Set(values).size, name).toBe(values.length);
    }
  });
});

describe('error codes', () => {
  it('map to 4xx/5xx statuses', () => {
    for (const code of ERROR_CODES) {
      const status: number = ERROR_HTTP_STATUS[code];
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
  });
});

describe('labels (USA-5: same text on web and app)', () => {
  it('cover every status and are unique per group', () => {
    const groups: [readonly string[], Record<string, string>][] = [
      [BOOKING_STATUSES, BOOKING_STATUS_LABEL],
      [PAYMENT_STATUSES, PAYMENT_STATUS_LABEL],
      [SLOT_STATES, SLOT_STATE_LABEL],
      [TIERS, TIER_LABEL],
    ];
    for (const [keys, labels] of groups) {
      expect(Object.keys(labels).sort()).toEqual([...keys].sort());
      expect(new Set(Object.values(labels)).size).toBe(keys.length);
    }
  });
});

describe('pagination (PERF-4)', () => {
  it('is 20 per page, page defaults to 1 and must be positive', () => {
    expect(PAGE_SIZE).toBe(20);
    expect(pageQuerySchema.parse({}).page).toBe(1);
    expect(pageQuerySchema.parse({ page: '3' }).page).toBe(3);
    expect(pageQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
});

describe('api client', () => {
  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('sends client headers and returns parsed JSON', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const api = createApiClient({
      client: 'ANDROID',
      baseUrl: 'https://api.example.test',
      appVersion: '1.0.0',
      getAccessToken: () => 'tok',
      fetchImpl: async (url, init) => {
        seen = { url: String(url), init: init ?? {} };
        return jsonResponse(200, { ok: true });
      },
    });
    await expect(api.get('/health')).resolves.toEqual({ ok: true });
    expect(seen?.url).toBe('https://api.example.test/api/v1/health');
    const h = seen?.init.headers as Record<string, string>;
    expect(h['X-Client']).toBe('android');
    expect(h['X-App-Version']).toBe('1.0.0');
    expect(h.Authorization).toBe('Bearer tok');
  });

  it('turns the error envelope into ApiError with the typed code', async () => {
    const api = createApiClient({
      client: 'WEB',
      fetchImpl: async () => jsonResponse(409, { error: { code: 'SLOT_TAKEN', message: 'Slot taken', details: { alternatives: [] } } }),
    });
    const err = await api.post('/bookings', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('SLOT_TAKEN');
    expect((err as ApiError).status).toBe(409);
  });

  it('falls back to INTERNAL on a non-envelope failure', async () => {
    const api = createApiClient({ client: 'WEB', fetchImpl: async () => new Response('<html>', { status: 502 }) });
    const err = (await api.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('INTERNAL');
    expect(err.status).toBe(502);
  });
});

describe('health response (PERF-2, rule 5)', () => {
  const ok = { status: 'ok', db: 'up', time: '2030-01-15T12:00:00.000Z', version: 'dev', apiVersion: 'v1' };

  it('accepts a UTC timestamp and rejects an offset or a non-date', () => {
    expect(healthResponseSchema.safeParse(ok).success).toBe(true);
    expect(healthResponseSchema.safeParse({ ...ok, time: '2030-01-15T14:00:00+02:00' }).success).toBe(false);
    expect(healthResponseSchema.safeParse({ ...ok, time: 'yesterday' }).success).toBe(false);
  });

  it('only allows the documented states', () => {
    expect(healthResponseSchema.safeParse({ ...ok, status: 'fine' }).success).toBe(false);
    expect(healthResponseSchema.safeParse({ ...ok, db: 'sleeping' }).success).toBe(false);
    expect(healthResponseSchema.safeParse({ ...ok, db: 'unchecked' }).success).toBe(true);
  });
});

describe('auth field rules (FR-1.4, Table 10)', () => {
  const valid = {
    fullName: "Anne-Marie O'Neil",
    email: '  Player@Example.COM ',
    phone: '+92 (300) 123-4567',
    password: 'Passw0rdOK',
    acceptTerms: true,
    confirmAge16: true,
  };

  it('normalises e-mail to lower case and phone to digits only', () => {
    const parsed = registerRequestSchema.parse(valid);
    expect(parsed.email).toBe('player@example.com');
    expect(parsed.phone).toBe('923001234567');
  });

  it('names letters from any script, rejects digits and symbols', () => {
    for (const ok of ['Li Wei', 'José Núñez', 'محمد علي', "D'Arcy"]) expect(fullNameSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['A', 'R2-D2', 'Bob <b>', 'x'.repeat(51)]) expect(fullNameSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('passwords need 8+ characters, a letter and a digit, at most 72 bytes', () => {
    for (const ok of ['abcdefg1', 'Passw0rd!', 'ß'.repeat(7) + '1']) expect(passwordSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['short1', 'allletters', '12345678', 'a1' + 'x'.repeat(71), 'ß'.repeat(40) + '1']) {
      expect(passwordSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('phones need 9 to 15 digits', () => {
    expect(phoneSchema.safeParse('12345678').success).toBe(false);
    expect(phoneSchema.safeParse('1234567890123456').success).toBe(false);
    expect(phoneSchema.safeParse('123456789').success).toBe(true);
    expect(phoneSchema.safeParse('abc123456789').success).toBe(false);
  });

  it('registration needs the Terms and the 16+ declaration (FR-1.1, A7)', () => {
    expect(registerRequestSchema.safeParse({ ...valid, acceptTerms: false }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...valid, confirmAge16: false }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...valid, acceptTerms: undefined }).success).toBe(false);
  });

  it('OTP codes are exactly six digits', () => {
    expect(otpCodeSchema.safeParse('012345').success).toBe(true);
    for (const bad of ['12345', '1234567', 'abcdef', '12 345']) expect(otpCodeSchema.safeParse(bad).success, bad).toBe(false);
  });
});

describe('user-facing strings (USA-3, USA-4)', () => {
  it('every error code has a message that tells the user what to do, with no technical words', () => {
    for (const code of ERROR_CODES) {
      const message = ERROR_MESSAGES[code];
      expect(message.length, code).toBeGreaterThan(15);
      expect(message, code).not.toMatch(/SQL|exception|stack|undefined|null|HTTP|\b[A-Z_]{6,}\b/);
    }
  });

  it('every role and account status has a label', () => {
    expect(Object.keys(ROLE_LABEL).sort()).toEqual([...ROLES].sort());
    expect(Object.keys(USER_STATUS_LABEL).sort()).toEqual([...USER_STATUSES].sort());
  });
});

describe('profile rules (A7, Table 10, FR-1.14)', () => {
  it('counts whole years, with the birthday itself counting', () => {
    expect(ageOn('2014-01-15', '2030-01-15')).toBe(16); // sixteen today
    expect(ageOn('2014-01-16', '2030-01-15')).toBe(15); // one day short
    expect(ageOn('2000-12-31', '2030-01-01')).toBe(29);
    expect(ageOn('2014-01-15', '2014-01-15')).toBe(0);
  });

  it('treats a 29 February birthday as 1 March in other years', () => {
    expect(ageOn('2008-02-29', '2024-02-28')).toBe(15);
    expect(ageOn('2008-02-29', '2024-02-29')).toBe(16); // leap year: the real day
    expect(ageOn('2008-02-29', '2025-02-28')).toBe(16);
    expect(ageOn('2008-02-29', '2025-03-01')).toBe(17);
  });

  it('recognises real calendar dates only', () => {
    for (const ok of ['2000-02-29', '1999-12-31', '2030-01-15']) expect(isRealDate(ok), ok).toBe(true);
    for (const bad of ['2001-02-29', '2008-02-30', '2007-13-01', '2007-00-10', '07-01-2000', '2000/01/01', 'tomorrow', '']) {
      expect(isRealDate(bad), bad).toBe(false);
    }
  });

  it('explains why a date of birth is refused', () => {
    const today = '2030-01-15';
    expect(dateOfBirthProblem('2000-06-01', today)).toBeNull();
    expect(dateOfBirthProblem('2014-01-15', today)).toBeNull(); // exactly 16
    expect(dateOfBirthProblem('2014-01-16', today)).toBe(PROFILE_MESSAGES.tooYoung);
    expect(dateOfBirthProblem('2030-01-16', today)).toBe(PROFILE_MESSAGES.invalidDate); // the future
    expect(dateOfBirthProblem('1899-12-31', today)).toBe(PROFILE_MESSAGES.invalidDate);
    expect(dateOfBirthProblem('2001-02-30', today)).toBe(PROFILE_MESSAGES.invalidDate);
  });

  it('the profile request needs a whole-number city, a short area and a real date', () => {
    expect(profileRequestSchema.safeParse({ cityId: 3, area: '  Downtown ', dateOfBirth: '2000-01-01' }).success).toBe(true);
    expect(profileRequestSchema.parse({ cityId: 3, area: '  Downtown ' }).area).toBe('Downtown');
    expect(profileRequestSchema.safeParse({ cityId: NaN }).success).toBe(false);
    expect(profileRequestSchema.safeParse({ cityId: 0 }).success).toBe(false);
    expect(profileRequestSchema.safeParse({ cityId: 1.5 }).success).toBe(false);
    expect(profileRequestSchema.safeParse({ cityId: 1, area: 'x'.repeat(51) }).success).toBe(false);
    expect(profileRequestSchema.safeParse({ cityId: 1, dateOfBirth: '2000-02-31' }).success).toBe(false);
    const nan = profileRequestSchema.safeParse({ cityId: NaN });
    expect(nan.success ? '' : nan.error.issues[0]!.message).toBe(PROFILE_MESSAGES.chooseCity);
  });

  it('the profile response has no date of birth field at all (FR-1.16)', () => {
    expect(Object.keys(profileResponseSchema.shape)).not.toContain('dateOfBirth');
  });
});

describe('format helpers (USA-5: the same text everywhere)', () => {
  it('adds calendar days across month, year and leap-year edges', () => {
    expect(addDays('2030-01-15', 14)).toBe('2030-01-29');
    expect(addDays('2030-12-31', 1)).toBe('2031-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2029-02-28', 1)).toBe('2029-03-01');
    expect(addDays('2030-03-01', -1)).toBe('2030-02-28');
  });

  it('writes hours as 08:00 and midnight as 24:00', () => {
    expect(formatHour(8)).toBe('08:00');
    expect(formatHour(0)).toBe('00:00');
    expect(formatHour(23)).toBe('23:00');
    expect(formatHour(24)).toBe('24:00');
  });

  it('writes amounts without a pointless ".00" and with grouped thousands, never changing the value', () => {
    expect(formatAmount('1200.00')).toBe('1,200');
    expect(formatAmount('10.50')).toBe('10.50');
    expect(formatAmount('0.05')).toBe('0.05');
    expect(formatAmount('12345678.90')).toBe('12,345,678.90');
    expect(formatAmount('999.00')).toBe('999');
    expect(formatAmount('1000.00')).toBe('1,000');
  });

  it('writes a calendar date with its weekday, whatever time zone the computer is in', () => {
    expect(formatDateLong('2030-01-15')).toBe('Tuesday, 15 January 2030');
    expect(formatDateLong('2028-02-29')).toBe('Tuesday, 29 February 2028');
  });
});

describe('venue search and availability queries (FR-2.2, FR-2.5)', () => {
  it('turns query-string text into numbers and fills the defaults', () => {
    expect(venueListQuerySchema.parse({})).toEqual({ sort: 'name', page: 1 });
    expect(venueListQuerySchema.parse({ q: '  arena ', cityId: '2', sportId: '3', minPrice: '10', maxPrice: '25.5', sort: 'price', page: '4' })).toEqual({
      q: 'arena',
      cityId: 2,
      sportId: 3,
      minPrice: 10,
      maxPrice: 25.5,
      sort: 'price',
      page: 4,
    });
  });

  it('refuses nonsense', () => {
    for (const bad of [{ page: '0' }, { page: 'x' }, { sort: 'rating' }, { cityId: '0' }, { minPrice: '-1' }, { maxPrice: 'abc' }, { q: 'x'.repeat(81) }]) {
      expect(venueListQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('needs a real calendar date for availability', () => {
    expect(availabilityQuerySchema.safeParse({ date: '2030-01-16' }).success).toBe(true);
    for (const bad of [{}, { date: '' }, { date: '2030-02-30' }, { date: '16-01-2030' }, { date: 'tomorrow' }]) {
      expect(availabilityQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('credit tiers (Figure 7)', () => {
  const t = { good: 70, caution: 40 };
  it('puts every score in the right tier, including the exact boundaries', () => {
    const cases: [number, string][] = [[100, 'GOOD'], [70, 'GOOD'], [69, 'CAUTION'], [40, 'CAUTION'], [39, 'RESTRICTED'], [1, 'RESTRICTED'], [0, 'BLOCKED']];
    for (const [score, tier] of cases) expect(tierOf(score, t), String(score)).toBe(tier);
  });

  it('follows the thresholds it is given, and never lets a negative score escape being Blocked', () => {
    expect(tierOf(60, { good: 60, caution: 30 })).toBe('GOOD');
    expect(tierOf(59, { good: 60, caution: 30 })).toBe('CAUTION');
    expect(tierOf(-5, t)).toBe('BLOCKED');
  });
});

describe('adding money (FR-2.10)', () => {
  it('adds exactly, in cents, with no floating-point drift', () => {
    expect(sumAmounts(['20.00', '30.00'])).toBe('50.00');
    expect(sumAmounts(['0.10', '0.20'])).toBe('0.30'); // 0.1 + 0.2 is 0.30000000000000004 in floating point
    expect(sumAmounts(['1200.00', '1500.50', '1200.00'])).toBe('3900.50');
    expect(sumAmounts(['10.00'])).toBe('10.00');
    expect(sumAmounts([])).toBe('0.00');
  });
});

describe('the booking request (Table 14)', () => {
  const ok = { courtId: '11111111-1111-4111-8111-111111111111', startsAt: '2030-01-16T18:00:00.000Z', slots: 2 };
  it('takes a court, an exact UTC start and one to three hours', () => {
    expect(createBookingRequestSchema.safeParse(ok).success).toBe(true);
    for (const slots of [1, 3]) expect(createBookingRequestSchema.safeParse({ ...ok, slots }).success).toBe(true);
  });

  it('refuses everything else', () => {
    for (const bad of [{ ...ok, slots: 0 }, { ...ok, slots: 4 }, { ...ok, slots: 1.5 }, { ...ok, courtId: 'x' }, { ...ok, startsAt: '2030-01-16 18:00' }, { ...ok, startsAt: '2030-01-16T18:00:00+05:00' }, { courtId: ok.courtId }]) {
      expect(createBookingRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('words the reasons for the player', () => {
    expect(BOOKING_MESSAGES.tooLate(30)).toBe('This hour can no longer be booked: bookings close 30 minutes before the start.');
    expect(BOOKING_MESSAGES.tooFar(14)).toBe('You can book up to 14 days ahead.');
    expect(BOOKING_MESSAGES.tooManySlots(3)).toBe('You can book at most 3 hours at a time.');
  });
});
