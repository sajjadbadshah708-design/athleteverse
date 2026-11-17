// FR-1.20 / FR-5.10 (MVP slice): the Super Admin searches and filters accounts, 20 per page.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAccessibilityViolations } from './helpers/a11y';
import { createFakeServer, json, sampleUser, type FakeServer } from './helpers/fakeServer';
import { renderApp } from './helpers/render';

const account = (n: number, extra: object = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, fullName: `Person ${n}`, email: `p${n}@example.com`, phone: `92300000${String(n).padStart(4, '0')}`,
  role: 'PLAYER', status: 'ACTIVE', isOwner: false, createdAt: '2030-01-10T00:00:00.000Z', creditScore: 100, venueName: null, ...extra,
});

function adminServer() {
  const s = createFakeServer();
  s.signedIn(sampleUser({ role: 'ADMIN', profileComplete: null, creditScore: null }));
  s.on('GET /admin/managers', () => json({ items: [] }));
  s.on('GET /admin/accounts', (call) => {
    const p = new URLSearchParams(call.search);
    if (p.get('q') === 'nobody') return json({ items: [], page: 1, pageSize: 20, total: 0 });
    if (p.get('role') === 'STAFF') return json({ items: [account(90, { role: 'STAFF', creditScore: null, venueName: 'Arena One', fullName: 'Desk Agent' })], page: 1, pageSize: 20, total: 1 });
    const page = Number(p.get('page') ?? 1);
    return json({ items: page === 1
      ? [account(1, { role: 'ADMIN', isOwner: true, creditScore: null, fullName: 'Owner Admin' }), ...Array.from({ length: 19 }, (_, i) => account(i + 2))]
      : [account(21), account(22)], page, pageSize: 20, total: 22 });
  });
  return s;
}
const accountCalls = (s: FakeServer) => s.calls.filter((c) => c.path === '/admin/accounts').map((c) => c.search);

describe('Super Admin accounts list', () => {
  it('shows accounts with role, status, credit or venue, and marks the owner', async () => {
    renderApp(adminServer(), { route: '/admin' });
    const table = await screen.findByRole('table');
    expect(screen.getByText('22 accounts')).toBeInTheDocument();
    const owner = within(table).getByText('Owner Admin').closest('tr')!;
    expect(owner).toHaveTextContent('Owner');
    expect(within(table).getAllByRole('row')).toHaveLength(21); // header + 20
    await expectNoAccessibilityViolations(document.body);
  });

  it('pages through the results', async () => {
    const user = userEvent.setup();
    const s = adminServer();
    renderApp(s, { route: '/admin' });
    await screen.findByText('Page 1 of 2');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Person 22')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(accountCalls(s)).toContain('?page=2');
  });

  it('filters by role at once and searches on submit, starting again at page 1', async () => {
    const user = userEvent.setup();
    const s = adminServer();
    renderApp(s, { route: '/admin' });
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Role'), 'STAFF');
    const row = (await screen.findByText('Desk Agent')).closest('tr')!;
    expect(row).toHaveTextContent('Arena One');
    await user.selectOptions(screen.getByLabelText('Role'), '');
    await user.type(screen.getByLabelText('Search by name, e-mail or phone'), 'nobody');
    expect(accountCalls(s).some((q) => q.includes('nobody'))).toBe(false); // nothing is sent while typing
    await user.click(within(screen.getByRole('search')).getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No accounts match these filters.')).toBeInTheDocument();
    await waitFor(() => expect(accountCalls(s)).toContain('?q=nobody'));
  });
});
