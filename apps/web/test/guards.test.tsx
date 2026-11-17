// FR-1.11 (courtesy only: the API decides), USA-3. Route guards and the home page placeholder.
import { screen } from '@testing-library/react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from '../src/api/ApiContext';
import { createWebApi } from '../src/api/client';
import { AuthProvider } from '../src/auth/AuthProvider';
import { RequireRole, safeRedirect } from '../src/auth/guards';
import { createFakeServer, sampleUser } from './helpers/fakeServer';
import { renderApp } from './helpers/render';

function Where() {
  const location = useLocation();
  return <p>on {location.pathname} from {String((location.state as { from?: string } | null)?.from)}</p>;
}

function renderGuard(server: ReturnType<typeof createFakeServer>, element: React.ReactNode, route = '/p?x=1') {
  render(
    <ApiProvider api={createWebApi({ fetchImpl: server.fetchImpl })}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <Routes>
            <Route path="/p" element={element} />
            <Route path="/login" element={<Where />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </ApiProvider>,
  );
}

describe('RequireRole', () => {
  it('sends an anonymous visitor to the sign-in page and remembers where they wanted to go', async () => {
    const server = createFakeServer();
    server.anonymous();
    renderGuard(server, <RequireRole roles={['PLAYER']}>players only</RequireRole>);
    expect(await screen.findByText('on /login from /p?x=1')).toBeInTheDocument();
  });

  it('shows the screen to a listed role and a "no access" page to every other role', async () => {
    const player = createFakeServer();
    player.signedIn();
    renderGuard(player, <RequireRole roles={['PLAYER']}>players only</RequireRole>);
    expect(await screen.findByText('players only')).toBeInTheDocument();
  });

  it('refuses a manager on a players-only screen', async () => {
    const server = createFakeServer();
    server.signedIn(sampleUser({ role: 'MANAGER' }));
    renderGuard(server, <RequireRole roles={['PLAYER']}>players only</RequireRole>);
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    expect(screen.queryByText('players only')).not.toBeInTheDocument();
  });

  it('checks the account status too: ACTIVE unless the screen lists more', async () => {
    const server = createFakeServer();
    server.signedIn(sampleUser({ role: 'MANAGER', status: 'PENDING_APPROVAL' }));
    renderGuard(server, <RequireRole roles={['MANAGER']}>venue set-up</RequireRole>);
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
  });

  it('admits a waiting manager where the screen allows it', async () => {
    const server = createFakeServer();
    server.signedIn(sampleUser({ role: 'MANAGER', status: 'PENDING_APPROVAL' }));
    renderGuard(server, <RequireRole roles={['MANAGER']} statuses={['ACTIVE', 'PENDING_APPROVAL']}>status page</RequireRole>);
    expect(await screen.findByText('status page')).toBeInTheDocument();
  });
});

describe('safeRedirect', () => {
  it('follows paths inside this site and nothing else', () => {
    expect(safeRedirect('/home')).toBe('/home');
    expect(safeRedirect('/venues?sport=futsal#top')).toBe('/venues?sport=futsal#top');
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '', undefined, null, 42]) {
      expect(safeRedirect(bad), String(bad)).toBe('/home');
    }
    expect(safeRedirect('https://evil.example', '/login')).toBe('/login');
  });
});

describe('home page placeholder', () => {
  const visit = async (user: Parameters<typeof sampleUser>[0]) => {
    const server = createFakeServer();
    server.signedIn(sampleUser(user));
    renderApp(server, { route: '/home' });
    await screen.findByRole('heading', { name: /Welcome/ });
  };

  it('tells a new player to complete the profile', async () => {
    await visit({ profileComplete: false });
    expect(screen.getByText('You are signed in as Player.')).toBeInTheDocument();
    expect(screen.getByText(/profile is not complete/)).toBeInTheDocument();
  });

  it('does not nag a player whose profile is complete', async () => {
    await visit({ profileComplete: true });
    expect(screen.queryByText(/profile is not complete/)).not.toBeInTheDocument();
  });

  it('explains a manager waiting for approval, and a rejected one', async () => {
    await visit({ role: 'MANAGER', status: 'PENDING_APPROVAL', profileComplete: null, creditScore: null });
    expect(screen.getByText(/waiting for approval by the platform owner/)).toBeInTheDocument();
  });

  it('explains a rejected manager application', async () => {
    await visit({ role: 'MANAGER', status: 'REJECTED', profileComplete: null, creditScore: null });
    expect(screen.getByText(/was not approved/)).toBeInTheDocument();
  });
});
