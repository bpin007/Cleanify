/**
 * Section 19 — warning bugs #8 (U+FFFD) and #10 (look-alike letters).
 */
import { describe, expect, it } from 'vitest';
import { analyze, applyChanges, parseText, render } from '../../src/index';

describe('#8 the replacement character � is flagged as data already lost', () => {
  it('warns with the location of the first occurrence', () => {
    const { warnings } = analyze(parseText('ok\nCaf� au lait'));
    expect(warnings).toContainEqual(
      expect.objectContaining({
        kind: 'data-lost',
        location: expect.objectContaining({ type: 'text', line: 2, column: 4 }),
      }),
    );
  });

  it('does not propose a fix for it (the original is unrecoverable)', () => {
    const { changes } = analyze(parseText('Caf�'), { stages: { encoding: true, ascii: true } });
    expect(changes.filter((c) => c.from.includes('�'))).toEqual([]);
  });
});

describe('#10 look-alike letters are flagged', () => {
  const spoof = 'Log in to pаypal.com now'; // Cyrillic а (U+0430)

  it('warns about a word mixing Latin and Cyrillic letters', () => {
    const { warnings } = analyze(parseText(spoof));
    expect(warnings).toContainEqual(
      expect.objectContaining({
        kind: 'mixed-script',
        location: expect.objectContaining({ line: 1, column: 12 }),
      }),
    );
  });

  it('offers an optional fix that is not accepted by default', () => {
    const doc = parseText(spoof);
    const { changes } = analyze(doc, { stages: { encoding: true, ascii: true } });
    const fix = changes.find((c) => c.kind === 'confusable');
    expect(fix).toMatchObject({ from: 'а', to: 'a', accepted: false });
    const accepted = changes.map((c) => (c === fix ? { ...c, accepted: true } : c));
    expect(render(applyChanges(doc, accepted))).toBe('Log in to paypal.com now');
  });

  it.each(['Привет, мир', 'Hello, world', 'Αθήνα', 'Café Москва'])(
    'does not warn for single-script words: %s',
    (text) => {
      const { warnings } = analyze(parseText(text));
      expect(warnings.filter((w) => w.kind === 'mixed-script')).toEqual([]);
    },
  );
});
