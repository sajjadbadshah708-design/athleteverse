// SRS FR-1.16: e-mail addresses and dates of birth are never shown to other users, and no hash or token ever leaves the API.
// This reads the OpenAPI document of EVERY route, so a future endpoint that adds such a field to its response fails here.
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from '../src/lib/openapi';
import { defineRoute, type AnyRoute } from '../src/lib/route';
import { ALL_ROUTES } from '../src/routes';

type Doc = { paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: unknown }> }> }>> };

/** Every property name that appears anywhere in the response schemas of the given routes, with the route path it came from. */
export function responseFields(routes: AnyRoute[]): { path: string; field: string }[] {
  const doc = buildOpenApi(routes) as unknown as Doc;
  const found: { path: string; field: string }[] = [];
  const visit = (node: unknown, path: string) => {
    if (Array.isArray(node)) node.forEach((n) => visit(n, path));
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'properties' && value && typeof value === 'object') for (const field of Object.keys(value)) found.push({ path, field });
        visit(value, path);
      }
    }
  };
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const op of Object.values(methods)) {
      for (const response of Object.values(op.responses)) for (const media of Object.values(response.content ?? {})) visit(media.schema, path);
    }
  }
  return found;
}

// Absolute privacy rules: no endpoint may expose these sensitive internal fields.
const NEVER_SENT = ['dateOfBirth', 'date_of_birth', 'passwordHash', 'password_hash', 'tokenHash', 'token_hash', 'refreshTokenHash', 'refresh_token_hash'];

// Authentication responses concern the same person who submitted their own credentials.
// They do not reveal another account to an unrelated user.
const OWN_DATA_ROUTES = new Set([
  '/me', '/auth/register', '/auth/login', '/auth/verify-email', '/auth/refresh',
  '/auth/register-manager', '/auth/admin/verify-otp',
]);

// Narrow, SRS-authorized disclosure exceptions. Do not add broad/public routes.
// National ID: only the Super Admin may review an Arena Manager application (SA-4).
// Staff e-mail: only the owning manager may administer their staff (FR-5.6).
// Player phone: only staff/manager of the booking venue (SRS 4.4, FR-1.16).
// Account contact details: only the Super Admin, who supervises every account (SA-4, FR-1.20).
// e-mail remains hidden from other players and all public discovery endpoints.
const AUTHORIZED_FIELDS: Record<string, { fields: readonly string[]; roles: readonly string[]; method: string }> = {
  '/admin/managers': { fields: ['email', 'nationalIdNo'], roles: ['ADMIN'], method: 'get' },
  '/admin/accounts': { fields: ['email', 'phone'], roles: ['ADMIN'], method: 'get' },
  '/manager/venues/{venueId}/staff': { fields: ['email'], roles: ['MANAGER'], method: 'get' },
  '/operations/venues/{venueId}/bookings': { fields: ['phone'], roles: ['MANAGER', 'STAFF'], method: 'get' },
  '/operations/bookings/{id}': { fields: ['phone'], roles: ['MANAGER', 'STAFF'], method: 'get' },
  '/manager/home': { fields: ['phone'], roles: ['MANAGER'], method: 'get' },
};
const PROTECTED_PII = ['email', 'phone', 'nationalIdNo', 'national_id_no'];
const openApiPath = (path: string) => path.replace(/:(\w+)/g, '{$1}');

describe('what the API can send (FR-1.16)', () => {
  const fields = responseFields(ALL_ROUTES);

  it('scans a meaningful number of response fields', () => {
    expect(fields.length).toBeGreaterThan(30);
  });

  it('never sends a birth date, password hash or token hash on any route', () => {
    expect(fields.filter((f) => NEVER_SENT.includes(f.field))).toEqual([]);
  });

  it('allows sensitive identity and contact fields only in explicit SRS-authorized routes', () => {
    const leaks = fields.filter(({ path, field }) => {
      if (!PROTECTED_PII.includes(field)) return false;
      if (OWN_DATA_ROUTES.has(path) && (field === 'email' || field === 'phone')) return false;
      return !AUTHORIZED_FIELDS[path]?.fields.includes(field);
    });
    expect(leaks).toEqual([]);
  });

  it('requires strict role gates for every venue or admin disclosure exception', () => {
    for (const [path, rule] of Object.entries(AUTHORIZED_FIELDS)) {
      const route = ALL_ROUTES.find((r) => openApiPath(r.path) === path && r.method === rule.method);
      expect(route, `${rule.method.toUpperCase()} ${path} must exist`).toBeDefined();
      expect(route?.access, `${path} must never be public`).not.toBe('public');
      if (!route || route.access === 'public') continue;
      expect([...route.access.roles].sort(), `roles for ${path}`).toEqual([...rule.roles].sort());
    }
  });

  it('the scanner itself catches a leak (proof that this test can fail)', () => {
    const leaky = defineRoute({
      method: 'get',
      path: '/venues/:id/players',
      summary: 'leaks',
      tags: ['test'],
      srs: [],
      access: 'public',
      response: z.object({ items: z.array(z.object({ name: z.string(), email: z.string(), dateOfBirth: z.string() })) }),
      handler: () => ({ items: [] }),
    });
    const found = responseFields([leaky]);
    expect(found.filter((f) => NEVER_SENT.includes(f.field))).toHaveLength(1);
    expect(found.filter((f) => PROTECTED_PII.includes(f.field) && !OWN_DATA_ROUTES.has(f.path) && !AUTHORIZED_FIELDS[f.path]?.fields.includes(f.field))).toHaveLength(1);
  });
});
