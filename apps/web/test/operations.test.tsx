// FR-2.16, FR-5.3, Table 15: the venue front desk records cash with the amount received and shows a booking's history.
import { formatAmount } from '@athleteverse/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAccessibilityViolations } from './helpers/a11y';
import { createFakeServer, json, sampleUser } from './helpers/fakeServer';
import { renderApp } from './helpers/render';
import { bookingResponse, VENUE_ID } from './helpers/venueData';

const PLAYER = { id: '44444444-4444-4444-8444-444444444444', fullName: 'Sara Malik', phone: '923007654321', creditScore: 65, creditTier: 'CAUTION' };
const CONFIRMED = { ...bookingResponse({ id: '55555555-5555-4555-8555-555555555555', code: 'DESKBK01', totalPrice: '50.00' }), player: PLAYER };
const AUTO_CLOSED = { ...bookingResponse({ id: '66666666-6666-4666-8666-666666666666', code: 'DESKBK02', status: 'COMPLETED', paymentStatus: 'PENDING' }), player: PLAYER };

function staffServer(role: 'STAFF' | 'MANAGER' = 'STAFF') {
  const s = createFakeServer();
  s.signedIn(sampleUser({ role, staffVenueId: role === 'STAFF' ? VENUE_ID : null }));
  if (role === 'MANAGER') s.on('GET /manager/venues', () => json({ items: [{ id: VENUE_ID, name: 'Arena One', cityId: 1, address: '1 Main St', openHour: 8, closeHour: 23, status: 'ACTIVE' }] }));
  s.on(`GET /operations/venues/${VENUE_ID}/bookings`, () => json({ items: [CONFIRMED, AUTO_CLOSED] }));
  s.on(`POST /operations/bookings/${CONFIRMED.id}/outcome`, () => json({ ok: true, creditScore: 70, creditTier: 'GOOD' }));
  s.on(`GET /operations/bookings/${CONFIRMED.id}`, () => json({ ...CONFIRMED, amountReceived: null, cancelReason: null, history: [
    { at: '2030-01-15T09:00:00.000Z', event: 'CREATED', by: { name: 'Sara Malik', role: 'PLAYER' }, reason: null, points: null, amount: null },
    { at: '2030-01-15T14:05:00.000Z', event: 'PAID', by: { name: 'Desk Agent', role: 'STAFF' }, reason: null, points: null, amount: '45.00' },
    { at: '2030-01-15T14:05:00.000Z', event: 'CREDIT', by: null, reason: 'RECOVERY', points: 5, amount: null },
  ] }));
  return s;
}
const card = (code: string) => screen.getByText(`BOOKING ${code}`).closest('article') as HTMLElement;

describe('venue front desk', () => {
  it('records cash with the amount received, defaulting to the booked price', async () => {
    const user = userEvent.setup();
    const s = staffServer();
    renderApp(s, { route: '/operations' });
    await screen.findByText('BOOKING DESKBK01');
    await user.click(within(card('DESKBK01')).getByRole('button', { name: 'Confirm cash paid' }));
    const form = within(card('DESKBK01')).getByRole('form', { name: 'Confirm cash paid' });
    const amount = within(form).getByLabelText('Amount received');
    expect(amount).toHaveValue('50.00');
    await user.clear(amount);
    await user.type(amount, '45');
    await user.click(within(form).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(s.calls.find((c) => c.method === 'POST')?.body).toEqual({ outcome: 'PAID', amount: '45' }));
    expect(await screen.findByText(/Cash payment of .*45.* recorded\./)).toBeInTheDocument();
  });

  it('will not send an empty or zero amount', async () => {
    const user = userEvent.setup();
    const s = staffServer();
    renderApp(s, { route: '/operations' });
    await screen.findByText('BOOKING DESKBK01');
    await user.click(within(card('DESKBK01')).getByRole('button', { name: 'Confirm cash paid' }));
    const form = within(card('DESKBK01')).getByRole('form', { name: 'Confirm cash paid' });
    const amount = within(form).getByLabelText('Amount received');
    await user.clear(amount);
    expect(within(form).getByRole('button', { name: 'Record payment' })).toBeDisabled();
    await user.type(amount, '0');
    expect(within(form).getByRole('button', { name: 'Record payment' })).toBeDisabled();
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows staff no cash button on an automatically closed booking (only the manager may confirm it)', async () => {
    renderApp(staffServer('STAFF'), { route: '/operations' });
    await screen.findByText('BOOKING DESKBK02');
    expect(within(card('DESKBK02')).queryByRole('button', { name: 'Confirm cash paid' })).not.toBeInTheDocument();
  });

  it('shows the manager the cash button on an automatically closed booking', async () => {
    renderApp(staffServer('MANAGER'), { route: '/operations' });
    await screen.findByText('BOOKING DESKBK02');
    expect(within(card('DESKBK02')).getByRole('button', { name: 'Confirm cash paid' })).toBeInTheDocument();
    expect(within(card('DESKBK02')).queryByRole('button', { name: 'Record no-show' })).not.toBeInTheDocument();
  });

  it('opens the status history with who did what, amounts and points', async () => {
    const user = userEvent.setup();
    renderApp(staffServer(), { route: '/operations' });
    await screen.findByText('BOOKING DESKBK01');
    const toggle = within(card('DESKBK01')).getByRole('button', { name: 'View details' });
    await user.click(toggle);
    const panel = await screen.findByRole('region', { name: 'Booking DESKBK01 details' });
    await within(panel).findByText('Booked');
    const items = within(panel).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Sara Malik (player)');
    expect(items[1]).toHaveTextContent('Cash paid');
    expect(items[1]).toHaveTextContent(formatAmount('45.00'));
    expect(items[1]).toHaveTextContent('Desk Agent (staff)');
    expect(items[2]).toHaveTextContent('Credit change(+5 points)');
    expect(items[2]).toHaveTextContent('System');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expectNoAccessibilityViolations(document.body);
    await user.click(toggle);
    expect(screen.queryByRole('region', { name: 'Booking DESKBK01 details' })).not.toBeInTheDocument();
  });
});
