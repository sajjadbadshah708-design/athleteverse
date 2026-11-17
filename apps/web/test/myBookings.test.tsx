// FR-2.13, FR-2.17, FR-2.20: My Bookings tabs, the cancellation preview and the cash receipt.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAccessibilityViolations } from './helpers/a11y';
import { createFakeServer, json, sampleUser } from './helpers/fakeServer';
import { renderApp } from './helpers/render';
import { bookingResponse } from './helpers/venueData';

const UPCOMING = bookingResponse({ id: '11111111-1111-4111-8111-111111111111', code: 'UPCOMIN1', startsAt: '2099-01-15T12:00:00.000Z', endsAt: '2099-01-15T13:00:00.000Z' });
const PAST_PAID = bookingResponse({ id: '22222222-2222-4222-8222-222222222222', code: 'PASTPAI1', status: 'COMPLETED', paymentStatus: 'PAID',
  startsAt: '2020-01-15T12:00:00.000Z', endsAt: '2020-01-15T13:00:00.000Z' });
const CANCELLED = bookingResponse({ id: '33333333-3333-4333-8333-333333333333', code: 'CANCELD1', status: 'CANCELLED', startsAt: '2099-02-01T12:00:00.000Z' });

function server() {
  const s = createFakeServer();
  s.signedIn(sampleUser({ profileComplete: true }));
  s.on('GET /me/bookings', () => json({ items: [UPCOMING, PAST_PAID, CANCELLED] }));
  s.on(`GET /me/bookings/${UPCOMING.id}/cancellation`, () => json({ band: 'LATE', penalty: -10, startsAt: UPCOMING.startsAt }));
  s.on(`POST /me/bookings/${UPCOMING.id}/cancel`, () => json({ ok: true, penalty: -10, band: 'LATE' }));
  s.on(`GET /me/bookings/${PAST_PAID.id}/receipt`, () => json({ code: 'PASTPAI1', venueName: 'Arena One', courtName: 'Court A', amountReceived: '50.00',
    paidAt: '2020-01-15T13:05:00.000Z', startsAt: PAST_PAID.startsAt, endsAt: PAST_PAID.endsAt }));
  return s;
}
const tab = (name: string) => within(screen.getByRole('group', { name: 'Booking category' })).getByRole('button', { name });

describe('My Bookings', () => {
  it('sorts bookings into Upcoming, Past and Cancelled, showing code, status and payment status', async () => {
    const user = userEvent.setup();
    renderApp(server(), { route: '/bookings' });
    expect(await screen.findByText('UPCOMIN1')).toBeInTheDocument();
    expect(screen.queryByText('PASTPAI1')).not.toBeInTheDocument();
    expect(screen.queryByText('CANCELD1')).not.toBeInTheDocument();
    expect(tab('Upcoming')).toHaveAttribute('aria-pressed', 'true');

    await user.click(tab('Past'));
    expect(await screen.findByText('PASTPAI1')).toBeInTheDocument();
    expect(screen.getByText(/Payment:/).parentElement).toHaveTextContent('COMPLETED | Payment: PAID');
    expect(screen.queryByText('UPCOMIN1')).not.toBeInTheDocument();

    await user.click(tab('Cancelled'));
    expect(await screen.findByText('CANCELD1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review cancellation penalty' })).not.toBeInTheDocument();
    await expectNoAccessibilityViolations(document.body);
  });

  it('shows the penalty from the server before the player confirms, then cancels and reloads', async () => {
    const user = userEvent.setup();
    const s = server();
    renderApp(s, { route: '/bookings' });
    await user.click(await screen.findByRole('button', { name: 'Review cancellation penalty' }));
    const confirmBox = await screen.findByRole('region', { name: 'Cancellation confirmation' });
    expect(confirmBox).toHaveTextContent('-10 credit points (late)');
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false); // nothing is cancelled by the preview alone

    const loadsBefore = s.calls.filter((c) => c.path === '/me/bookings').length;
    await user.click(within(confirmBox).getByRole('button', { name: 'Confirm cancellation' }));
    expect(await screen.findByText('Booking cancelled. Credit change: -10 points.')).toBeInTheDocument();
    expect(s.calls.filter((c) => c.method === 'POST' && c.path === `/me/bookings/${UPCOMING.id}/cancel`)).toHaveLength(1);
    await waitFor(() => expect(s.calls.filter((c) => c.path === '/me/bookings').length).toBeGreaterThan(loadsBefore));
  });

  it('lets the player keep the booking from the preview', async () => {
    const user = userEvent.setup();
    const s = server();
    renderApp(s, { route: '/bookings' });
    await user.click(await screen.findByRole('button', { name: 'Review cancellation penalty' }));
    await user.click(within(await screen.findByRole('region', { name: 'Cancellation confirmation' })).getByRole('button', { name: 'Keep booking' }));
    expect(screen.queryByRole('region', { name: 'Cancellation confirmation' })).not.toBeInTheDocument();
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows the cash receipt of a paid booking', async () => {
    const user = userEvent.setup();
    renderApp(server(), { route: '/bookings' });
    await screen.findByText('UPCOMIN1');
    await user.click(tab('Past'));
    await user.click(await screen.findByRole('button', { name: 'View cash receipt' }));
    const receipt = await screen.findByRole('region', { name: 'Cash receipt' });
    expect(receipt).toHaveTextContent('Cash receipt — PASTPAI1');
    expect(receipt).toHaveTextContent('Paid amount: 50.00');
  });
});
