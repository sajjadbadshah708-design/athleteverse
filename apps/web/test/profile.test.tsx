// FR-1.14, FR-1.15, A7, USA-3: the profile form (city, area, date of birth), against a scripted API.
import { PROFILE_MESSAGES } from '@athleteverse/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, createFakeServer, json, sampleUser, type FakeServer } from './helpers/fakeServer';
import { renderApp } from './helpers/render';

const CITIES = { items: [{ id: 1, name: 'Alpha City' }, { id: 2, name: 'Beta City' }] };
const EMPTY_PROFILE = { cityId: null, cityName: null, area: null, dateOfBirthProvided: false, complete: false };
const COMPLETE_PROFILE = { cityId: 1, cityName: 'Alpha City', area: 'Downtown', dateOfBirthProvided: true, complete: true };

/** A player whose profile is `profile`; saving flips /me to "complete". */
function serverWith(profile: typeof EMPTY_PROFILE | typeof COMPLETE_PROFILE) {
  const server = createFakeServer();
  let complete = profile.complete;
  server.on('GET /me', () => json({ user: sampleUser({ profileComplete: complete }) }));
  server.on('GET /meta/cities', () => json(CITIES));
  server.on('GET /me/profile', () => json(profile));
  server.on('PATCH /me/profile', () => ((complete = true), json(COMPLETE_PROFILE)));
  return server;
}

const yearsAgo = (years: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toLocaleDateString('en-CA');
};
const field = (label: string | RegExp) => screen.getByLabelText(label);
const lastPatch = (server: FakeServer) => server.calls.filter((c) => c.method === 'PATCH').at(-1)?.body;

