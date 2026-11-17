// WCAG 2.4.3 and the keyboard start of a page: the first page of a visit leaves focus alone (so the first Tab reaches
// "Skip to content"); every later page takes focus on its heading so screen readers announce it.
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetInitialHeadingFocus } from '../src/ui/PageHeading';
import { createFakeServer } from './helpers/fakeServer';
import { renderApp } from './helpers/render';

beforeEach(() => resetInitialHeadingFocus());

describe('focus on page headings', () => {
  it('does not take focus on the first page of the visit, so the first Tab starts at the top', async () => {
    const server = createFakeServer();
    server.anonymous();
    const { user } = renderApp(server, { route: '/login' });
    const heading = await screen.findByRole('heading', { name: 'Sign in' });
    expect(heading).not.toHaveFocus();
    expect(document.body).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus(); // the very first stop
  });

  it('takes focus on every later page, so the new page is announced', async () => {
    const server = createFakeServer();
    server.anonymous();
    const { user } = renderApp(server, { route: '/login' });
    await user.click(await screen.findByRole('link', { name: 'Create an account' }));
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toHaveFocus();
  });

  it('is not fooled by the redirect from the home address to the sign-in page', async () => {
    const server = createFakeServer();
    server.anonymous();
    renderApp(server, { route: '/' });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).not.toHaveFocus();
  });
});
