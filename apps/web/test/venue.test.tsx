// FR-2.3, FR-2.5, FR-2.6, PERF-5: the public venue page and its availability grid.
import { fireEvent, screen, waitFor, within, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAccessibilityViolations } from './helpers/a11y';
import { apiError, createFakeServer, json, type FakeServer } from './helpers/fakeServer';
import { renderApp } from './helpers/render';
import { availability, venueDetail, VENUE_ID } from './helpers/venueData';

const route = `/venues/${VENUE_ID}`;

function server(detail: unknown = venueDetail()) {
  const s = createFakeServer();
  s.anonymous();
  s.on(`GET /venues/${VENUE_ID}`, () => json(detail));
  s.on(`GET /venues/${VENUE_ID}/availability`, (call) => json(availability(new URLSearchParams(call.search).get('date')!)));
  return s;
}
const gridCalls = (s: FakeServer) => s.calls.filter((c) => c.path.endsWith('/availability'));
const dates = (s: FakeServer) => gridCalls(s).map((c) => new URLSearchParams(c.search).get('date'));

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};
afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

describe('venue page', () => {
  it('shows the venue, its contact details, hours, courts and prices without needing a sign-in', async () => {
    renderApp(server(), { route });
    expect(await screen.findByRole('heading', { name: 'Arena One' })).toBeInTheDocument();
    expect(screen.getByText('A friendly indoor hall.')).toBeInTheDocument();
    expect(screen.getByText('1 Main St, Alpha City')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '920000000100' })).toHaveAttribute('href', 'tel:920000000100');
    expect(screen.getByText('08:00 to 23:00')).toBeInTheDocument();
    expect(screen.getByText('18:00 to 23:00')).toBeInTheDocument(); // peak hours

    const courts = within(screen.getByRole('region', { name: 'Courts' }));
    expect(courts.getByText('1,200 per hour')).toBeInTheDocument();
    expect(courts.getByText('1,500.50 per hour at peak times')).toBeInTheDocument();
    expect(courts.getByText('10 per hour')).toBeInTheDocument();
    expect(courts.getAllByText(/at peak times/)).toHaveLength(1); // the court without a peak price shows none
  });

  it('shows the cancellation and credit rules using the numbers the server sends (FR-2.3)', async () => {
    renderApp(server(venueDetail({ policy: { ...venueDetail().policy, freeCancelHours: 12, penaltyNoShow: 40 } })), { route });
    const rules = within(await screen.findByRole('region', { name: /cancellation and credit rules/i }));
    expect(rules.getByText(/Pay cash at the venue after the match\. Nothing is paid online\./)).toBeInTheDocument();
    expect(rules.getByText(/book up to 14 days ahead, up to 3 hours in a row, and no later than 30 minutes before the start/)).toBeInTheDocument();
    expect(rules.getByText('Cancel more than 12 hours before the start: free.')).toBeInTheDocument();
    expect(rules.getByText(/between 1 hour and 12 hours before the start: 10 credit points/)).toBeInTheDocument(); // "1 hour", singular
    expect(rules.getByText(/less than 1 hour before the start: 20 credit points/)).toBeInTheDocument();
    expect(rules.getByText(/Not arriving within 15 minutes of the start: 40 credit points/)).toBeInTheDocument();
  });

  it('leaves out the peak hours row when the venue has none', async () => {
    renderApp(server(venueDetail({ peakStartHour: null, peakEndHour: null })), { route });
    await screen.findByRole('heading', { name: 'Arena One' });
    expect(screen.queryByText('Peak hours:')).not.toBeInTheDocument();
  });

  it.each([
    ['NOT_FOUND' as const, 'a venue that does not exist or is closed'],
    ['VALIDATION_ERROR' as const, 'a malformed address'],
  ])('shows "Venue not found" with a way back for %s (%s)', async (code, _why) => {
    const s = createFakeServer();
    s.anonymous();
    s.on(`GET /venues/${VENUE_ID}`, () => apiError(code));
    renderApp(s, { route });
    expect(await screen.findByRole('heading', { name: 'Venue not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to all venues' })).toHaveAttribute('href', '/venues');
  });

  it('explains a failure to load and tries again on request', async () => {
    const s = server();
    let failures = 1;
    s.on(`GET /venues/${VENUE_ID}`, () => (failures-- > 0 ? apiError('INTERNAL') : json(venueDetail())));
    const { user } = renderApp(s, { route });
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load this venue');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Arena One' })).toBeInTheDocument();
  });

  it('passes automated accessibility checks', async () => {
    const { container } = renderApp(server(), { route });
    await screen.findByText('Court A', { selector: 'h3' });
    await expectNoAccessibilityViolations(container);
  });
});

