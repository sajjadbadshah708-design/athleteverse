// SRS PERF-2: a sleeping free API can take about a minute; the interface must say so instead of looking broken.
import { STRINGS } from '@athleteverse/shared';
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeServer, json } from './helpers/fakeServer';
import { renderApp } from './helpers/render';

afterEach(() => vi.useRealTimers());

describe('"the server is starting up" message', () => {
  it('appears only after 3 seconds of waiting, and goes away when the server answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = createFakeServer();
    let answer!: () => void;
    server.on('GET /me', () => new Promise<Response>((resolve) => (answer = () => resolve(new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'x' } }), { status: 401 })))));
    server.on('POST /auth/refresh', () => new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'x' } }), { status: 401 }));
    renderApp(server, { route: '/login' });

    await act(async () => void (await vi.advanceTimersByTimeAsync(2900)));
    expect(screen.queryByText(STRINGS.banner.startingUp)).not.toBeInTheDocument(); // a normal, fast request shows nothing

    await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
    const banner = screen.getByText(STRINGS.banner.startingUp);
    expect(banner.closest('[role="status"]')).not.toBeNull(); // announced to screen readers

    await act(async () => answer());
    await screen.findByRole('heading', { name: 'Sign in' });
    await act(async () => void (await vi.advanceTimersByTimeAsync(50)));
    expect(screen.queryByText(STRINGS.banner.startingUp)).not.toBeInTheDocument();
  });

  it('never appears when requests are quick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = createFakeServer();
    server.signedIn();
    server.on('POST /auth/logout', () => json({ ok: true }));
    renderApp(server, { route: '/home' });
    await screen.findByRole('heading', { name: /Welcome/ });
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(screen.queryByText(STRINGS.banner.startingUp)).not.toBeInTheDocument();
  });
});
