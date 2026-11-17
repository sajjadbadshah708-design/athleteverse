// The web client's view of the API. It adds three things around the shared client and NO business rules (FR-5.17):
//  1. when a call answers "not signed in", it refreshes the session ONCE (shared between simultaneous calls) and retries;
//  2. it tells the app when the session is really lost or the account was suspended;
//  3. it counts pending requests so the UI can show the "starting up" message (PERF-2).
import { ApiError, createApiClient } from '@athleteverse/shared';
import { createPendingTracker, type PendingTracker } from './pending';

export type SessionLostReason = 'expired' | 'suspended';

export interface WebApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  pending: PendingTracker;
  /** Called when a signed-in session could not be kept alive. Returns an unsubscribe function. */
  onSessionLost(listener: (reason: SessionLostReason) => void): () => void;
}

export function createWebApi(opts: { fetchImpl?: typeof fetch } = {}): WebApi {
  const pending = createPendingTracker();
  const listeners = new Set<(reason: SessionLostReason) => void>();
  const emit = (reason: SessionLostReason) => listeners.forEach((l) => l(reason));

  const tracked = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const finish = pending.start();
    try {
      return await (opts.fetchImpl ?? fetch)(input, init);
    } finally {
      finish();
    }
  }) as typeof fetch;

  const client = createApiClient({ client: 'WEB', fetchImpl: tracked }); // same origin: /api/v1, cookies

  let refreshing: Promise<'ok' | SessionLostReason> | null = null;
  const refresh = () =>
    (refreshing ??= client.post('/auth/refresh').then(
      () => 'ok' as const,
      (e: unknown) => (e instanceof ApiError && e.code === 'ACCOUNT_SUSPENDED' ? ('suspended' as const) : ('expired' as const)),
    ).finally(() => {
      refreshing = null;
    }));

  async function guarded<T>(path: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      // Sign-in, sign-up and code calls report their own errors; only everyday calls are rescued.
      if (path.startsWith('/auth/') || !(error instanceof ApiError)) throw error;
      if (error.code === 'ACCOUNT_SUSPENDED') {
        emit('suspended');
        throw error;
      }
      if (error.code !== 'UNAUTHENTICATED') throw error;

      const outcome = await refresh();
      if (outcome !== 'ok') {
        emit(outcome);
        throw error;
      }
      try {
        return await call(); // the one retry
      } catch (again) {
        if (again instanceof ApiError && again.code === 'UNAUTHENTICATED') emit('expired');
        if (again instanceof ApiError && again.code === 'ACCOUNT_SUSPENDED') emit('suspended');
        throw again;
      }
    }
  }

  return {
    get: (path) => guarded(path, () => client.get(path)),
    post: (path, body) => guarded(path, () => client.post(path, body)),
    patch: (path, body) => guarded(path, () => client.patch(path, body)),
    pending,
    onSessionLost(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