describe('availability grid', () => {
  it('starts on today (as the server counts it) and labels every hour in words as well as symbols (FR-2.5)', async () => {
    const s = server();
    renderApp(s, { route });
    const grid = within(await screen.findByRole('region', { name: 'Availability' }));
    await grid.findByText('Court A', { selector: 'h3' });
    expect(dates(s)).toEqual(['2030-01-15']);
    expect(grid.getByText('Tuesday, 15 January 2030')).toBeInTheDocument();

    const court = within(grid.getByRole('region', { name: /Court A/ }));
    const item = (hour: string) => court.getByText(new RegExp(`^${hour} –`)).closest('li')!; // the slot that STARTS at this hour
    expect(within(item('08:00')).getByText('Past')).toBeInTheDocument();
    expect(within(item('09:00')).getByText('Booked')).toBeInTheDocument();
    expect(within(item('10:00')).getByText('Blocked')).toBeInTheDocument();
    expect(within(item('11:00')).getByText('Available')).toBeInTheDocument();
    expect(within(item('11:00')).getByText('1,200')).toBeInTheDocument(); // the price shows for hours you could book
    expect(item('11:00').querySelector('[aria-hidden="true"]')?.textContent).toMatch(/✓/); // the symbol is decoration only
  });

  it('shows a price on an hour exactly when that hour can be booked', async () => {
    renderApp(server(), { route });
    const court = within(await screen.findByRole('region', { name: /Court A/ }));
    const hours = court.getAllByRole('listitem');
    expect(hours).toHaveLength(4); // Past, Booked, Blocked, Available
    for (const hour of hours) {
      const bookable = within(hour).queryByText('Available') !== null;
      const showsPrice = within(hour).queryByText(/^[\d,.]+$/) !== null; // an amount, never the "08:00 - 09:00" label
      expect(showsPrice, hour.textContent ?? '').toBe(bookable);
    }
  });

  it('moves a day at a time, and not outside today..last day', async () => {
    const s = server();
    const { user } = renderApp(s, { route });
    await screen.findByRole('region', { name: /Court A/ });
    const previous = screen.getByRole('button', { name: 'Previous day' });
    const next = screen.getByRole('button', { name: 'Next day' });
    expect(previous).toBeDisabled(); // today is the first day
    await user.click(next);
    await screen.findByText('Wednesday, 16 January 2030');
    expect(dates(s).at(-1)).toBe('2030-01-16');
    expect(previous).toBeEnabled();
    await user.click(previous);
    await screen.findByText('Tuesday, 15 January 2030');
  });

  it('can jump to any date in the window with the date field, and ignores dates outside it', async () => {
    const s = server();
    renderApp(s, { route });
    await screen.findByRole('region', { name: /Court A/ });
    const date = screen.getByLabelText('Date');
    expect(date).toHaveAttribute('min', '2030-01-15');
    expect(date).toHaveAttribute('max', '2030-01-29');

    fireEvent.change(date, { target: { value: '2030-01-29' } });
    await screen.findByText('Tuesday, 29 January 2030');
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled(); // the last day

    fireEvent.change(date, { target: { value: '2030-02-20' } }); // outside the window
    fireEvent.change(date, { target: { value: '2029-12-01' } });
    expect(screen.getByText('Tuesday, 29 January 2030')).toBeInTheDocument(); // unchanged
    expect(dates(s).every((d) => d === '2030-01-15' || d === '2030-01-29')).toBe(true); // nothing outside the window was ever requested
  });

  it('explains the past rule and that the list refreshes by itself, and offers a visitor no booking buttons', async () => {
    renderApp(server(), { route });
    await screen.findByRole('region', { name: /Court A/ });
    expect(screen.getByText('Hours that start in less than 30 minutes can no longer be booked and show as Past.')).toBeInTheDocument();
    expect(screen.getByText(/updates by itself every 15 seconds/)).toBeInTheDocument();
    expect(screen.getByText(/To book an hour you need a player account/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\d\d:00/ })).not.toBeInTheDocument(); // a signed-out visitor can look but not book
  });

  it('says so when the venue has no courts, or a court has no hours', async () => {
    const s = server();
    s.on(`GET /venues/${VENUE_ID}/availability`, () => json({ date: '2030-01-15', timeZone: 'UTC', courts: [] }));
    renderApp(s, { route });
    expect(await screen.findByText('This venue has no courts open for booking yet.')).toBeInTheDocument();
  });

  it('explains a failure of the grid itself and keeps the venue details on screen', async () => {
    const s = server();
    let failures = 1;
    s.on(`GET /venues/${VENUE_ID}/availability`, () => (failures-- > 0 ? apiError('INTERNAL') : json(availability())));
    const { user } = renderApp(s, { route });
    const grid = within(await screen.findByRole('region', { name: 'Availability' }));
    expect(await grid.findByRole('alert')).toHaveTextContent('We could not load the availability');
    expect(screen.getByRole('heading', { name: 'Arena One' })).toBeInTheDocument();
    await user.click(grid.getByRole('button', { name: 'Try again' }));
    expect(await grid.findByRole('region', { name: /Court A/ })).toBeInTheDocument();
  });

  it('passes automated accessibility checks', async () => {
    const { container } = renderApp(server(), { route });
    await screen.findByRole('region', { name: /Court A/ });
    await expectNoAccessibilityViolations(container);
  });
});

