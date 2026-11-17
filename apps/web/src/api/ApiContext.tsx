import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createWebApi, type WebApi } from './client';

const ApiContext = createContext<WebApi | null>(null);

/** Provides the API client. Tests pass their own `api` (with a fake fetch). */
export function ApiProvider({ api, children }: { api?: WebApi; children: ReactNode }) {
  const value = useMemo(() => api ?? createWebApi(), [api]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): WebApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiProvider>');
  return api;
}