describe('profile page', () => {
  it('shows the account details read-only, the cities from the server, and a date field that explains itself', async () => {
    renderApp(serverWith(EMPTY_PROFILE), { route: '/profile' });
    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeInTheDocument();
    expect(await screen.findByLabelText('City')).toBeInTheDocument();

    const details = within(screen.getByRole('region', { name: 'Your details' })); // the name also appears in the header
    expect(details.getByText('Ali Khan')).toBeInTheDocument();
    expect(details.getByText('ali@example.com')).toBeInTheDocument();
    expect(details.getByText('923001234567')).toBeInTheDocument();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose your city', 'Alpha City', 'Beta City']);
    expect(field('Date of birth')).toHaveAttribute('type', 'date');
    expect(field('Date of birth')).toHaveAttribute('autocomplete', 'bday');
    expect(field('Date of birth')).toHaveAccessibleDescription(/never shown to anyone, including you/);
  });

  it('asks for the city and the date of birth next to their fields and sends nothing', async () => {
    const server = serverWith(EMPTY_PROFILE);
    const { user } = renderApp(server, { route: '/profile' });
    await user.click(await screen.findByRole('button', { name: 'Save profile' }));

    expect(field('City')).toHaveAccessibleDescription(PROFILE_MESSAGES.chooseCity);
    expect(field('Date of birth')).toHaveAccessibleDescription(expect.stringContaining(PROFILE_MESSAGES.dateRequired));
    expect(field('City')).toHaveFocus();
    expect(server.count('PATCH /me/profile')).toBe(0);
  });

  it('tells someone under 16 at once, from the browser, without asking the server', async () => {
    const server = serverWith(EMPTY_PROFILE);
    const { user } = renderApp(server, { route: '/profile' });
    await user.selectOptions(await screen.findByLabelText('City'), 'Alpha City');
    fireEvent.change(field('Date of birth'), { target: { value: yearsAgo(15) } });
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(field('Date of birth')).toHaveAccessibleDescription(expect.stringContaining(PROFILE_MESSAGES.tooYoung));
    expect(field('Date of birth')).toHaveFocus();
    expect(server.count('PATCH /me/profile')).toBe(0);
  });

  it('saves a valid profile, refreshes who is signed in, and returns home with a confirmation and no reminder', async () => {
    const server = serverWith(EMPTY_PROFILE);
    const { user } = renderApp(server, { route: '/profile' });
    await user.selectOptions(await screen.findByLabelText('City'), 'Beta City');
    await user.type(field('Area or neighbourhood'), '  Harbour ');
    fireEvent.change(field('Date of birth'), { target: { value: yearsAgo(20) } });
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByRole('heading', { name: 'Welcome, Ali Khan' })).toBeInTheDocument();
    expect(screen.getByText('Your profile is saved.')).toBeInTheDocument();
    expect(screen.queryByText(/profile is not complete/)).not.toBeInTheDocument();
    expect(lastPatch(server)).toEqual({ cityId: 2, area: 'Harbour', dateOfBirth: yearsAgo(20) }); // the city id is a number, the area is trimmed
  });

  it('shows the server\'s own reason next to the date field when it refuses (the server judges the age)', async () => {
    const server = serverWith(EMPTY_PROFILE);
    server.on('PATCH /me/profile', () =>
      apiError('VALIDATION_ERROR', { issues: [{ in: 'body', path: 'dateOfBirth', message: PROFILE_MESSAGES.tooYoung }] }),
    );
    const { user } = renderApp(server, { route: '/profile' });
    await user.selectOptions(await screen.findByLabelText('City'), 'Alpha City');
    fireEvent.change(field('Date of birth'), { target: { value: yearsAgo(20) } });
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(field('Date of birth')).toHaveAccessibleDescription(expect.stringContaining(PROFILE_MESSAGES.tooYoung)));
    expect(field('Date of birth')).toHaveFocus();
  });

  it('keeps what was typed and explains a general failure in plain words', async () => {
    const server = serverWith(EMPTY_PROFILE);
    server.on('PATCH /me/profile', () => apiError('INTERNAL'));
    const { user } = renderApp(server, { route: '/profile' });
    await user.selectOptions(await screen.findByLabelText('City'), 'Alpha City');
    await user.type(field('Area or neighbourhood'), 'Downtown');
    fireEvent.change(field('Date of birth'), { target: { value: yearsAgo(20) } });
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side');
    expect(field('Area or neighbourhood')).toHaveValue('Downtown');
    expect(field('City')).toHaveValue('1');
  });

  it('for a complete profile: no date field (it is never shown), the city is filled in, and updates send no date', async () => {
    const server = serverWith(COMPLETE_PROFILE);
    const { user } = renderApp(server, { route: '/profile' });
    expect(await screen.findByLabelText('City')).toHaveValue('1');
    expect(field('Area or neighbourhood')).toHaveValue('Downtown');
    expect(screen.queryByLabelText('Date of birth')).not.toBeInTheDocument();
    expect(screen.getByText('Date of birth: saved. It is never shown.')).toBeInTheDocument();

    await user.selectOptions(field('City'), 'Beta City');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByRole('heading', { name: /Welcome/ });
    expect(lastPatch(server)).toEqual({ cityId: 2, area: 'Downtown' }); // no dateOfBirth key at all
  });

  it('says so when the form cannot be loaded, and loads it on retry', async () => {
    const server = serverWith(EMPTY_PROFILE);
    let failures = 1;
    server.on('GET /meta/cities', () => (failures-- > 0 ? apiError('INTERNAL') : json(CITIES)));
    const { user } = renderApp(server, { route: '/profile' });
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load the profile form');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('City')).toBeInTheDocument();
  });
});

describe('getting to the profile page', () => {
  it('the home page reminds a new player and links to it', async () => {
    const { user } = renderApp(serverWith(EMPTY_PROFILE), { route: '/home' });
    await user.click(await screen.findByRole('link', { name: 'Complete your profile' }));
    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeInTheDocument();
  });

  it('the header shows a Profile link to players only', async () => {
    renderApp(serverWith(COMPLETE_PROFILE), { route: '/home' });
    expect(await screen.findByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
  });

  it('managers see no Profile link and no access to the page', async () => {
    const server = createFakeServer();
    server.signedIn(sampleUser({ role: 'MANAGER', profileComplete: null, creditScore: null }));
    renderApp(server, { route: '/profile' });
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument();
  });

  it('a visitor without a session is sent to sign in first', async () => {
    const server = createFakeServer();
    server.anonymous();
    renderApp(server, { route: '/profile' });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