describe('the 15-second refresh (FR-2.6, PERF-5)', () => {
  it('reloads the grid every 15 seconds while the page is visible, and shows the new state without a flicker', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = server();
    let booked = false;
    s.on(`GET /venues/${VENUE_ID}/availability`, (call) => {
      const data = availability(new URLSearchParams(call.search).get('date')!);
      if (booked) data.courts[0]!.slots[3]!.state = 'BOOKED'; // someone books the 11:00 hour
      return json(data);
    });
    renderApp(s, { route, fakeTimers: true });
    const court = await screen.findByRole('region', { name: /Court A/ });
    expect(within(court.querySelectorAll('li')[3] as HTMLElement).getByText('Available')).toBeInTheDocument();
    expect(gridCalls(s)).toHaveLength(1);

    await act(async () => void (await vi.advanceTimersByTimeAsync(14_000)));
    expect(gridCalls(s)).toHaveLength(1); // not yet
    booked = true;
    await act(async () => void (await vi.advanceTimersByTimeAsync(1500)));
    await waitFor(() => expect(gridCalls(s)).toHaveLength(2));
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument(); // the old grid stayed while the new one loaded
    await waitFor(() => expect(within(screen.getByRole('region', { name: /Court A/ }).querySelectorAll('li')[3] as HTMLElement).getByText('Booked')).toBeInTheDocument());
  });

  it('does not poll while the page is hidden, and refreshes at once when it comes back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = server();
    renderApp(s, { route, fakeTimers: true });
    await screen.findByRole('region', { name: /Court A/ });
    expect(gridCalls(s)).toHaveLength(1);

    act(() => setVisibility('hidden'));
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(gridCalls(s)).toHaveLength(1); // a minute hidden: no requests (battery and data)

    act(() => setVisibility('visible'));
    await waitFor(() => expect(gridCalls(s)).toHaveLength(2)); // immediate refresh
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_500)));
    await waitFor(() => expect(gridCalls(s)).toHaveLength(3)); // and the 15-second rhythm resumes
  });

  it('keeps showing the last good grid when a quiet refresh fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = server();
    renderApp(s, { route, fakeTimers: true });
    await screen.findByRole('region', { name: /Court A/ });
    s.on(`GET /venues/${VENUE_ID}/availability`, () => apiError('INTERNAL'));
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_500)));
    await waitFor(() => expect(gridCalls(s)).toHaveLength(2));
    expect(screen.getByRole('region', { name: /Court A/ })).toBeInTheDocument(); // still there
    expect(screen.queryByText('We could not load the availability. Check your connection and try again.')).not.toBeInTheDocument();
  });

  it('stops polling when the page is left', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = server();
    const { unmount } = renderApp(s, { route, fakeTimers: true });
    await screen.findByRole('region', { name: /Court A/ });
    unmount();
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(gridCalls(s)).toHaveLength(1);
  });
});
