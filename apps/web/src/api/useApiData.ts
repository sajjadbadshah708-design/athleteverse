import { useCallback, useEffect, useState } from 'react';
import { useApi } from './ApiContext';

export type Loaded<T> = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T };

/**
 * Loads one API path and reloads it when the path changes (a new date, a new filter). `retry` shows the loading state again;
 * `refresh` reloads quietly and keeps showing the old data, which is what the 15-second refresh of the availability grid needs
 * (FR-2.6): a failed quiet refresh never replaces good data with an error.
 */
export function useApiData<T>(path: string) {
  const api = useApi();
  const [result, setResult] = useState<{ path: string; value: Exclude<Loaded<T>, { status: 'loading' }> } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<T>(path)
      .then((data) => !cancelled && setResult({ path, value: { status: 'ready', data } }))
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult((prev) => (prev && prev.path === path && prev.value.status === 'ready' ? prev : { path, value: { status: 'error', error } }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, path, attempt]);

  const retry = useCallback(() => {
    setResult(null);
    setAttempt((a) => a + 1);
  }, []);
  const refresh = useCallback(() => setAttempt((a) => a + 1), []);

  const loaded: Loaded<T> = result && result.path === path ? result.value : { status: 'loading' };
  return { loaded, retry, refresh };
}
