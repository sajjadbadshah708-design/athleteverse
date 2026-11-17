// FR-5.1 (MVP slice): the manager's home shows today's bookings by court and the bookings that need an action.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAccessibilityViolations } from './helpers/a11y';
import { createFakeServer, json, sampleUser } from './helpers/fakeServer';
import { renderApp } from './helpers/render';
import { bookingResponse, COURT_A, COURT_B, VENUE_ID } from './helpers/venueData';

const SECOND_VENUE = '77777777-7777-4777-8777-777777777777';
const PLAYER = { id: '44444444-4444-4444-8444-444444444444', fullName: 'Sara Malik', phone: '923007654321', creditScore: 100, creditTier: 'GOOD' };
const STARTED = { ...bookingResponse({ id: '55555555-5555-4555-8555-555555555555', code: 'STARTED1', startHour: 10, endHour: 11 }), player: PLAYER };
const CLOSED = { ...bookingResponse({ id: '66666666-6666-4666-8666-666666666666', code: 'CLOSED01', status: 'COMPLETED', date: '2030-01-12' }), player: PLAYER };
const home = (overrides: object = {}) => ({
  date: '2030-01-15',
  venues: [{ id: VENUE_ID, name: 'Arena One' }, { id: SECOND_VENUE, name: 'Arena Two' }],
  courts: [
    { id: COURT_A, name: 'Court A', venueName: 'Arena One', bookings: [STARTED] },
    { id: COURT_B, name: 'Court B', venueName: 'Arena One', bookings: [] },
  ],
  needsOutcome: [STARTED], awaitingCash: [CLOSED],
  ...overrides,
});

function managerServer(body = home()) {
  const s = createFakeServer();
  s.signedIn(sampleUser({ role: 'MANAGER', profileComplete: null, creditScore: null }));
  s.on('GET /me/manager-status', () => json({ status: 'ACTIVE', businessName: 'Arena Co', rejectionReason: null }));
  s.on('GET /manager/home', (call) => json(call.search.includes(SECOND_VENUE)
    ? home({ courts: [{ id: '88888888-8888-4888-8888-888888888888', name: 'Main', venueName: 'Arena Two', bookings: [] }], needsOutcome: [], awaitingCash: [] })
    : body));
  return s;
}

describe('manager home', () => {
  it("shows today's bookings by court, empty courts, and both action lists with a way to the front desk", async () => {
    renderApp(managerServer(), { route: '/home' });
    const courtA = await screen.findByRole('region', { name: 'Arena One, Court A' });
    expect(courtA).toHaveTextContent('1 booking today');
    expect(courtA).toHaveTextContent('10:00–11:00 Sara Malik');
    expect(screen.getByRole('region', { name: 'Arena One, Court B' })).toHaveTextContent('No bookings today.');
    const missing = screen.getByRole('region', { name: 'Outcome missing' });
    expect(missing).toHaveTextContent('STARTED1');
    expect(within(missing).getByRole('link', { name: /Open front desk/ })).toHaveAttribute('href', '/operations');
    expect(screen.getByRole('region', { name: 'Cash still to confirm' })).toHaveTextContent('CLOSED01');
    expect(screen.queryByText('Nothing needs your action.')).not.toBeInTheDocument();
    await expectNoAccessibilityViolations(document.body);
  });

  it('narrows to one venue', async () => {
    const user = userEvent.setup();
    const s = managerServer();
    renderApp(s, { route: '/home' });
    await screen.findByRole('region', { name: 'Arena One, Court A' });
    await user.selectOptions(screen.getByLabelText('Venue'), 'Arena Two');
    expect(await screen.findByRole('region', { name: 'Arena Two, Main' })).toBeInTheDocument();
    await waitFor(() => expect(s.calls.some((c) => c.path === '/manager/home' && c.search === `?venueId=${SECOND_VENUE}`)).toBe(true));
    expect(screen.getByText('Nothing needs your action.')).toBeInTheDocument();
  });

  it('explains what to do when the manager has no venue yet', async () => {
    renderApp(managerServer(home({ venues: [], courts: [], needsOutcome: [], awaitingCash: [] })), { route: '/home' });
    expect(await screen.findByText(/Create your first venue/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Venue')).not.toBeInTheDocument();
  });

  it('is not shown to a manager still waiting for approval', async () => {
    const s = createFakeServer();
    s.signedIn(sampleUser({ role: 'MANAGER', status: 'PENDING_APPROVAL', profileComplete: null, creditScore: null }));
    s.on('GET /me/manager-status', () => json({ status: 'PENDING_APPROVAL', businessName: 'Arena Co', rejectionReason: null }));
    renderApp(s, { route: '/home' });
    await screen.findByRole('heading', { level: 1 });
    expect(s.calls.some((c) => c.path === '/manager/home')).toBe(false);
  });
});
