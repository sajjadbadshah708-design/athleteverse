// FR-2.1, FR-2.2: public venue search. The URL holds the search, the server does the work, the page explains what happened.
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAccessibilityViolations } from './helpers/a11y';
import { apiError, createFakeServer, json, type FakeServer } from './helpers/fakeServer';
import { renderApp } from './helpers/render';
import { CITIES, SPORTS, summary } from './helpers/venueData';

/** A visitor who is not signed in, with reference lists and a venue list planned. */
function server(list: unknown = { items: [summary(1), summary(2, { name: 'Beta Hall', sports: [{ id: 1, name: 'Futsal' }, { id: 2, name: 'Badminton' }], courtCount: 1, fromPrice: '10.50' })], page: 1, pageSize: 20, total: 2 }) {
  const s = createFakeServer();
  s.anonymous();
  s.on('GET /meta/cities', () => json(CITIES));
  s.on('GET /meta/sports', () => json(SPORTS));
  s.on('GET /venues', () => json(list));
  return s;
}
const venueCalls = (s: FakeServer) => s.calls.filter((c) => c.path === '/venues');
const lastSearch = (s: FakeServer) => venueCalls(s).at(-1)?.search;
const field = (label: string | RegExp) => screen.getByLabelText(label);

describe('venue list', () => {
  it('works without signing in and shows each venue with its sports, courts, cheapest price and hours', async () => {
    renderApp(server(), { route: '/venues' });
    expect(await screen.findByRole('heading', { name: 'Find a court' })).toBeInTheDocument();
    expect(await screen.findByText('2 venues found')).toBeInTheDocument();

    const beta = within(screen.getByRole('link', { name: 'Beta Hall' }).closest('li')!);
    expect(beta.getByText('2 Street, Alpha City')).toBeInTheDocument();
    expect(beta.getByText('Futsal')).toBeInTheDocument();
    expect(beta.getByText('Badminton')).toBeInTheDocument(); // sports are individually labelled badges in the redesigned card
    expect(beta.getByText('1 court · From 10.50 per hour')).toBeInTheDocument(); // "1 court", singular
    expect(beta.getByText('Open 08:00 to 23:00')).toBeInTheDocument();
    expect(screen.getByText('2 courts · From 1,200 per hour')).toBeInTheDocument(); // plural, grouped thousands, no ".00"
    expect(screen.getByRole('link', { name: 'Venue 1' })).toHaveAttribute('href', '/venues/00000000-0000-4000-8000-000000000001');
  });

  it('says so, in words, when nothing matches', async () => {
    renderApp(server({ items: [], page: 1, pageSize: 20, total: 0 }), { route: '/venues?q=zzz' });
    expect(await screen.findByText('0 venues found')).toBeInTheDocument();
    expect(screen.getByText(/No venues match your search/)).toBeInTheDocument();
  });

  it('says "1 venue found" in the singular', async () => {
    renderApp(server({ items: [summary(1)], page: 1, pageSize: 20, total: 1 }), { route: '/venues' });
    expect(await screen.findByText('1 venue found')).toBeInTheDocument();
  });

  it('starts a search from what is typed and chosen, and puts it in the address (shareable, Back button works)', async () => {
    const s = server();
    const { user } = renderApp(s, { route: '/venues' });
    await user.type(await screen.findByLabelText('Venue name or address'), '  arena ');
    await user.selectOptions(field('City'), 'Beta City');
    await user.selectOptions(field('Sport'), 'Futsal');
    await user.type(field('Lowest price per hour'), '10');
    await user.type(field('Highest price per hour'), '25.50');
    await user.selectOptions(field('Sort by'), 'Price, lowest first');
    await user.click(screen.getByRole('button', { name: 'Show venues' }));

    await screen.findByText('2 venues found');
    const params = new URLSearchParams(lastSearch(s));
    expect(Object.fromEntries(params)).toEqual({ q: 'arena', cityId: '2', sportId: '2', minPrice: '10', maxPrice: '25.50', sort: 'price' });
  });

  it('does not send empty filters or the default sort', async () => {
    const s = server();
    const { user } = renderApp(s, { route: '/venues' });
    await user.click(await screen.findByRole('button', { name: 'Show venues' }));
    await screen.findByText('2 venues found');
    expect(lastSearch(s)).toBe(''); // nothing to ask: all venues, by name
  });

  it('opens a shared link with the form filled in from the address and the matching request', async () => {
    const s = server();
    renderApp(s, { route: '/venues?q=arena&cityId=2&sort=price&page=2&junk=1' });
    expect(await screen.findByLabelText('Venue name or address')).toHaveValue('arena');
    expect(field('City')).toHaveValue('2');
    expect(field('Sort by')).toHaveValue('price');
    await screen.findByText(/venues? found/);
    expect(Object.fromEntries(new URLSearchParams(lastSearch(s)))).toEqual({ q: 'arena', cityId: '2', sort: 'price', page: '2' }); // unknown parameters are dropped
  });

  it('refuses a price that is not a number, or a lowest price above the highest, next to the field and sends nothing', async () => {
    const s = server();
    const { user } = renderApp(s, { route: '/venues' });
    await screen.findByText('2 venues found');
    const before = venueCalls(s).length;

    await user.type(field('Highest price per hour'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Show venues' }));
    expect(field('Highest price per hour')).toHaveAccessibleDescription('Enter a number such as 20 or 12.50, or leave this empty.');
    expect(field('Highest price per hour')).toHaveFocus();

    await user.clear(field('Highest price per hour'));
    await user.type(field('Highest price per hour'), '5');
    await user.type(field('Lowest price per hour'), '9');
    await user.click(screen.getByRole('button', { name: 'Show venues' }));
    expect(field('Lowest price per hour')).toHaveAccessibleDescription(expect.stringContaining('cannot be higher than the highest price'));
    expect(venueCalls(s).length).toBe(before);
  });

  it('clears all filters in one step', async () => {
    const s = server();
    const { user } = renderApp(s, { route: '/venues?q=arena&maxPrice=30' });
    await screen.findByText(/venues? found/);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByLabelText('Venue name or address')).toHaveValue('');
    expect(lastSearch(s)).toBe('');
  });

  it('pages 20 at a time, with Previous and Next links that keep the filters', async () => {
    const s = server({ items: Array.from({ length: 20 }, (_, i) => summary(i + 1)), page: 2, pageSize: 20, total: 45 });
    renderApp(s, { route: '/venues?q=hall&page=2' });
    expect(await screen.findByText('45 venues found')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous page' })).toHaveAttribute('href', '/venues?q=hall');
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute('href', '/venues?q=hall&page=3');
  });

  it('shows no paging for one page of results', async () => {
    renderApp(server(), { route: '/venues' });
    await screen.findByText('2 venues found');
    expect(screen.queryByText(/Page \d of/)).not.toBeInTheDocument();
  });

  it('explains a failure and loads again on retry', async () => {
    const s = server();
    let failures = 1;
    s.on('GET /venues', () => (failures-- > 0 ? apiError('INTERNAL') : json({ items: [summary(1)], page: 1, pageSize: 20, total: 1 })));
    const { user } = renderApp(s, { route: '/venues' });
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load the venues');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1 venue found')).toBeInTheDocument();
  });

  it('still lists venues when the city and sport lists cannot be loaded (the filters are just shorter)', async () => {
    const s = server();
    s.on('GET /meta/cities', () => apiError('INTERNAL'));
    s.on('GET /meta/sports', () => apiError('INTERNAL'));
    renderApp(s, { route: '/venues' });
    expect(await screen.findByText('2 venues found')).toBeInTheDocument();
    expect(within(field('City')).getAllByRole('option').map((o) => o.textContent)).toEqual(['All cities']);
  });

  it('passes automated accessibility checks, also with a filter error showing', async () => {
    const { container, user } = renderApp(server(), { route: '/venues' });
    await screen.findByText('2 venues found');
    await expectNoAccessibilityViolations(container);
    await user.type(field('Highest price per hour'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Show venues' }));
    expect(container.querySelector('[aria-invalid="true"]')).not.toBeNull();
    await expectNoAccessibilityViolations(container);
  });

  it('is reachable from the header for everyone, signed in or not', async () => {
    renderApp(server(), { route: '/login' });
    expect(await screen.findByRole('link', { name: 'Venues' })).toHaveAttribute('href', '/venues');
  });
});
