import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { buildOpenApi, renderDocsHtml } from '../src/lib/openapi';
import { defineRoute } from '../src/lib/route';

const route = defineRoute({
  method: 'post',
  path: '/bookings/:id/cancel',
  summary: 'Cancel a booking <script>alert(1)</script>',
  tags: ['bookings'],
  srs: ['FR-2.20', 'FR-2.21'],
  access: { roles: ['PLAYER'] },
  params: z.object({ id: z.uuid() }),
  query: z.object({ dryRun: z.enum(['yes', 'no']).optional() }),
  body: z.object({ acknowledgedPoints: z.number().int().optional() }),
  response: z.object({ status: z.string() }),
  handler: () => ({ status: 'CANCELLED' }),
});

const doc = buildOpenApi([route]) as {
  openapi: string;
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, unknown>; securitySchemes: object };
};

describe('buildOpenApi', () => {
  const op = doc.paths['/bookings/{id}/cancel']!.post!;

  it('is OpenAPI 3.1 and converts Express paths to OpenAPI paths', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(['/bookings/{id}/cancel']);
  });

  it('derives path and query parameters, marking only path ones required', () => {
    const params = op.parameters as { name: string; in: string; required: boolean }[];
    expect(params).toEqual([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
      expect.objectContaining({ name: 'dryRun', in: 'query', required: false }),
    ]);
  });

  it('describes the request body, the success response and the shared error envelope', () => {
    expect(op.requestBody).toBeDefined();
    const responses = op.responses as Record<string, { content: Record<string, { schema: Record<string, unknown> }> }>;
    expect(responses['200']!.content['application/json']!.schema).toMatchObject({ type: 'object' });
    expect(responses.default!.content['application/json']!.schema).toEqual({ $ref: '#/components/schemas/ErrorEnvelope' });
    expect(doc.components.schemas.ErrorEnvelope).toBeDefined();
  });

  it('states who may call it: roles, statuses and the security schemes (SEC-3)', () => {
    expect(op['x-roles']).toEqual(['PLAYER']);
    expect(op['x-statuses']).toEqual(['ACTIVE']);
    expect(op.security).toEqual([{ cookieAuth: [] }, { bearerAuth: [] }]);
    expect(Object.keys((doc.components as { securitySchemes: object }).securitySchemes)).toEqual(['cookieAuth', 'bearerAuth']);
  });

  it('marks public routes as needing no credentials', () => {
    const publicRoute = defineRoute({ method: 'get', path: '/ping', summary: 'p', tags: ['t'], srs: [], access: 'public', response: z.object({}), handler: () => ({}) });
    const publicDoc = buildOpenApi([publicRoute]) as { paths: Record<string, Record<string, Record<string, unknown>>> };
    expect(publicDoc.paths['/ping']!.get!.security).toEqual([]);
  });

  it('carries the SRS ids for traceability (rule 4)', () => {
    expect(op['x-srs']).toEqual(['FR-2.20', 'FR-2.21']);
  });
});

describe('renderDocsHtml', () => {
  it('escapes route text, so a summary cannot inject markup', () => {
    const html = renderDocsHtml(doc);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('/api/v1/bookings/{id}/cancel');
    expect(html).toContain('FR-2.20, FR-2.21');
  });
});
