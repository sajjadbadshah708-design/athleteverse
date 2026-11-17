// Small form state: values, one error message per field, and "focus the first invalid field" so keyboard and screen
// reader users land on the problem (SRS USA-2, USA-3). Rules come from the shared Zod schemas, the same ones the API enforces.
import { ApiError } from '@athleteverse/shared';
import { useEffect, useId, useState } from 'react';
import type { ZodError } from 'zod';

export type FieldErrors = Record<string, string>;

export function errorsFromZod(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '');
    if (field && !(field in out)) out[field] = issue.message;
  }
  return out;
}

/** The API reports field problems as details.issues [{ in, path, message }] (validation and "already registered"). */
export function errorsFromApi(error: unknown): FieldErrors | null {
  if (!(error instanceof ApiError) || (error.code !== 'VALIDATION_ERROR' && error.code !== 'CONFLICT')) return null;
  const issues = (error.details as { issues?: { path?: string; message?: string }[] } | undefined)?.issues;
  if (!Array.isArray(issues)) return null;
  const out: FieldErrors = {};
  for (const issue of issues) {
    const field = String(issue.path ?? '').split('.')[0];
    if (field && issue.message && !(field in out)) out[field] = issue.message;
  }
  return Object.keys(out).length ? out : null;
}

export function useForm<V extends Record<string, string | boolean>>(initial: V) {
  const [values, setValues] = useState<V>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [focusRequest, setFocusRequest] = useState<{ field: string } | null>(null);
  const formId = useId(); // put it on the <form id=...>; the hook finds the first invalid field inside it

  useEffect(() => {
    if (focusRequest) document.getElementById(formId)?.querySelector<HTMLElement>(`[name="${focusRequest.field}"]`)?.focus();
  }, [focusRequest, formId]);

  return {
    values,
    errors,
    formId,
    set<K extends keyof V & string>(name: K, value: V[K]) {
      setValues((v) => ({ ...v, [name]: value }));
      setErrors((e) => {
        if (!(name in e)) return e;
        const { [name]: _removed, ...rest } = e;
        return rest;
      });
    },
    showErrors(next: FieldErrors) {
      setErrors(next);
      const first = Object.keys(next)[0];
      if (first) setFocusRequest({ field: first });
    },
  };
}
