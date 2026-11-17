// defineRoute: ONE declaration gives access control, validation (Zod), response filtering, the OpenAPI document (MNT-4) and
// SRS traceability. `access` is required, so a route cannot be added without deciding who may call it (deny by default).
// Request parts are validated before the handler runs; the handler's result is parsed through `response`, so only declared
// fields can leave the API (a safety net for FR-1.16: a password hash or birth date cannot leak by accident).
import type { Role, UserStatus } from '@athleteverse/shared';
import type { Request, RequestHandler, Response, Router } from 'express';
import type { z } from 'zod';
import { authorize, type AuthContext } from '../middleware/authenticate';
import type { AppDeps } from './deps';
import { AppError, validationError, type FieldIssue } from './errors';

export type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

/** 'public': no sign-in. Otherwise the listed roles, in the listed account statuses (default: ACTIVE only). */
export type Access = 'public' | { roles: readonly Role[]; statuses?: readonly UserStatus[] };

export interface RouteCtx<P, Q, B, A extends Access> {
  params: P;
  query: Q;
  body: B;
  deps: AppDeps;
  req: Request;
  res: Response;
  auth: A extends 'public' ? undefined : AuthContext;
}

export interface RouteDef<P, Q, B, R, A extends Access> {
  method: HttpMethod;
  path: string; // Express style (/bookings/:id), relative to /api/v1
  summary: string;
  tags: string[];
  srs: string[]; // SRS requirement IDs this endpoint implements (rule 4); shown in the docs
  access: A;
  middleware?: ((deps: AppDeps) => RequestHandler)[]; // e.g. rate limits; run before authentication
  params?: z.ZodType<P>;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
  response: z.ZodType<R>;
  status?: 200 | 201;
  handler(ctx: RouteCtx<P, Q, B, A>): Promise<R> | R; // method syntax keeps AnyRoute assignable
}

export type AnyRoute = RouteDef<unknown, unknown, unknown, unknown, Access>;

export function defineRoute<P = unknown, Q = unknown, B = unknown, R = unknown, A extends Access = 'public'>(
  def: RouteDef<P, Q, B, R, A>,
): AnyRoute {
  return def as unknown as AnyRoute;
}

function check(schema: z.ZodType | undefined, value: unknown, where: FieldIssue['in'], issues: FieldIssue[]): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    issues.push({ in: where, path: issue.path.map(String).join('.'), message: issue.message });
  }
  return undefined;
}

export function mountRoutes(router: Router, routes: AnyRoute[], deps: AppDeps): void {
  for (const route of routes) {
    const label = `${route.method.toUpperCase()} ${route.path}`;
    const middleware = (route.middleware ?? []).map((make) => make(deps));

    router[route.method](route.path, ...middleware, async (req: Request, res: Response) => {
      // 1. who is calling (401/403 before anything about the payload is revealed)
      const auth = route.access === 'public' ? undefined : await authorize(deps, req, res, route.access, label);

      // 2. is the payload valid
      const issues: FieldIssue[] = [];
      const params = check(route.params, req.params, 'params', issues);
      const query = check(route.query, req.query, 'query', issues);
      const body = check(route.body, req.body, 'body', issues);
      if (issues.length) throw validationError(issues);

      // 3. do the work, then send only what the response schema declares
      const result = await route.handler({ params, query, body, deps, req, res, auth });
      const out = route.response.safeParse(result);
      if (!out.success) {
        deps.logger.error('response does not match its schema', {
          route: label,
          issues: out.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
        });
        throw new AppError('INTERNAL', 'Internal server error');
      }
      res.status(route.status ?? 200).json(out.data);
    });
  }
}
