import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { App } from '../../src/App';
import { ApiProvider } from '../../src/api/ApiContext';
import { createWebApi } from '../../src/api/client';
import { AuthProvider } from '../../src/auth/AuthProvider';
import type { FakeServer } from './fakeServer';

/** Renders the whole app (real providers, real routes) against a fake server. */
export function renderApp(server: FakeServer, opts: { route?: string; fakeTimers?: boolean; initialEntry?: { pathname: string; search?: string; state?: unknown } } = {}) {
  const api = createWebApi({ fetchImpl: server.fetchImpl });
  const user = userEvent.setup(opts.fakeTimers ? { advanceTimers: (ms) => void vi.advanceTimersByTime(ms) } : {});
  const utils = render(
    <ApiProvider api={api}>
      <MemoryRouter initialEntries={[opts.initialEntry ?? opts.route ?? '/']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </ApiProvider>,
  );
  return { api, user, ...utils };
}
