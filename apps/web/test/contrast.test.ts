/**
 * WCAG AA contrast of the colour tokens (PROJECT.md section 9, decision D12).
 * Reads tokens.css itself, so changing a colour without re-checking fails here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/theme/tokens.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`missing ${selector}`);
  const open = css.indexOf('{', start);
  const body = css.slice(open + 1, css.indexOf('}', open));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) out[m[1]!] = m[2]!.toLowerCase();
  return out;
}

const light = block(':root {');
const dark = block(":root[data-theme='dark']");
const darkMedia = block(":root:not([data-theme='light'])");

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const TYPES = [
  'fix-encoding',
  'fix-accent',
  'fix-invisible',
  'fix-translate',
  'fix-rule',
  'fix-safety',
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_name, t) => {
  const c = (a: string, b: string) => contrast(t[a]!, t[b]!);

  it('body, muted and accent text reach 4.5:1 on bg and surface', () => {
    for (const fg of ['text', 'muted', 'accent', 'accent-text']) {
      for (const bg of ['bg', 'surface'])
        expect(c(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    // Group headers and invisible-character markers sit on surface-2.
    expect(c('muted', 'surface-2'), 'muted on surface-2').toBeGreaterThanOrEqual(4.5);
    expect(c('text', 'surface-2'), 'text on surface-2').toBeGreaterThanOrEqual(4.5);
    expect(c('on-accent', 'accent'), 'button text').toBeGreaterThanOrEqual(4.5);
    expect(c('text', 'accent-bg')).toBeGreaterThanOrEqual(4.5);
    expect(c('accent-text', 'accent-bg')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TYPES)('%s: text variant, tint and indicator colour pass', (type) => {
    for (const bg of ['bg', 'surface', `${type}-bg`]) {
      expect(c(`${type}-text`, bg), `${type}-text on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(c('text', `${type}-bg`), `text on ${type}-bg`).toBeGreaterThanOrEqual(4.5);
    // Non-text (icons, underlines): WCAG 1.4.11 asks for 3:1.
    for (const bg of ['bg', 'surface']) expect(c(type, bg)).toBeGreaterThanOrEqual(3);
  });
});

describe('token blocks', () => {
  it('the two dark blocks are identical', () => {
    expect(darkMedia).toEqual(dark);
  });

  it('light and dark define the same tokens', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('the plan’s known failures are fixed by the text variants', () => {
    expect(contrast(light['fix-encoding']!, light['surface']!)).toBeLessThan(4.5);
    expect(contrast(light['fix-encoding-text']!, light['surface']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light['fix-translate-text']!, light['surface']!)).toBeGreaterThanOrEqual(4.5);
  });
});
