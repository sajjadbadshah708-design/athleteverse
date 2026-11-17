// FR-2.7 to FR-2.11, FR-2.15, USA-1, SRS 5.3: booking one to three hours from the venue page, in three steps.
import { ERROR_MESSAGES } from '@athleteverse/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAccessibilityViolations } from './helpers/a11y';
import { apiError, createFakeServer, json, sampleUser, type FakeServer } from './helpers/fakeServer';
import { renderApp } from './helpers/render';
import { bookableAvailability, bookingResponse, COURT_A, COURT_B, venueDetail, VENUE_ID } from './helpers/venueData';

const route = `/venues/${VENUE_ID}`;

function playerServer(user = sampleUser({ profileComplete: true })) {
  const s = createFakeServer();
  s.signedIn(user);
  s.on(`GET /venues/${VENUE_ID}`, () => json(venueDetail()));
  s.on(`GET /venues/${VENUE_ID}/availability`, (call) => json(bookableAvailability(new URLSearchParams(call.search).get('date')!)));
  s.on('POST /bookings', () => json(bookingResponse(), 201));
  return s;
}
const posts = (s: FakeServer) => s.calls.filter((c) => c.method === 'POST' && c.path === '/bookings');
const gridCalls = (s: FakeServer) => s.calls.filter((c) => c.path.endsWith('/availability'));
const courtRegion = (name: RegExp) => within(screen.getByRole('region', { name }));
/** The button of the hour starting at `hh:00`, in the named court. */
const hour = (court: RegExp, hh: string) => courtRegion(court).getByRole('button', { name: new RegExp(`^${hh}:00 –`) });
const summary = () => screen.getByRole('region', { name: 'Your selection' });

afterEach(() => vi.useRealTimers());

