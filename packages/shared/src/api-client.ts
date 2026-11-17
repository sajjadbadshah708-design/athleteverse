// Thin fetch wrapper shared by web and app. No business rules here (FR-5.17).
// Web: same-origin /api/v1 via the Vercel rewrite, cookies. App: absolute baseUrl and a Bearer token (Sprint 3b).
import { ERROR_HTTP_STATUS, type ErrorCode } from './errors';
import { errorEnvelopeSchema } from './schemas/common';
import type { Client } from './enums';

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  client: Client;
  baseUrl?: string; // '' for the web app
  appVersion?: string; // sent as X-App-Version (FR-5.18, later)
  getAccessToken?: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export function createApiClient(opts: ApiClientOptions) {
  const base = `${opts.baseUrl ?? ''}/api/v1`;
  const doFetch = opts.fetchImpl ?? fetch;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Client': opts.client.toLowerCase(), // required on mutating requests (CSRF guard, SEC-1)
    };
    if (opts.appVersion) headers['X-App-Version'] = opts.appVersion;
    const token = await opts.getAccessToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await doFetch(`${base}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 204) return undefined as T;
    const json: unknown = await res.json().catch(() => undefined);
    if (res.ok) return json as T;

    const parsed = errorEnvelopeSchema.safeParse(json);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(code, message, res.status, details);
    }
    throw new ApiError('INTERNAL', `Unexpected response (${res.status})`, res.status);
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
    delete: <T>(path: string) => request<T>('DELETE', path),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
export { ERROR_HTTP_STATUS };
