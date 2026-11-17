// SRS USA-2: WCAG 2.1 AA. axe-core checks labels, ARIA references, headings and landmarks on every page, including with
// error messages showing. Colour contrast is verified from the real stylesheet in contrast.test.ts.
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAccessibilityViolations } from './helpers/a11y';
import { readWebFile } from './helpers/files';
import { createFakeServer, json, sampleUser } from './helpers/fakeServer';
import { renderApp } from './helpers/render';

describe('pages pass automated WCAG checks', () => {
  it.each(['/login', '/register', '/verify-email?email=ali%40example.com', '/verify-email', '/no/such/page'])('%s', async (route) => {
    const server = createFakeServer();
    server.anonymous();
    const { container } = renderApp(server, { route });
    await screen.findByRole('heading', { level: 1 });
    await expectNoAccessibilityViolations(container);
  });

  it('the home page of a signed-in user', async () => {
    const server = createFakeServer();
    server.signedIn(sampleUser());
    const { container } = renderApp(server, { route: '/home' });
    await screen.findByRole('heading', { name: /Welcome/ });
    await expectNoAccessibilityViolations(container);
  });

  it.each([
    ['/login', 'Sign in'],
    ['/register', 'Create account'],
    ['/verify-email?email=ali%40example.com', 'Verify and continue'],
  ])('%s with its error messages showing', async (route, button) => {
    const server = createFakeServer();
    server.anonymous();
    const { container, user } = renderApp(server, { route });
    await user.click(await screen.findByRole('button', { name: button }));
    expect(container.querySelector('[aria-invalid="true"]')).not.toBeNull(); // the errors really are on screen
    await expectNoAccessibilityViolations(container);
  });
});

describe('the profile page passes automated WCAG checks', () => {
  const profileServer = () => {
    const server = createFakeServer();
    server.signedIn(sampleUser());
    server.on('GET /meta/cities', () => json({ items: [{ id: 1, name: 'Alpha City' }] }));
    server.on('GET /me/profile', () => json({ cityId: null, cityName: null, area: null, dateOfBirthProvided: false, complete: false }));
    return server;
  };

  it('as first shown', async () => {
    const { container } = renderApp(profileServer(), { route: '/profile' });
    await screen.findByLabelText('City');
    await expectNoAccessibilityViolations(container);
  });

  it('with its error messages showing', async () => {
    const { container, user } = renderApp(profileServer(), { route: '/profile' });
    await user.click(await screen.findByRole('button', { name: 'Save profile' }));
    expect(container.querySelector('[aria-invalid="true"]')).not.toBeNull();
    await expectNoAccessibilityViolations(container);
  });

  it('has 44 px selects, inputs and buttons', async () => {
    const { container } = renderApp(profileServer(), { route: '/profile' });
    await screen.findByLabelText('City');
    const targets = container.querySelectorAll<HTMLElement>('select, input, button, nav a');
    expect(targets.length).toBeGreaterThan(3);
    for (const element of targets) expect(element.className, element.outerHTML.slice(0, 80)).toContain('min-h-11');
  });
});

describe('touch targets (USA-2: at least 44 px)', () => {
  it.each(['/login', '/register', '/verify-email?email=ali%40example.com'])('%s: buttons, text fields and header links are 44 px tall', async (route) => {
    const server = createFakeServer();
    server.anonymous();
    const { container } = renderApp(server, { route });
    await screen.findByRole('heading', { level: 1 });
    const targets = container.querySelectorAll<HTMLElement>('button, input:not([type="checkbox"]), nav a, header a');
    expect(targets.length).toBeGreaterThan(3);
    for (const element of targets) expect(element.className, element.outerHTML.slice(0, 80)).toContain('min-h-11'); // 2.75rem = 44 px
  });

  it('the checkbox rows are 44 px tall and the box itself is 24 px', async () => {
    const server = createFakeServer();
    server.anonymous();
    const { container } = renderApp(server, { route: '/register' });
    await screen.findByRole('heading', { level: 1 });
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      expect(box.className).toContain('size-6');
      expect(box.parentElement?.className).toContain('min-h-11');
    }
  });
});

describe('the page shell (index.html)', () => {
  const html = readWebFile('index.html');

  it('declares the language and scales to the phone without blocking zoom (WCAG 1.4.4)', () => {
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1"\s*\/?>/);
    expect(html).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/i);
  });
});
