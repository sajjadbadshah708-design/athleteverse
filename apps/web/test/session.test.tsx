// FR-1.8 on the web: the 15-minute access token is renewed behind the scenes, once, and a lost session is explained.
import { ApiError } from '@athleteverse/shared';
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWebApi, type SessionLostReason } from '../src/api/client';
import { apiError, createFakeServer, json, sampleUser } from './helpers/fakeServer';
import { renderApp } from './helpers/render';

describe('the API wrapper', () => {
  function setup() {
    const server = createFakeServer();
    const api = createWebApi({ fetchImpl: server.fetchImpl });
    const lost: SessionLostReason[] = [];
    api.onSessionLost((r) => lost.push(r));
    return { server, api, lost };
  }
  /** A path that answers 401 until the refresh has happened. */
  const needsRefresh = (server: ReturnType<typeof createFakeServer>, path = 'GET /venues') => {
    let refreshed = false;
    server.on('POST /auth/refresh', () => ((refreshed = true), json({ user: sampleUser() })));
    server.on(path, () => (refreshed ? json({ ok: true }) : apiError('UNAUTHENTICATED')));
  };

  it('renews an expired session once and repeats the request', async () => {
    const { server, api, lost } = setup();
    needsRefresh(server);
    expect(await api.get('/venues')).toEqual({ ok: true });
    expect(server.count('POST /auth/refresh')).toBe(1);
    expect(server.count('GET /venues')).toBe(2);
    expect(lost).toEqual([]);
  });

  it('shares ONE refresh between simultaneous requests', async () => {
    const { server, api } = setup();
    let refreshed = false; // one flag for every path: the single refresh renews them all
    server.on('POST /auth/refresh', () => ((refreshed = true), json({ user: sampleUser() })));
    for (const path of ['GET /venues', 'GET /bookings']) server.on(path, () => (refreshed ? json({ ok: true }) : apiError('UNAUTHENTICATED')));

    const results = await Promise.all([api.get('/venues'), api.get('/bookings'), api.get('/venues')]);
    expect(results).toHaveLength(3);
    expect(server.count('POST /auth/refresh')).toBe(1); // not three
    expect(server.count('GET /venues')).toBe(4); // each of the two /venues calls tried twice
  });

  it('reports "expired" when the session cannot be renewed, and passes the original error on', async () => {
    const { server, api, lost } = setup();
    server.on('GET /venues', () => apiError('UNAUTHENTICATED'));
    server.on('POST /auth/refresh', () => apiError('UNAUTHENTICATED'));
    await expect(api.get('/venues')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(lost).toEqual(['expired']);
  });

  it('retries only once: a second "not signed in" ends the session instead of looping', async () => {
    const { server, api, lost } = setup();
    server.on('GET /venues', () => apiError('UNAUTHENTICATED'));
    server.on('POST /auth/refresh', () => json({ user: sampleUser() }));
    await expect(api.get('/venues')).rejects.toBeInstanceOf(ApiError);
    expect(server.count('GET /venues')).toBe(2);
    expect(server.count('POST /auth/refresh')).toBe(1);
    expect(lost).toEqual(['expired']);
  });

  it('reports a suspension at once, without trying to refresh', async () => {
    const { server, api, lost } = setup();
    server.on('GET /venues', () => apiError('ACCOUNT_SUSPENDED'));
    await expect(api.get('/venues')).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    expect(lost).toEqual(['suspended']);
    expect(server.count('POST /auth/refresh')).toBe(0);
  });

  it('reports a suspension discovered while refreshing', async () => {
    const { server, api, lost } = setup();
    server.on('GET /venues', () => apiError('UNAUTHENTICATED'));
    server.on('POST /auth/refresh', () => apiError('ACCOUNT_SUSPENDED'));
    await expect(api.get('/venues')).rejects.toBeInstanceOf(ApiError);
    expect(lost).toEqual(['suspended']);
  });

  it('leaves other errors alone: no refresh for a validation problem or a conflict', async () => {
    const { server, api, lost } = setup();
    server.on('POST /bookings', () => apiError('SLOT_TAKEN'));
    await expect(api.post('/bookings', {})).rejects.toMatchObject({ code: 'SLOT_TAKEN' });
    expect(server.count('POST /auth/refresh')).toBe(0);
    expect(lost).toEqual([]);
  });

  it('never "rescues" the sign-in calls themselves (a wrong password is not an expired session)', async () => {
    const { server, api, lost } = setup();
    server.on('POST /auth/login', () => apiError('UNAUTHENTICATED'));
    await expect(api.post('/auth/login', {})).rejects.toBeInstanceOf(ApiError);
    expect(server.count('POST /auth/refresh')).toBe(0);
    expect(lost).toEqual([]);
  });

  it('counts requests in flight, including the refresh (for the "starting up" message)', async () => {
    const { server, api } = setup();
    let release!: () => void;
    server.on('GET /slow', () => new Promise<Response>((resolve) => (release = () => resolve(json({ ok: true })))));
    expect(api.pending.count()).toBe(0);
    const request = api.get('/slow');
    await vi.waitFor(() => expect(api.pending.count()).toBe(1)); // the request starts one microtask later
    release();
    await request;
    expect(api.pending.count()).toBe(0);
  });

  it('can be unsubscribed', async () => {
    const { server, api } = setup();
    const heard: string[] = [];
    const stop = api.onSessionLost((r) => heard.push(r));
    stop();
    server.on('GET /venues', () => apiError('ACCOUNT_SUSPENDED'));
    await api.get('/venues').catch(() => undefined);
    expect(heard).toEqual([]);
  });
});

describe('who is signed in when the page opens', () => {
  it('goes straight to the home page when a session exists', async () => {
    const server = createFakeServer();
    server.signedIn();
    renderApp(server, { route: '/' });
    expect(await screen.findByRole('heading', { name: 'Welcome, Ali Khan' })).toBeInTheDocument();
  });

  it('quietly renews an expired access token before deciding (the cookie lasts 15 minutes, the session 7 days)', async () => {
    const server = createFakeServer();
    let renewed = false;
    server.on('POST /auth/refresh', () => ((renewed = true), json({ user: sampleUser() })));
    server.on('GET /me', () => (renewed ? json({ user: sampleUser() }) : apiError('UNAUTHENTICATED')));
    renderApp(server, { route: '/home' });
    expect(await screen.findByRole('heading', { name: 'Welcome, Ali Khan' })).toBeInTheDocument();
    expect(server.count('POST /auth/refresh')).toBe(1);
  });

  it('shows the suspension notice (not a generic error) to a suspended user (FR-1.21)', async () => {
    const server = createFakeServer();
    server.on('GET /me', () => apiError('ACCOUNT_SUSPENDED'));
    renderApp(server, { route: '/' });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/Your account has been suspended/)).toBeInTheDocument();
  });

  it('keeps a signed-in user away from the sign-in and sign-up pages', async () => {
    const server = createFakeServer();
    server.signedIn();
    renderApp(server, { route: '/register' });
    expect(await screen.findByRole('heading', { name: /Welcome/ })).toBeInTheDocument();
  });

  it('shows a page-not-found screen for an unknown address', async () => {
    const server = createFakeServer();
    server.anonymous();
    renderApp(server, { route: '/no/such/page' });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('losing a session while using the app', () => {
  it('returns to the sign-in page and says why', async () => {
    const server = createFakeServer();
    server.signedIn();
    const { api } = renderApp(server, { route: '/home' });
    await screen.findByRole('heading', { name: /Welcome/ });

    server.on('GET /venues', () => apiError('UNAUTHENTICATED'));
    server.on('POST /auth/refresh', () => apiError('UNAUTHENTICATED'));
    await act(async () => void (await api.get('/venues').catch(() => undefined)));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Your session ended. Please sign in again.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create account' })).toBeInTheDocument(); // the header changed back
  });

  it('shows the suspension notice when the account is suspended mid-session', async () => {
    const server = createFakeServer();
    server.signedIn();
    const { api } = renderApp(server, { route: '/home' });
    await screen.findByRole('heading', { name: /Welcome/ });

    server.on('GET /venues', () => apiError('ACCOUNT_SUSPENDED'));
    await act(async () => void (await api.get('/venues').catch(() => undefined)));
    expect(await screen.findByText(/Your account has been suspended/)).toBeInTheDocument();
  });
});

describe('signing out', () => {
  it('ends the session and returns to the sign-in page', async () => {
    const server = createFakeServer();
    server.signedIn();
    server.on('POST /auth/logout', () => json({ ok: true }));
    const { user } = renderApp(server, { route: '/home' });
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(server.count('POST /auth/logout')).toBe(1);
    expect(screen.queryByText('Your session ended. Please sign in again.')).not.toBeInTheDocument(); // chosen, not lost
  });

  it('works even when the server cannot be reached', async () => {
    const server = createFakeServer();
    server.signedIn();
    server.on('POST /auth/logout', () => {
      throw new TypeError('Failed to fetch');
    });
    const { user } = renderApp(server, { route: '/home' });
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument());
  });
});
