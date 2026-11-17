// OpenAPI 3.1 document generated from the route declarations (MNT-4). Zod 4 converts schemas to JSON Schema natively.
import { errorEnvelopeSchema } from '@athleteverse/shared';
import { z } from 'zod';
import type { AnyRoute } from './route';

type Json = Record<string, unknown>;

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): Json {
  const { $schema: _omit, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Json;
  return rest;
}

function parameters(location: 'path' | 'query', schema: z.ZodType | undefined): Json[] {
  if (!schema) return [];
  const js = jsonSchema(schema, 'input') as { properties?: Record<string, Json>; required?: string[] };
  return Object.entries(js.properties ?? {}).map(([name, s]) => ({
    name,
    in: location,
    required: location === 'path' || (js.required ?? []).includes(name),
    schema: s,
  }));
}

const toOpenApiPath = (expressPath: string) => expressPath.replace(/:(\w+)/g, '{$1}');

export function buildOpenApi(routes: AnyRoute[]): Json {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const status = String(r.status ?? 200);
    const op: Json = {
      summary: r.summary,
      tags: r.tags,
      'x-srs': r.srs,
      ...(r.access === 'public'
        ? { security: [] }
        : { security: [{ cookieAuth: [] }, { bearerAuth: [] }], 'x-roles': r.access.roles, 'x-statuses': r.access.statuses ?? ['ACTIVE'] }),
      parameters: [...parameters('path', r.params), ...parameters('query', r.query)],
      responses: {
        [status]: { description: 'Success', content: { 'application/json': { schema: jsonSchema(r.response, 'output') } } },
        default: {
          description: 'Error envelope',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
        },
      },
    };
    if (r.body) op.requestBody = { required: true, content: { 'application/json': { schema: jsonSchema(r.body, 'input') } } };
    (paths[toOpenApiPath(r.path)] ??= {})[r.method] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'AthleteVerse API',
      version: 'v1',
      description: 'Generated from the route declarations. Errors use the envelope { error: { code, message, details? } }.',
    },
    servers: [{ url: '/api/v1' }],
    paths,
    components: {
      schemas: { ErrorEnvelope: jsonSchema(errorEnvelopeSchema, 'output') },
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'av_access', description: 'Web: HttpOnly cookie set by sign-in.' },
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Mobile app (Sprint 3b).' },
      },
    },
  };
}

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Self-contained page (no scripts, no external assets) so the strict Helmet CSP stays untouched. */
export function renderDocsHtml(doc: Json): string {
  const paths = doc.paths as Record<string, Record<string, { summary: string; tags: string[]; 'x-srs': string[] }>>;
  const rows = Object.entries(paths)
    .flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ path, method, ...op })))
    .sort((a, b) => a.tags[0]!.localeCompare(b.tags[0]!) || a.path.localeCompare(b.path))
    .map(
      (o) =>
        `<tr><td>${esc(o.tags.join(', '))}</td><td><b>${esc(o.method.toUpperCase())}</b></td><td><code>/api/v1${esc(o.path)}</code></td>` +
        `<td>${esc(o.summary)}</td><td>${esc(o['x-srs'].join(', '))}</td></tr>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AthleteVerse API</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}
th,td{border-bottom:1px solid #ccc;padding:.4rem .6rem;text-align:left;vertical-align:top}th{background:#f3f3f3}</style></head>
<body><h1>AthleteVerse API v1</h1>
<p>Machine-readable: <a href="/api/v1/openapi.json">openapi.json</a> (OpenAPI 3.1, importable into Postman or Swagger Editor).</p>
<table><thead><tr><th>Tag</th><th>Method</th><th>Path</th><th>Summary</th><th>SRS</th></tr></thead><tbody>
${rows}
</tbody></table></body></html>`;
}
