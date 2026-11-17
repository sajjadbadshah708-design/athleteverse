import { ERROR_HTTP_STATUS, type AuthUser, type ErrorCode } from '@athleteverse/shared';

export interface Call {
  method: string;
  path: string; // without /api/v1
  search: string; // the query string, e.g. "?date=2030-01-16" (empty when there is none)
  body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const apiError = (code: ErrorCode, details?: unknown) =>
  json({ error: { code, message: 'server text the UI must never show', ...(details === undefined ? {} : { details }) } }, ERROR_HTTP_STATUS[code]);

export const sampleUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: '3f2b6b1e-9d9c-4f0e-8d57-0c2b4f1a7a11',
  email: 'ali@example.com',
  fullName: 'Ali Khan',
  phone: '923001234567',
  role: 'PLAYER',
  status: 'ACTIVE',
  creditScore: 100,
  emailVerified: true,
  profileComplete: false,
  staffVenueId: null,
  ...overrides,
});

/** A scripted stand-in for the API. Any request nobody planned for fails the test loudly. */
export function createFakeServer() {
  const handlers = new Map<string, Handler>();
  const calls: Call[] = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    const call: Call = { method, path, search: url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const handler = handlers.get(`${method} ${path}`);
    if (!handler) throw new Error(`Unplanned request: ${method} ${path}`);
    return handler(call);
  }) as typeof fetch;

  return {
    fetchImpl,
    calls,
    on(key: string, handler: Handler | Response) {
      handlers.set(key, typeof handler === 'function' ? handler : () => handler.clone());
    },
    count: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key).length,
    /** Visitor without a session: /me and refresh both say "not signed in". */
    anonymous() {
      this.on('GET /me', () => apiError('UNAUTHENTICATED'));
      this.on('POST /auth/refresh', () => apiError('UNAUTHENTICATED'));
    },
    /** Visitor with a valid session. */
    signedIn(user: AuthUser = sampleUser()) {
      this.on('GET /me', () => json({ user }));
    },
  };
}

export type FakeServer = ReturnType<typeof createFakeServer>;
