// SRS USA-2: WCAG 2.1 AA colour contrast, computed from the colour tokens in src/index.css, the file the app actually uses.
// Text needs 4.5:1; borders, focus rings and other UI parts need 3:1.
import { describe, expect, it } from 'vitest';
import { readWebFile } from './helpers/files';

const css = readWebFile('src/index.css');
const tokens = Object.fromEntries([...css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1]!, m[2]!]));

const channel = (hex: string, i: number) => {
  const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const TEXT: [string, string, string][] = [
  ['ink', 'paper', 'body text'],
  ['ink-muted', 'paper', 'hints and secondary text'],
  ['brand', 'paper', 'links and the secondary button'],
  ['brand-ink', 'brand', 'primary button'],
  ['brand-ink', 'brand-dark', 'primary button on hover'],
  ['brand', 'info-soft', 'secondary button on hover'],
  ['ink', 'info-soft', 'information banner'],
  ['danger', 'paper', 'field error text'],
  ['danger', 'danger-soft', 'error banner'],
  ['warn', 'warn-soft', 'warning banner'],
  ['ink', 'ok-soft', 'available hour'],
  ['ink-muted', 'wash', 'booked and blocked hours'],
  ['ink-muted', 'paper', 'past hours'],
];
const UI: [string, string, string][] = [
  ['line', 'paper', 'input borders'],
  ['brand', 'paper', 'focus ring and the secondary button border'],
  ['danger', 'paper', 'invalid input border'],
  ['danger', 'danger-soft', 'error banner border'],
  ['brand', 'info-soft', 'information banner border'],
  ['warn', 'warn-soft', 'warning banner border'],
  ['ok', 'ok-soft', 'available hour border'],
  ['line', 'wash', 'booked and blocked hour border'],
];

describe('colour tokens', () => {
  it('are read from the stylesheet', () => {
    expect(Object.keys(tokens).sort()).toEqual(
      ['brand', 'brand-dark', 'brand-ink', 'danger', 'danger-soft', 'info-soft', 'ink', 'ink-muted', 'line', 'ok', 'ok-soft', 'paper', 'warn', 'warn-soft', 'wash'].sort(),
    );
  });

  it.each(TEXT)('%s on %s reaches 4.5:1 (%s)', (fg, bg) => {
    expect(ratio(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI)('%s against %s reaches 3:1 (%s)', (fg, bg) => {
    expect(ratio(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(3);
  });

  it('the contrast formula itself is right (black on white is 21:1, white on white is 1:1)', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(ratio('#767676', '#ffffff')).toBeGreaterThan(4.5); // the well-known "just passes" grey
    expect(ratio('#777777', '#ffffff')).toBeLessThan(4.5);
  });
});