describe('who gets booking buttons', () => {
  it('a signed-in player with a complete profile: available hours are buttons, the others are plain text', async () => {
    renderApp(playerServer(), { route });
    await screen.findByRole('region', { name: /Court A/ });
    expect(hour(/Court A/, '09')).toHaveAttribute('aria-pressed', 'false');
    expect(courtRegion(/Court A/).getAllByRole('button')).toHaveLength(5); // 09:00 to 13:00; the 14:00 hour is Booked
    expect(courtRegion(/Court A/).getByText('Booked')).toBeInTheDocument();
    expect(screen.getByText(/Tap an available hour to start a booking.*up to 3 in a row/)).toBeInTheDocument();
  });

  it('a visitor who is not signed in: an explanation with links, no buttons, and sign-in brings them back here', async () => {
    const s = playerServer();
    s.anonymous();
    const { user } = renderApp(s, { route });
    await screen.findByRole('region', { name: /Court A/ });
    expect(screen.getByText(/you need a player account/)).toBeInTheDocument();
    expect(courtRegion(/Court A/).queryAllByRole('button')).toHaveLength(0);
    const note = screen.getByText(/you need a player account/).closest('[role="status"]') as HTMLElement; // the header has a Sign in link too
    await user.click(within(note).getByRole('link', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('a player who has not completed the profile: sent to the profile, no buttons (FR-1.15)', async () => {
    renderApp(playerServer(sampleUser({ profileComplete: false })), { route });
    await screen.findByRole('region', { name: /Court A/ });
    const note = screen.getByText(/Complete your profile to book an hour/);
    expect(within(note.closest('[role="status"]') as HTMLElement).getByRole('link', { name: 'Complete your profile' })).toHaveAttribute('href', '/profile');
    expect(courtRegion(/Court A/).queryAllByRole('button')).toHaveLength(0);
  });

  it.each(['MANAGER', 'STAFF', 'ADMIN'] as const)('a %s account can look but not book', async (role) => {
    renderApp(playerServer(sampleUser({ role, profileComplete: null, creditScore: null })), { route });
    await screen.findByRole('region', { name: /Court A/ });
    expect(screen.getByText('Only player accounts can book courts.')).toBeInTheDocument();
    expect(courtRegion(/Court A/).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('choosing hours (Table 14: one court, up to three in a row)', () => {
  it('shows what is chosen, in words and with the total, as soon as an hour is tapped', async () => {
    const { user } = renderApp(playerServer(), { route });
    await screen.findByRole('region', { name: /Court A/ });
    await user.click(hour(/Court A/, '10'));
    expect(hour(/Court A/, '10')).toHaveAttribute('aria-pressed', 'true');
    expect(within(hour(/Court A/, '10')).getByText('Selected')).toBeInTheDocument();
    expect(within(summary()).getByRole('status')).toHaveTextContent('Court A: 10:00 to 11:00, 1 hour, total 20');
  });

  it('extends over neighbouring hours up to three, adds each hour at its own price, and starts again after that', async () => {
    const { user } = renderApp(playerServer(), { route });
    await screen.findByRole('region', { name: /Court A/ });
    await user.click(hour(/Court A/, '12'));
    await user.click(hour(/Court A/, '13')); // 12:00 at 20 plus the peak hour 13:00 at 30
    expect(within(summary()).getByRole('status')).toHaveTextContent('Court A: 12:00 to 14:00, 2 hours, total 50');
    await user.click(hour(/Court A/, '11'));
    expect(within(summary()).getByRole('status')).toHaveTextContent('Court A: 11:00 to 14:00, 3 hours, total 70');
    await user.click(hour(/Court A/, '10')); // a fourth hour: start again rather than allow four
    expect(within(summary()).getByRole('status')).toHaveTextContent('Court A: 10:00 to 11:00, 1 hour, total 20');
  });

  it('shrinks and clears, and a tap on another court starts a new selection there', async () => {
    const { user } = renderApp(playerServer(), { route });
    await screen.findByRole('region', { name: /Court A/ });
    await user.click(hour(/Court A/, '09'));
    await user.click(hour(/Court A/, '10'));
    await user.click(hour(/Court A/, '09')); // the first of two: shrink
    expect(within(summary()).getByRole('status')).toHaveTextContent('Court A: 10:00 to 11:00, 1 hour');
    await user.click(hour(/Court B/, '10'));
    expect(within(summary()).getByRole('status')).toHaveTextContent('Court B: 10:00 to 11:00, 1 hour, total 10');
    expect(hour(/Court A/, '10')).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('region', { name: 'Your selection' })).not.toBeInTheDocument();
  });

  it('clears the selection when another day is chosen', async () => {
    const { user } = renderApp(playerServer(), { route });
    await screen.findByRole('region', { name: /Court A/ });
    await user.click(hour(/Court A/, '10'));
    await user.click(screen.getByRole('button', { name: 'Next day' }));
    await screen.findByText('Wednesday, 16 January 2030');
    expect(screen.queryByRole('region', { name: 'Your selection' })).not.toBeInTheDocument();
  });

  it('drops a selection quietly, and says why, when the 15-second refresh shows someone else took the hour', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = playerServer();
    const { user } = renderApp(s, { route, fakeTimers: true });
    await screen.findByRole('region', { name: /Court A/ });
    await user.click(hour(/Court A/, '10'));
    await user.click(hour(/Court A/, '11'));
    expect(summary()).toBeInTheDocument();

    s.on(`GET /venues/${VENUE_ID}/availability`, (call) => {
      const data = bookableAvailability(new URLSearchParams(call.search).get('date')!);
      data.courts[0]!.slots[2]!.state = 'BOOKED'; // the 11:00 hour
      return json(data);
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_500)));
    expect(await screen.findByText('An hour you chose was just booked by someone else. Choose again.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your selection' })).not.toBeInTheDocument();
    expect(courtRegion(/Court A/).getAllByText('Booked')).toHaveLength(2);
  });
});

describe('review and confirm (steps 2 and 3)', () => {
  async function toReview(s = playerServer()) {
    const utils = renderApp(s, { route });
    await screen.findByRole('region', { name: /Court A/ });
    await utils.user.click(hour(/Court A/, '12'));
    await utils.user.click(hour(/Court A/, '13'));
    await utils.user.click(within(summary()).getByRole('button', { name: 'Review booking' }));
    await screen.findByRole('heading', { name: 'Review your booking' });
    return { s, ...utils };
  }

  it('shows exactly what will be booked and that nothing is paid online, and moves focus to the new step', async () => {
    await toReview();
    expect(screen.getByRole('heading', { name: 'Review your booking' })).toHaveFocus();
    const review = within(screen.getByRole('region', { name: 'Review your booking' }));
    expect(review.getByText('Arena One')).toBeInTheDocument();
    expect(review.getByText('Court A (Futsal)')).toBeInTheDocument();
    expect(review.getByText('Tuesday, 15 January 2030')).toBeInTheDocument();
    expect(review.getByText('12:00 to 14:00')).toBeInTheDocument();
    expect(review.getByText('50')).toBeInTheDocument(); // 20 + 30
    expect(review.getByText('Pay cash at the venue after the match')).toBeInTheDocument();
    expect(review.getByText('Cancellation and credit rules')).toBeInTheDocument();
  });

  it('goes back to the hours with the selection kept', async () => {
    const { user } = await toReview();
    await user.click(screen.getByRole('button', { name: 'Back to the hours' }));
    expect(await screen.findByRole('region', { name: 'Your selection' })).toBeInTheDocument();
    expect(hour(/Court A/, '12')).toHaveAttribute('aria-pressed', 'true');
  });

  it('books with the exact request the server expects, then shows the code, the details and the pay-cash note', async () => {
    const { s, user } = await toReview();
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));

    expect(await screen.findByRole('heading', { name: 'Booking confirmed' })).toHaveFocus();
    expect(posts(s)[0]!.body).toEqual({ courtId: COURT_A, startsAt: '2030-01-15T12:00:00.000Z', slots: 2 });
    expect(screen.getByTestId('booking-code')).toHaveTextContent('K7M2QX9P');
    expect(screen.getByText('Pay cash at the venue after the match')).toBeInTheDocument();
    expect(screen.getByText(/sent the details to your e-mail address/)).toBeInTheDocument();
    expect(screen.getByText('12:00 to 14:00')).toBeInTheDocument();
  });

  it('reloads the grid after booking and lets the player book another hour from a clean start', async () => {
    const { s, user } = await toReview();
    const before = gridCalls(s).length;
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await screen.findByRole('heading', { name: 'Booking confirmed' });
    await waitFor(() => expect(gridCalls(s).length).toBeGreaterThan(before));

    await user.click(screen.getByRole('button', { name: 'Book another hour' }));
    expect(await screen.findByRole('region', { name: /Court A/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your selection' })).not.toBeInTheDocument();
  });

  it('sends one booking however many times Confirm is tapped', async () => {
    const s = playerServer();
    let finish!: () => void;
    s.on('POST /bookings', () => new Promise<Response>((resolve) => (finish = () => resolve(json(bookingResponse(), 201)))));
    const { user } = await toReview(s);
    const confirm = screen.getByRole('button', { name: 'Confirm booking' });
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    await user.click(confirm);
    await user.click(confirm);
    expect(posts(s)).toHaveLength(1);
    await act(async () => finish());
    expect(await screen.findByRole('heading', { name: 'Booking confirmed' })).toBeInTheDocument();
  });
});

describe('when the booking is refused', () => {
  async function confirmWith(answer: () => Response | Promise<Response>) {
    const s = playerServer();
    s.on('POST /bookings', answer);
    const utils = renderApp(s, { route });
    await screen.findByRole('region', { name: /Court A/ });
    await utils.user.click(hour(/Court A/, '10'));
    await utils.user.click(within(summary()).getByRole('button', { name: 'Review booking' }));
    await utils.user.click(await screen.findByRole('button', { name: 'Confirm booking' }));
    return { s, ...utils };
  }
  const alert = () => screen.findByRole('alert');

  it('"slot taken": says so, offers the free hours the server found, and a click on one selects it', async () => {
    const alternatives = [
      { courtId: COURT_B, courtName: 'Court B', startsAt: '2030-01-15T10:00:00.000Z', startHour: 10, endHour: 11, slots: 1, price: '10.00' },
      { courtId: COURT_A, courtName: 'Court A', startsAt: '2030-01-15T11:00:00.000Z', startHour: 11, endHour: 12, slots: 1, price: '20.00' },
    ];
    const { s, user } = await confirmWith(() => apiError('SLOT_TAKEN', { alternatives }));
    expect(await alert()).toHaveTextContent(ERROR_MESSAGES.SLOT_TAKEN);
    expect(screen.getByText('These hours are still free:')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).not.toBeInTheDocument(); // nothing to confirm any more
    await waitFor(() => expect(gridCalls(s).length).toBeGreaterThan(1)); // the grid is reloaded

    await user.click(screen.getByRole('button', { name: 'Court B, 10:00 to 11:00, total 10' }));
    expect(await screen.findByRole('region', { name: 'Your selection' })).toBeInTheDocument();
    expect(within(summary()).getByRole('status')).toHaveTextContent('Court B: 10:00 to 11:00, 1 hour, total 10');
    expect(hour(/Court B/, '10')).toHaveAttribute('aria-pressed', 'true');
  });

  it('"slot taken" with nothing else free: no list, and a way back', async () => {
    const { user } = await confirmWith(() => apiError('SLOT_TAKEN', { alternatives: [] }));
    expect(await alert()).toHaveTextContent(ERROR_MESSAGES.SLOT_TAKEN);
    expect(screen.queryByText('These hours are still free:')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose another hour' }));
    expect(await screen.findByRole('region', { name: /Court A/ })).toBeInTheDocument();
  });

  it.each([
    ['restricted', { tier: 'RESTRICTED', limit: 1, upcoming: 1 }, 'Your credit score (Restricted) allows 1 upcoming booking. Cancel one, or wait until one has been played.'],
    ['caution', { tier: 'CAUTION', limit: 2, upcoming: 2 }, 'Your credit score (Caution) allows 2 upcoming bookings. Cancel one, or wait until one has been played.'],
    ['blocked', { tier: 'BLOCKED', limit: 0, upcoming: 0 }, 'Your credit score is too low to make bookings right now.'],
  ])('credit tier limit (%s): says how many bookings the score allows', async (_name, details, text) => {
    await confirmWith(() => apiError('TIER_LIMIT', details));
    expect(await alert()).toHaveTextContent(text);
  });

  it('own overlap: tells the player they already have a booking then', async () => {
    await confirmWith(() => apiError('BOOKING_OVERLAP'));
    expect(await alert()).toHaveTextContent(ERROR_MESSAGES.BOOKING_OVERLAP);
  });

  it('incomplete profile: links to the profile', async () => {
    await confirmWith(() => apiError('PROFILE_INCOMPLETE'));
    expect(within(await alert()).getByRole('link', { name: 'Complete your profile' })).toHaveAttribute('href', '/profile');
  });

  it('a rule the server enforces (such as "too late"): shows its reason and reloads the hours', async () => {
    const { s } = await confirmWith(() =>
      apiError('VALIDATION_ERROR', { issues: [{ in: 'body', path: 'startsAt', message: 'This hour can no longer be booked: bookings close 30 minutes before the start.' }] }),
    );
    expect(await alert()).toHaveTextContent('This hour can no longer be booked: bookings close 30 minutes before the start.');
    await waitFor(() => expect(gridCalls(s).length).toBeGreaterThan(1));
  });

  it('an unreachable server or a server error: plain words, and Confirm works again', async () => {
    let fail = true;
    const { s, user } = await confirmWith(() => {
      if (fail) throw new TypeError('Failed to fetch');
      return json(bookingResponse(), 201);
    });
    expect(await alert()).toHaveTextContent('We could not reach the server');
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeEnabled();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect(await screen.findByRole('heading', { name: 'Booking confirmed' })).toBeInTheDocument();
    expect(posts(s)).toHaveLength(2);
  });

  it('never shows server text or codes', async () => {
    await confirmWith(() => apiError('INTERNAL'));
    const text = (await alert()).textContent ?? '';
    expect(text).toContain(ERROR_MESSAGES.INTERNAL);
    expect(text).not.toContain('server text the UI must never show');
  });
});

describe('accessibility of the booking steps', () => {
  it('with hours chosen, at review, and at confirmation', async () => {
    const s = playerServer();
    const { container, user } = renderApp(s, { route });
    await screen.findByRole('region', { name: /Court A/ });
    await user.click(hour(/Court A/, '12'));
    await expectNoAccessibilityViolations(container);

    await user.click(within(summary()).getByRole('button', { name: 'Review booking' }));
    await screen.findByRole('heading', { name: 'Review your booking' });
    await expectNoAccessibilityViolations(container);

    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await screen.findByRole('heading', { name: 'Booking confirmed' });
    await expectNoAccessibilityViolations(container);
  });

  it('keeps every hour button and the booking buttons at least 44 px tall', async () => {
    const { container, user } = renderApp(playerServer(), { route });
    await screen.findByRole('region', { name: /Court A/ });
    await user.click(hour(/Court A/, '12'));
    const buttons = container.querySelectorAll<HTMLElement>('section button');
    expect(buttons.length).toBeGreaterThan(8);
    for (const button of buttons) expect(button.className, button.textContent ?? '').toContain('min-h-11');
  });
});
