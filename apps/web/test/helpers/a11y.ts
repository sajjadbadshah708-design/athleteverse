import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe-core on the rendered page: labels, roles, ARIA references, headings and landmarks (WCAG 2.1 A and AA).
 * Colour contrast cannot be computed in jsdom, so it is checked separately from the real stylesheet (contrast.test.ts).
 */
export async function expectNoAccessibilityViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  const summary = results.violations.map((v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.html.slice(0, 80)).join(' | ')}`);
  expect(summary).toEqual([]);
}
