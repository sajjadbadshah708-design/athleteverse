// SRS USA-2, USA-3, USA-4, FR-1.1 to FR-1.4, FR-1.7: the sign-in, sign-up and e-mail-code pages, against a scripted API.
import { ERROR_MESSAGES, STRINGS } from '@athleteverse/shared';
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, createFakeServer, json, sampleUser } from './helpers/fakeServer';
import { renderApp } from './helpers/render';

const field = (label: string | RegExp) => screen.getByLabelText(label);

describe('login page', () => {
  it('shows the form to a visitor without a session', async () => {
    const server = createFakeServer();
    server.anonymous();
    renderApp(server, { route: '/login' });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(field('E-mail')).toHaveAttribute('autocomplete', 'email');
    expect(field('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // a fresh visitor is not told their session ended
  });

  it('explains empty fields next to each field, focuses the first one, and sends nothing', async () => {
    const server = createFakeServer();
    server.anonymous();
    const { user } = renderApp(server, { route: '/login' });
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(field('E-mail')).toHaveAccessibleDescription('Enter a valid e-mail address');
    expect(field('E-mail')).toBeInvalid();
    expect(field('Password')).toHaveAccessibleDescription('Enter your password');
    expect(field('E-mail')).toHaveFocus();
    expect(server.count('POST /auth/login')).toBe(0);
  });

  it('signs in, normalises the e-mail, and lands on the home page', async () => {
    const server = createFakeServer();
    server.anonymous();
    server.on('POST /auth/login', () => json({ user: sampleUser() }));
    const { user } = renderApp(server, { route: '/login' });

    await user.type(await screen.findByLabelText('E-mail'), '  Ali@Example.com ');
    await user.type(field('Password'), 'Passw0rdOK');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Welcome, Ali Khan' })).toBeInTheDocument();
    expect(server.calls.find((c) => c.path === '/auth/login')?.body).toEqual({ email: 'ali@example.com', password: 'Passw0rdOK' });
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument(); // the header changed too
  });

  it('sends a visitor who tried a protected page back there after signing in', async () => {
    const server = createFakeServer();
    server.anonymous();
    server.on('POST /auth/login', () => json({ user: sampleUser() }));
    const { user } = renderApp(server, { route: '/home' });

    await user.type(await screen.findByLabelText('E-mail'), 'ali@example.com'); // redirected to /login
    await user.type(field('Password'), 'Passw0rdOK');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: /Welcome/ })).toBeInTheDocument();
  });

  it.each([
    ['INVALID_CREDENTIALS', undefined, ERROR_MESSAGES.INVALID_CREDENTIALS],
    ['ACCOUNT_LOCKED', { lockedUntil: '2030-01-15T12:15:00.000Z' }, /Too many failed attempts\. You can try again at \d{1,2}:\d{2}/],
    ['RATE_LIMITED', { retryAfterSeconds: 42 }, 'Too many attempts. Try again in 42 seconds.'],
    ['ACCOUNT_SUSPENDED', undefined, ERROR_MESSAGES.ACCOUNT_SUSPENDED],
    ['INTERNAL', undefined, ERROR_MESSAGES.INTERNAL],
  ] as const)('explains %s in plain words, without codes or server text', async (code, details, expected) => {
    const server = createFakeServer();
    server.anonymous();
    server.on('POST /auth/login', () => apiError(code, details));
    const { user } = renderApp(server, { route: '/login' });
    await user.type(await screen.findByLabelText('E-mail'), 'ali@example.com');
    await user.type(field('Password'), 'Passw0rdOK');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    if (typeof expected === 'string') expect(alert).toHaveTextContent(expected);
    else expect(alert.textContent).toMatch(expected);
    expect(alert.textContent).not.toContain(code);
    expect(alert.textContent).not.toContain('server text the UI must never show');
  });

  it('says so when the server cannot be reached at all', async () => {
    const server = createFakeServer();
    server.anonymous();
    server.on('POST /auth/login', () => {
      throw new TypeError('Failed to fetch');
    });
    const { user } = renderApp(server, { route: '/login' });
    await user.type(await screen.findByLabelText('E-mail'), 'ali@example.com');
    await user.type(field('Password'), 'Passw0rdOK');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(STRINGS.network.unreachable);
  });

  it('sends someone with an unverified e-mail to the code page, with the reason', async () => {
    const server = createFakeServer();
    server.anonymous();
    server.on('POST /auth/login', () => apiError('EMAIL_NOT_VERIFIED', { email: 'ali@example.com' }));
    const { user } = renderApp(server, { route: '/login' });
    await user.type(await screen.findByLabelText('E-mail'), 'ali@example.com');
    await user.type(field('Password'), 'Passw0rdOK');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Check your e-mail' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(ERROR_MESSAGES.EMAIL_NOT_VERIFIED);
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled(); // the old code may be long gone
  });

  it('cannot be submitted twice while the first request is running', async () => {
    const server = createFakeServer();
    server.anonymous();
    let finish!: () => void;
    server.on('POST /auth/login', () => new Promise<Response>((resolve) => (finish = () => resolve(json({ user: sampleUser() })))));
    const { user } = renderApp(server, { route: '/login' });
    await user.type(await screen.findByLabelText('E-mail'), 'ali@example.com');
    await user.type(field('Password'), 'Passw0rdOK');
    const submit = screen.getByRole('button', { name: 'Sign in' });
    await user.click(submit);
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');
    await user.click(submit);
    expect(server.count('POST /auth/login')).toBe(1);
    await act(async () => finish());
    expect(await screen.findByRole('heading', { name: /Welcome/ })).toBeInTheDocument();
  });

  it('lets the password be shown and hidden', async () => {
    const server = createFakeServer();
    server.anonymous();
    const { user } = renderApp(server, { route: '/login' });
    const password = await screen.findByLabelText('Password');
    await user.type(password, 'Passw0rdOK');
    expect(password).toHaveAttribute('type', 'password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    await user.click(toggle);
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('register page', () => {
  const fillValid = async (user: ReturnType<typeof renderApp>['user']) => {
    await user.type(await screen.findByLabelText('Full name'), 'Ali Khan');
    await user.type(field('E-mail'), 'Ali@Example.com');
    await user.type(field('Phone number'), '+92 300 123 4567');
    await user.type(field('Password'), 'Passw0rdOK');
    await user.click(field(/accept the Terms/));
    await user.click(field(/at least 16/));
  };

  it('reports every problem at once, next to each field, and focuses the first', async () => {
    const server = createFakeServer();
    server.anonymous();
    const { user } = renderApp(server, { route: '/register' });
    await user.type(await screen.findByLabelText('Full name'), 'R2-D2');
    await user.type(field('E-mail'), 'not-an-email');
    await user.type(field('Phone number'), '12345');
    await user.type(field('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(field('Full name')).toHaveAccessibleDescription('Use letters, spaces, hyphens and apostrophes only');
    expect(field('E-mail')).toHaveAccessibleDescription(/Enter a valid e-mail address/);
    expect(field('Phone number')).toHaveAccessibleDescription(/Enter 9 to 15 digits/);
    expect(field('Password')).toHaveAccessibleDescription(/Use at least 8 characters/);
    expect(field(/accept the Terms/)).toHaveAccessibleDescription('You must accept the Terms');
    expect(field(/at least 16/)).toHaveAccessibleDescription('You must be at least 16 years old');
    expect(field('Full name')).toHaveFocus();
    expect(server.count('POST /auth/register')).toBe(0);
  });

  it('sends clean values and continues to the code page with the e-mail and a resend timer (FR-1.1, FR-1.3)', async () => {
    const server = createFakeServer();
    server.anonymous();
    server.on('POST /auth/register', () => json({ status: 'VERIFICATION_REQUIRED', email: 'ali@example.com' }, 201));
    const { user } = renderApp(server, { route: '/register' });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Check your e-mail' })).toBeInTheDocument();
    expect(screen.getByText(/We sent a 6-digit code to ali@example\.com/)).toBeInTheDocument();
    expect(server.calls.find((c) => c.path === '/auth/register')?.body).toEqual({
      fullName: 'Ali Khan',
      email: 'ali@example.com', // lower-cased
      phone: '923001234567', // digits only
      password: 'Passw0rdOK',
      acceptTerms: true,
      confirmAge16: true,
    });
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeDisabled();
    expect(screen.getByText('You can ask for a new code in 60 seconds.')).toBeInTheDocument();
  });

  it('shows "already registered" next to the e-mail and phone fields (FR-1.2)', async () => {
    const server = createFakeServer();
    server.anonymous();
    server.on('POST /auth/register', () =>
      apiError('CONFLICT', {
        issues: [
          { in: 'body', path: 'email', message: 'This e-mail is already registered' },
          { in: 'body', path: 'phone', message: 'This phone number is already registered' },
        ],
      }),
    );
    const { user } = renderApp(server, { route: '/register' });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(field('E-mail')).toHaveAccessibleDescription(/already registered/));
    expect(field('Phone number')).toHaveAccessibleDescription(/already registered/);
    expect(field('E-mail')).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // no duplicate banner: the fields say it
  });

  it('keeps what was typed when the server refuses', async () => {
    const server = createFakeServer();
    server.anonymous();
    server.on('POST /auth/register', () => apiError('INTERNAL'));
    const { user } = renderApp(server, { route: '/register' });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR_MESSAGES.INTERNAL);
    expect(field('Full name')).toHaveValue('Ali Khan');
    expect(field(/accept the Terms/)).toBeChecked();
  });
});

describe('e-mail code page', () => {
  const open = (route = '/verify-email?email=ali%40example.com') => {
    const server = createFakeServer();
    server.anonymous();
    return { server, ...renderApp(server, { route }) };
  };

  it('accepts digits only and signs in with the right code (FR-1.3, FR-1.8)', async () => {
    const { server, user } = open();
    server.on('POST /auth/verify-email', () => json({ user: sampleUser() }));
    const code = await screen.findByLabelText('Verification code');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    await user.type(code, '12ab34 56');
    expect(code).toHaveValue('123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));

    expect(await screen.findByRole('heading', { name: 'Welcome, Ali Khan' })).toBeInTheDocument();
    expect(server.calls.find((c) => c.path === '/auth/verify-email')?.body).toEqual({ email: 'ali@example.com', code: '123456' });
  });

  it('says how many tries are left after a wrong code, right under the field', async () => {
    const { server, user } = open();
    server.on('POST /auth/verify-email', () => apiError('OTP_INVALID', { attemptsLeft: 4 }));
    await user.type(await screen.findByLabelText('Verification code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await waitFor(() => expect(field('Verification code')).toHaveAccessibleDescription('That code is not correct. 4 tries left.'));
    expect(field('Verification code')).toHaveFocus();
  });

  it('says "1 try left" in the singular', async () => {
    const { server, user } = open();
    server.on('POST /auth/verify-email', () => apiError('OTP_INVALID', { attemptsLeft: 1 }));
    await user.type(await screen.findByLabelText('Verification code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await waitFor(() => expect(field('Verification code')).toHaveAccessibleDescription('That code is not correct. 1 try left.'));
  });

  it('tells the user to ask for a new code when this one is used up', async () => {
    const { server, user } = open();
    server.on('POST /auth/verify-email', () => apiError('OTP_EXPIRED'));
    await user.type(await screen.findByLabelText('Verification code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR_MESSAGES.OTP_EXPIRED);
  });

  it('asks for the e-mail when the page is opened without one', async () => {
    const { user } = open('/verify-email');
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(field('E-mail')).toHaveAccessibleDescription('Enter a valid e-mail address');
    expect(field('Verification code')).toHaveAccessibleDescription('Enter the 6-digit code');
  });
});

describe('resending the code (FR-1.3: once a minute)', () => {
  afterEach(() => vi.useRealTimers());

  it('counts down 60 seconds, then allows one new code and starts the countdown again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = createFakeServer();
    server.anonymous();
    server.on('POST /auth/resend-otp', () => json({ ok: true }));
    // The registration flow navigates here with fresh: true. Mount directly at
    // that state so fake timers only control the cooldown, not user-event typing.
    const { user } = renderApp(server, {
      initialEntry: { pathname: '/verify-email', search: '?email=ali@example.com', state: { fresh: true } },
      fakeTimers: true,
    });

    const resend = await screen.findByRole('button', { name: 'Send a new code' });
    expect(resend).toBeDisabled();
    await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)));
    expect(screen.getByText(/in (29|30|31) seconds/)).toBeInTheDocument();
    expect(resend).toBeDisabled();

    await act(async () => void (await vi.advanceTimersByTimeAsync(31_000)));
    expect(resend).toBeEnabled();
    await user.click(resend);
    expect(await screen.findByText(STRINGS.auth.verify.resent)).toBeInTheDocument();
    expect(server.count('POST /auth/resend-otp')).toBe(1);
    expect(resend).toBeDisabled(); // the minute starts again
  });
});
