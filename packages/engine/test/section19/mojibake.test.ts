/**
 * Section 19 — Stage 1 mojibake bugs #11, #12, #13, #14.
 */
import { describe, expect, it } from 'vitest';
import { analyze, applyChanges, parseText, render } from '../../src/index';
import { CP1252_SPECIALS, byStage, mojibake } from '../helpers';

function repair(text: string) {
  const doc = parseText(text);
  const { changes } = analyze(doc, { stages: { encoding: true, ascii: false } });
  const enc = byStage(changes, 'encoding');
  return { changes: enc, output: render(applyChanges(doc, enc)) };
}

describe('#11 real French «CAFÉ» is not mojibake', () => {
  it('proposes no encoding change for «CAFÉ»', () => {
    expect(repair('«CAFÉ»').changes).toEqual([]);
  });

  it('never turns É» into ɻ (U+027B)', () => {
    const { output } = repair('Le menu du «CAFÉ» est prêt.');
    expect(output).not.toContain('ɻ');
    expect(output).toBe('Le menu du «CAFÉ» est prêt.');
  });

  it('leaves accented capitals followed by punctuation alone (É…, Ü», Í…)', () => {
    for (const s of ['CAFÉ…', 'MÜ»', 'ÄÖÜ!', 'SÍ…', 'IRMÃO', 'É»']) {
      expect(repair(s).changes, s).toEqual([]);
    }
  });
});

describe('#12 Chinese mojibake is repaired as whole characters', () => {
  it('repairs ä¸­æ–‡ → 中文 in one change', () => {
    const garbled = mojibake('中文');
    expect(garbled).toBe('ä¸­æ–‡');
    const { changes, output } = repair(garbled);
    expect(output).toBe('中文');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ from: garbled, to: '中文', kind: 'mojibake' });
  });

  it('repairs Chinese mojibake inside a sentence', () => {
    expect(repair(`Title: ${mojibake('中文测试')} (v2)`).output).toBe('Title: 中文测试 (v2)');
  });
});

describe('#13 emoji mojibake is repaired as one 4-byte sequence', () => {
  it('repairs ðŸ˜€ → 😀 in one change', () => {
    const garbled = mojibake('😀');
    expect(garbled).toBe('ðŸ˜€');
    const { changes, output } = repair(`hi ${garbled}!`);
    expect(output).toBe('hi 😀!');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ from: garbled, to: '😀' });
  });
});

describe('#14 the most common mojibake gets fixed', () => {
  it('repairs donâ€™t → don’t', () => {
    expect(repair('donâ€™t').output).toBe('don’t');
  });

  it.each(CP1252_SPECIALS)('repairs the garbled form of %s', (ch) => {
    const garbled = mojibake(`x${ch}y`);
    expect(repair(garbled).output).toBe(`x${ch}y`);
  });

  it('repairs a typical garbled sentence', () => {
    const original = 'José García said “it’s café time” – 5 € …';
    expect(repair(mojibake(original)).output).toBe(original);
  });
});
